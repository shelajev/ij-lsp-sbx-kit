'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const vscode = require('vscode');

const SOCKET_PATH = '/tmp/ij-lsp-agent.sock';
const LOG_PATH = '/tmp/ij-lsp-agent-bridge.log';
const JETBRAINS_EXTENSION_ID = 'JetBrains.intellij-server';
const REQUEST_TIMEOUT_MS = 120000;

let server;
let output;

function log(message) {
  const line = `${new Date().toISOString()} ${message}`;
  output?.appendLine(line);
  fs.appendFile(LOG_PATH, `${line}\n`, () => {});
}

function timeout(promise, label, milliseconds = REQUEST_TIMEOUT_MS) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${milliseconds} ms`)), milliseconds);
    }),
  ]).finally(() => clearTimeout(timer));
}

function sendJson(response, status, body) {
  const content = `${JSON.stringify(body, null, 2)}\n`;
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(content),
  });
  response.end(content);
}

function required(url, name) {
  const value = url.searchParams.get(name);
  if (value === null || value === '') {
    throw new Error(`Missing required parameter: ${name}`);
  }
  return value;
}

function positiveInteger(url, name) {
  const raw = required(url, name);
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive, 1-based integer`);
  }
  return value;
}

function resolveUri(file) {
  if (file.startsWith('file:')) {
    return vscode.Uri.parse(file);
  }
  const absolute = path.isAbsolute(file)
    ? file
    : path.resolve(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd(), file);
  return vscode.Uri.file(absolute);
}

async function documentAndPosition(url) {
  const uri = resolveUri(required(url, 'file'));
  await vscode.workspace.openTextDocument(uri);
  return {
    uri,
    position: new vscode.Position(positiveInteger(url, 'line') - 1, positiveInteger(url, 'column') - 1),
  };
}

function position(value) {
  return { line: value.line + 1, column: value.character + 1 };
}

function range(value) {
  return { start: position(value.start), end: position(value.end) };
}

function location(value) {
  if (value.targetUri) {
    return {
      uri: value.targetUri.toString(),
      range: range(value.targetRange),
      selectionRange: value.targetSelectionRange ? range(value.targetSelectionRange) : undefined,
      originSelectionRange: value.originSelectionRange ? range(value.originSelectionRange) : undefined,
    };
  }
  return { uri: value.uri.toString(), range: range(value.range) };
}

function symbolKind(value) {
  return vscode.SymbolKind[value] ?? String(value);
}

function symbol(value) {
  if (value.location) {
    return {
      name: value.name,
      kind: symbolKind(value.kind),
      containerName: value.containerName,
      location: location(value.location),
    };
  }
  return {
    name: value.name,
    detail: value.detail,
    kind: symbolKind(value.kind),
    range: range(value.range),
    selectionRange: range(value.selectionRange),
    children: (value.children ?? []).map(symbol),
  };
}

function textEdit(value) {
  return { range: range(value.range), newText: value.newText };
}

function workspaceEdit(value) {
  if (!value) return undefined;
  return value.entries().map(([uri, edits]) => ({
    uri: uri.toString(),
    edits: edits.map(textEdit),
  }));
}

function diagnostic(value) {
  return {
    message: value.message,
    severity: vscode.DiagnosticSeverity[value.severity] ?? String(value.severity),
    range: range(value.range),
    source: value.source,
    code: typeof value.code === 'object' ? value.code?.value : value.code,
  };
}

function hover(value) {
  return {
    contents: value.contents.map((content) =>
      typeof content === 'string' ? content : (content.value ?? String(content)),
    ),
    range: value.range ? range(value.range) : undefined,
  };
}

function codeAction(value) {
  const actionCommand = typeof value.command === 'string' ? value : value.command;
  return {
    title: value.title,
    kind: value.kind?.value,
    preferred: value.isPreferred,
    disabled: value.disabled?.reason,
    diagnostics: value.diagnostics?.map(diagnostic),
    edit: workspaceEdit(value.edit),
    command: actionCommand ? { id: actionCommand.command, title: actionCommand.title } : undefined,
  };
}

async function ensureJetBrains() {
  const extension = vscode.extensions.getExtension(JETBRAINS_EXTENSION_ID);
  if (!extension) {
    throw new Error(`${JETBRAINS_EXTENSION_ID} is not installed`);
  }
  if (!extension.isActive) {
    await timeout(extension.activate(), 'JetBrains extension activation');
  }
  return extension;
}

async function execute(command, ...args) {
  await ensureJetBrains();
  return timeout(vscode.commands.executeCommand(command, ...args), command);
}

async function dispatch(url) {
  if (url.pathname === '/v1/status') {
    const extension = vscode.extensions.getExtension(JETBRAINS_EXTENSION_ID);
    let activationError;
    if (extension && !extension.isActive) {
      try {
        await timeout(extension.activate(), 'JetBrains extension activation', 30000);
      } catch (error) {
        activationError = error instanceof Error ? error.message : String(error);
      }
    }
    return {
      bridge: 'ready',
      socket: SOCKET_PATH,
      jetbrains: {
        installed: Boolean(extension),
        active: extension?.isActive ?? false,
        version: extension?.packageJSON?.version,
        activationError,
      },
      workspaces: (vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri.fsPath),
      note: 'Use the ij command for IntelliJ-backed semantic queries. Empty results can mean project import or indexing is still in progress.',
    };
  }

  if (url.pathname === '/v1/symbols') {
    const result = await execute('vscode.executeWorkspaceSymbolProvider', required(url, 'query'));
    return (result ?? []).map(symbol);
  }

  if (url.pathname === '/v1/outline') {
    const uri = resolveUri(required(url, 'file'));
    await vscode.workspace.openTextDocument(uri);
    const result = await execute('vscode.executeDocumentSymbolProvider', uri);
    return (result ?? []).map(symbol);
  }

  if (url.pathname === '/v1/diagnostics') {
    await ensureJetBrains();
    const uri = resolveUri(required(url, 'file'));
    await vscode.workspace.openTextDocument(uri);
    return vscode.languages.getDiagnostics(uri).map(diagnostic);
  }

  const { uri, position: target } = await documentAndPosition(url);
  if (url.pathname === '/v1/definition') {
    const result = await execute('vscode.executeDefinitionProvider', uri, target);
    return (result ?? []).map(location);
  }
  if (url.pathname === '/v1/type-definition') {
    const result = await execute('vscode.executeTypeDefinitionProvider', uri, target);
    return (result ?? []).map(location);
  }
  if (url.pathname === '/v1/implementation') {
    const result = await execute('vscode.executeImplementationProvider', uri, target);
    return (result ?? []).map(location);
  }
  if (url.pathname === '/v1/references') {
    const result = await execute('vscode.executeReferenceProvider', uri, target);
    return (result ?? []).map(location);
  }
  if (url.pathname === '/v1/hover') {
    const result = await execute('vscode.executeHoverProvider', uri, target);
    return (result ?? []).map(hover);
  }
  if (url.pathname === '/v1/code-actions') {
    const targetRange = new vscode.Range(target, target);
    const result = await execute('vscode.executeCodeActionProvider', uri, targetRange);
    return (result ?? []).map(codeAction);
  }
  if (url.pathname === '/v1/rename-preview') {
    const result = await execute(
      'vscode.executeDocumentRenameProvider',
      uri,
      target,
      required(url, 'newName'),
    );
    return workspaceEdit(result) ?? [];
  }

  throw new Error(`Unknown endpoint: ${url.pathname}`);
}

function activate(context) {
  output = vscode.window.createOutputChannel('IntelliJ Agent Bridge');
  context.subscriptions.push(output);

  try {
    fs.unlinkSync(SOCKET_PATH);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  server = http.createServer(async (request, response) => {
    try {
      if (request.method !== 'GET') {
        sendJson(response, 405, { ok: false, error: 'Only GET is supported' });
        return;
      }
      const url = new URL(request.url, 'http://localhost');
      log(`${request.method} ${url.pathname}`);
      const result = await dispatch(url);
      sendJson(response, 200, { ok: true, result });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`request failed: ${message}`);
      sendJson(response, 400, { ok: false, error: message });
    }
  });

  server.on('error', (error) => log(`server error: ${error.message}`));
  server.listen(SOCKET_PATH, () => {
    fs.chmodSync(SOCKET_PATH, 0o600);
    log(`ready on ${SOCKET_PATH}`);
  });

  context.subscriptions.push({
    dispose: () => {
      server?.close();
      try {
        fs.unlinkSync(SOCKET_PATH);
      } catch (error) {
        if (error?.code !== 'ENOENT') log(`socket cleanup failed: ${error.message}`);
      }
    },
  });
}

function deactivate() {
  server?.close();
}

module.exports = { activate, deactivate };
