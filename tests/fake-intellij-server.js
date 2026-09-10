#!/usr/bin/env node
'use strict';

let buffer = Buffer.alloc(0);

const args = process.argv.slice(2);
const eulaIndex = args.indexOf('--eula');
const eula = args[eulaIndex + 1] || '';
if (!args.includes('--stdio') || !args.includes('--system-path') || eulaIndex < 0 || (eula !== 'fake-eula' && !/^[a-f0-9]{16}$/.test(eula))) {
  console.error(`unexpected launcher arguments: ${JSON.stringify(args)}`);
  process.exit(2);
}

function send(message) {
  const body = Buffer.from(JSON.stringify({ jsonrpc: '2.0', ...message }), 'utf8');
  process.stdout.write(`Content-Length: ${body.length}\r\n\r\n`);
  process.stdout.write(body);
}

function result(method, params) {
  const uri = params?.textDocument?.uri || 'file:///workspace/App.java';
  const position = params?.position || { line: 0, character: 0 };
  switch (method) {
    case 'initialize': return { capabilities: { textDocumentSync: 1 } };
    case 'workspace/symbol': return [{ name: params.query, kind: 5, location: { uri, range: { start: position, end: position } } }];
    case 'textDocument/documentSymbol': return [{ name: 'App', kind: 5, range: { start: position, end: position }, selectionRange: { start: position, end: position } }];
    case 'textDocument/diagnostic': return { kind: 'full', items: [] };
    case 'textDocument/hover': return { contents: { kind: 'markdown', value: '`demo.App`' } };
    case 'textDocument/prepareRename': return { start: position, end: position };
    case 'textDocument/rename': return { changes: { [uri]: [] } };
    case 'textDocument/codeAction': return [{ title: 'Fake action', kind: 'quickfix' }];
    case 'textDocument/references':
    case 'textDocument/definition':
    case 'textDocument/typeDefinition':
    case 'textDocument/implementation':
      return [{ uri, range: { start: position, end: position } }];
    case 'shutdown': return null;
    default: return null;
  }
}

function receive(message) {
  if (message.method === 'initialized') {
    send({
      id: 'fake-config',
      method: 'workspace/configuration',
      params: { items: [{ section: 'intellij' }, { section: 'jetbrains.kotlin' }] },
    });
    return;
  }
  if (message.id === 'fake-config' && !message.method) {
    if (!Array.isArray(message.result) || message.result[0]?.trace?.server !== 'off') {
      console.error(`bad workspace/configuration response: ${JSON.stringify(message.result)}`);
      process.exit(3);
    }
    send({ method: 'intellij/ready-for-test', params: { fake: true } });
    return;
  }
  if (Object.prototype.hasOwnProperty.call(message, 'id')) send({ id: message.id, result: result(message.method, message.params || {}) });
}

process.stdin.on('data', chunk => {
  buffer = Buffer.concat([buffer, chunk]);
  while (true) {
    const headerEnd = buffer.indexOf('\r\n\r\n');
    if (headerEnd < 0) return;
    const header = buffer.subarray(0, headerEnd).toString('ascii');
    const match = /Content-Length:\s*(\d+)/i.exec(header);
    if (!match) process.exit(2);
    const length = Number(match[1]);
    const start = headerEnd + 4;
    if (buffer.length < start + length) return;
    receive(JSON.parse(buffer.subarray(start, start + length).toString('utf8')));
    buffer = buffer.subarray(start + length);
  }
});
