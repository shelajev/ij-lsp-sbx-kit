#!/usr/bin/env node
'use strict';

const childProcess = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const [workspaceArg, launcher, eulaHash, socketPath = '/tmp/ij-lsp-agent.sock'] = process.argv.slice(2);
if (!workspaceArg || !launcher || !eulaHash) {
  console.error('usage: daemon.js <workspace> <launcher> <eula-hash> [socket]');
  process.exit(2);
}

const workspace = fs.realpathSync(workspaceArg);
const rootUri = pathToFileURL(workspace).href;
const stateRoot = process.env.IJ_LSP_STATE_DIR || path.join(os.homedir(), '.local', 'share', 'ij-lsp');
const workspaceId = crypto.createHash('sha256').update(workspace).digest('hex').slice(0, 16);
const systemPath = path.join(stateRoot, 'workspaces', workspaceId, 'system');
const indexDir = path.join(stateRoot, 'workspaces', workspaceId, 'index');
fs.mkdirSync(systemPath, { recursive: true });
fs.mkdirSync(indexDir, { recursive: true });

function javaHome() {
  if (process.env.JAVA_HOME && fs.existsSync(process.env.JAVA_HOME)) return process.env.JAVA_HOME;
  const found = childProcess.spawnSync('sh', ['-c', 'command -v java'], { encoding: 'utf8' }).stdout.trim();
  if (!found) return undefined;
  try {
    return path.dirname(path.dirname(fs.realpathSync(found)));
  } catch (_) {
    return undefined;
  }
}

const sdk = javaHome();
const settings = {
  'intellij.trace.server': 'off',
  'intellij.dataSharing': 'none',
  'intellij.region': 'not_set',
  'intellij.jdkForSymbolResolution': sdk || null,
  'intellij.projects': [],
  'jetbrains.kotlin.lsp.inlayHints.codeVisionUsages.enabled': true,
  'jetbrains.kotlin.lsp.inlayHints.codeVisionInheritors.enabled': true,
  'jetbrains.kotlin.lsp.inlayHints.codeVisionSettings.enabled': true,
};

function sectionValue(section) {
  if (!section) return settings;
  if (Object.prototype.hasOwnProperty.call(settings, section)) return settings[section];
  const prefix = `${section}.`;
  const result = {};
  let matched = false;
  for (const [key, value] of Object.entries(settings)) {
    if (!key.startsWith(prefix)) continue;
    matched = true;
    const parts = key.slice(prefix.length).split('.');
    let cursor = result;
    for (let i = 0; i < parts.length - 1; i += 1) cursor = cursor[parts[i]] ||= {};
    cursor[parts[parts.length - 1]] = value;
  }
  return matched ? result : null;
}

class LspClient {
  constructor() {
    this.nextId = 1;
    this.pending = new Map();
    this.buffer = Buffer.alloc(0);
    this.diagnostics = new Map();
    this.openDocuments = new Map();
    this.initialized = false;
    this.indexed = false;
    this.readyParams = null;
    this.progress = new Map();
    this.exited = false;
  }

  async start() {
    const env = { ...process.env };
    delete env.INTELLIJ_DATA_SHARING;
    this.child = childProcess.spawn(launcher, ['--stdio', '--system-path', systemPath, '--eula', eulaHash], {
      cwd: workspace,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child.stdout.on('data', chunk => this.onData(chunk));
    this.child.stderr.on('data', chunk => process.stderr.write(chunk));
    this.child.on('error', error => this.failAll(error));
    this.child.on('exit', (code, signal) => {
      this.exited = true;
      this.failAll(new Error(`IntelliJ server exited (code=${code}, signal=${signal})`));
      setTimeout(() => process.exit(code || 1), 25);
    });

    const initOptions = {
      eulaHash,
      buildTools: { [rootUri]: '*' },
      indexDir,
      projects: [],
      disableRocksDBWriteAheadLog: false,
    };
    if (sdk) {
      initOptions.defaultSdk = sdk;
      initOptions.defaultJdk = sdk;
    }

    await this.request('initialize', {
      processId: process.pid,
      clientInfo: { name: 'ij-agent-bridge', version: '0.4.0' },
      locale: 'en',
      rootPath: workspace,
      rootUri,
      workspaceFolders: [{ uri: rootUri, name: path.basename(workspace) }],
      initializationOptions: initOptions,
      capabilities: {
        general: { positionEncodings: ['utf-16'] },
        workspace: {
          applyEdit: false,
          configuration: true,
          symbol: { dynamicRegistration: false },
          workspaceFolders: true,
        },
        window: { workDoneProgress: true, showDocument: { support: false } },
        textDocument: {
          synchronization: { dynamicRegistration: false, didSave: true },
          definition: { dynamicRegistration: false, linkSupport: true },
          typeDefinition: { dynamicRegistration: false, linkSupport: true },
          implementation: { dynamicRegistration: false, linkSupport: true },
          references: { dynamicRegistration: false },
          hover: { dynamicRegistration: false, contentFormat: ['markdown', 'plaintext'] },
          documentSymbol: { dynamicRegistration: false, hierarchicalDocumentSymbolSupport: true },
          codeAction: {
            dynamicRegistration: false,
            codeActionLiteralSupport: {
              codeActionKind: { valueSet: ['', 'quickfix', 'refactor', 'refactor.extract', 'refactor.inline', 'refactor.rewrite', 'source'] },
            },
          },
          rename: { dynamicRegistration: false, prepareSupport: true },
          diagnostic: { dynamicRegistration: false, relatedDocumentSupport: true },
        },
      },
      trace: 'off',
    }, 120000);
    this.notify('initialized', {});
    this.initialized = true;
  }

  send(message) {
    const body = Buffer.from(JSON.stringify({ jsonrpc: '2.0', ...message }), 'utf8');
    this.child.stdin.write(`Content-Length: ${body.length}\r\n\r\n`);
    this.child.stdin.write(body);
  }

  request(method, params, timeoutMs = 120000) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out after ${timeoutMs / 1000}s`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer, method });
      this.send({ id, method, params });
    });
  }

  notify(method, params) {
    this.send({ method, params });
  }

  onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (true) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      if (headerEnd < 0) return;
      const header = this.buffer.subarray(0, headerEnd).toString('ascii');
      const match = /(?:^|\r\n)Content-Length:\s*(\d+)/i.exec(header);
      if (!match) throw new Error(`invalid LSP header: ${header}`);
      const length = Number(match[1]);
      const bodyStart = headerEnd + 4;
      if (this.buffer.length < bodyStart + length) return;
      const body = this.buffer.subarray(bodyStart, bodyStart + length).toString('utf8');
      this.buffer = this.buffer.subarray(bodyStart + length);
      try {
        this.onMessage(JSON.parse(body));
      } catch (error) {
        console.error(`Invalid LSP message: ${error.message}`);
      }
    }
  }

  onMessage(message) {
    if (Object.prototype.hasOwnProperty.call(message, 'id') && !message.method) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(`${pending.method}: ${message.error.message || JSON.stringify(message.error)}`));
      else pending.resolve(message.result);
      return;
    }
    if (message.method && Object.prototype.hasOwnProperty.call(message, 'id')) {
      Promise.resolve(this.handleServerRequest(message.method, message.params || {}))
        .then(result => this.send({ id: message.id, result: result === undefined ? null : result }))
        .catch(error => this.send({ id: message.id, error: { code: -32603, message: error.message } }));
      return;
    }
    if (message.method) this.handleNotification(message.method, message.params || {});
  }

  handleServerRequest(method, params) {
    switch (method) {
      case 'workspace/configuration':
        return (params.items || []).map(item => sectionValue(item.section));
      case 'workspace/workspaceFolders':
        return [{ uri: rootUri, name: path.basename(workspace) }];
      case 'workspace/applyEdit':
        return { applied: false, failureReason: 'ij exposes preview-only operations; the agent applies edits itself.' };
      case 'window/workDoneProgress/create':
      case 'client/registerCapability':
      case 'client/unregisterCapability':
      case 'workspace/codeLens/refresh':
      case 'workspace/diagnostic/refresh':
      case 'workspace/inlayHint/refresh':
      case 'workspace/semanticTokens/refresh':
        return null;
      case 'window/showMessageRequest':
        return null;
      case 'window/showDocument':
        return { success: false };
      default:
        console.error(`Unhandled server request: ${method}`);
        return null;
    }
  }

  handleNotification(method, params) {
    if (method === 'textDocument/publishDiagnostics' && params.uri) this.diagnostics.set(params.uri, params.diagnostics || []);
    if (method === 'intellij/ready-for-test') {
      this.indexed = true;
      this.readyParams = params;
    }
    if (method === '$/progress') this.progress.set(String(params.token), params.value);
    if (method === 'window/logMessage' || method === 'window/showMessage') {
      console.error(`[${method}] ${params.message || JSON.stringify(params)}`);
    }
  }

  failAll(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  async document(file) {
    const absolute = path.resolve(workspace, file);
    const stat = fs.statSync(absolute);
    if (!stat.isFile()) throw new Error(`not a file: ${file}`);
    const text = fs.readFileSync(absolute, 'utf8');
    const uri = pathToFileURL(absolute).href;
    const languageId = absolute.endsWith('.kt') || absolute.endsWith('.kts') ? 'kotlin' : 'java';
    const previous = this.openDocuments.get(uri);
    if (!previous) {
      this.openDocuments.set(uri, { version: 1, text });
      this.notify('textDocument/didOpen', { textDocument: { uri, languageId, version: 1, text } });
    } else if (previous.text !== text) {
      previous.version += 1;
      previous.text = text;
      this.notify('textDocument/didChange', {
        textDocument: { uri, version: previous.version },
        contentChanges: [{ text }],
      });
    }
    return { absolute, uri };
  }
}

const lsp = new LspClient();

function json(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) });
  response.end(body);
}

function required(query, name) {
  const value = query.get(name);
  if (value === null || value === '') throw new Error(`missing query parameter: ${name}`);
  return value;
}

function position(query) {
  const line = Number(required(query, 'line'));
  const character = Number(required(query, 'column'));
  if (!Number.isInteger(line) || !Number.isInteger(character) || line < 1 || character < 1) {
    throw new Error('line and column must be positive 1-based integers');
  }
  return { line: line - 1, character: character - 1 };
}

async function textRequest(query, method, extra = {}) {
  const document = await lsp.document(required(query, 'file'));
  return lsp.request(method, { textDocument: { uri: document.uri }, position: position(query), ...extra });
}

async function route(request, response) {
  if (request.method !== 'GET') return json(response, 405, { error: 'GET required' });
  const url = new URL(request.url, 'http://localhost');
  const query = url.searchParams;
  try {
    if (url.pathname === '/v1/status') {
      return json(response, 200, {
        server: 'intellij',
        pid: lsp.child.pid,
        workspace,
        initialized: lsp.initialized,
        indexed: lsp.indexed,
        ready: lsp.readyParams,
        progress: Object.fromEntries(lsp.progress),
      });
    }
    if (url.pathname === '/v1/wait') {
      const requestedSeconds = Number(query.get('seconds') || 300);
      if (!Number.isFinite(requestedSeconds)) throw new Error('seconds must be a number');
      const seconds = Math.min(1800, Math.max(1, requestedSeconds));
      const deadline = Date.now() + seconds * 1000;
      while (!lsp.indexed && !lsp.exited && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 1000));
      return json(response, lsp.indexed ? 200 : 202, { indexed: lsp.indexed, waitedSeconds: seconds, ready: lsp.readyParams });
    }
    if (url.pathname === '/v1/symbols') return json(response, 200, await lsp.request('workspace/symbol', { query: required(query, 'query') }));
    if (url.pathname === '/v1/outline') {
      const document = await lsp.document(required(query, 'file'));
      return json(response, 200, await lsp.request('textDocument/documentSymbol', { textDocument: { uri: document.uri } }));
    }
    if (url.pathname === '/v1/diagnostics') {
      const document = await lsp.document(required(query, 'file'));
      try {
        return json(response, 200, await lsp.request('textDocument/diagnostic', { textDocument: { uri: document.uri } }));
      } catch (_) {
        return json(response, 200, { kind: 'full', items: lsp.diagnostics.get(document.uri) || [] });
      }
    }
    const methods = {
      '/v1/definition': 'textDocument/definition',
      '/v1/type-definition': 'textDocument/typeDefinition',
      '/v1/implementation': 'textDocument/implementation',
      '/v1/hover': 'textDocument/hover',
    };
    if (methods[url.pathname]) return json(response, 200, await textRequest(query, methods[url.pathname]));
    if (url.pathname === '/v1/references') {
      return json(response, 200, await textRequest(query, 'textDocument/references', { context: { includeDeclaration: true } }));
    }
    if (url.pathname === '/v1/code-actions') {
      const pos = position(query);
      const document = await lsp.document(required(query, 'file'));
      return json(response, 200, await lsp.request('textDocument/codeAction', {
        textDocument: { uri: document.uri }, range: { start: pos, end: pos }, context: { diagnostics: lsp.diagnostics.get(document.uri) || [] },
      }));
    }
    if (url.pathname === '/v1/rename-preview') {
      const document = await lsp.document(required(query, 'file'));
      const pos = position(query);
      const prepare = await lsp.request('textDocument/prepareRename', { textDocument: { uri: document.uri }, position: pos });
      if (!prepare) return json(response, 200, { prepare: null, edit: null });
      const edit = await lsp.request('textDocument/rename', {
        textDocument: { uri: document.uri }, position: pos, newName: required(query, 'newName'),
      });
      return json(response, 200, { prepare, edit });
    }
    return json(response, 404, { error: 'unknown endpoint' });
  } catch (error) {
    console.error(error.stack || error.message);
    return json(response, 500, { error: error.message });
  }
}

async function main() {
  await lsp.start();
  if (fs.existsSync(socketPath)) fs.unlinkSync(socketPath);
  const server = http.createServer((request, response) => void route(request, response));
  server.listen(socketPath, () => fs.chmodSync(socketPath, 0o600));
  const stop = () => {
    try { lsp.notify('exit'); } catch (_) {}
    try { lsp.child.kill('SIGTERM'); } catch (_) {}
    try { if (fs.existsSync(socketPath)) fs.unlinkSync(socketPath); } catch (_) {}
    process.exit(0);
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
