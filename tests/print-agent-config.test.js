const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const agent = require('../agent/printbridge-agent.js');

// The agent's configuration (agent/config.json), the printer list parsing and the embedded PowerShell.

function withFile(text, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-agent-'));
  const file = path.join(dir, 'config.json');
  if (text !== null) fs.writeFileSync(file, text);
  try { return fn(file); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test('no config file: the defaults (port 9631, the deployed site and localhost, no file://, 5 MB)', () => {
  withFile(null, file => {
    const config = agent.loadConfig(file);
    assert.equal(config.port, 9631);
    assert.deepEqual(config.allowedOrigins, ['https://danielvl1982.github.io', 'http://localhost', 'http://127.0.0.1']);
    assert.equal(config.allowFileOrigin, false);
    assert.equal(config.maxBytes, 5 * 1024 * 1024);
  });
});

test('a partial config file keeps the defaults of the missing keys', () => {
  withFile('{ "port": 9700 }', file => {
    const config = agent.loadConfig(file);
    assert.equal(config.port, 9700);
    assert.equal(config.allowFileOrigin, false);
    assert.equal(config.maxBytes, 5242880);
    assert.equal(config.allowedOrigins.length, 3);
  });
});

test('a full config file (also with a BOM and trailing slashes in the origins) is read', () => {
  withFile('﻿{ "port": 1234, "allowedOrigins": ["https://a.example/"], "allowFileOrigin": true, "maxBytes": 2048 }', file => {
    assert.deepEqual(agent.loadConfig(file), { port: 1234, allowedOrigins: ['https://a.example'], allowFileOrigin: true, maxBytes: 2048 });
  });
});

test('the shipped config.example.json is valid and equals the defaults', () => {
  const config = agent.loadConfig(path.join(__dirname, '..', 'agent', 'config.example.json'));
  assert.deepEqual(config, { ...agent.DEFAULT_CONFIG, allowedOrigins: [...agent.DEFAULT_CONFIG.allowedOrigins] });
});

test('an invalid config file throws a clear error naming the file', () => {
  withFile('{ not json', file => assert.throws(() => agent.loadConfig(file), err => err.message.includes('not valid JSON') && err.message.includes(file)));
  withFile('[1]', file => assert.throws(() => agent.loadConfig(file), /JSON object/));
  const bad = [
    ['{ "port": "9631" }', /"port"/], ['{ "port": 70000 }', /"port"/], ['{ "port": 1.5 }', /"port"/],
    ['{ "allowedOrigins": "x" }', /"allowedOrigins"/], ['{ "allowedOrigins": [1] }', /"allowedOrigins"/], ['{ "allowedOrigins": [""] }', /"allowedOrigins"/],
    ['{ "allowFileOrigin": "yes" }', /"allowFileOrigin"/], ['{ "maxBytes": 0 }', /"maxBytes"/], ['{ "maxBytes": "5" }', /"maxBytes"/],
  ];
  for (const [text, pattern] of bad) withFile(text, file => assert.throws(() => agent.loadConfig(file), pattern, text));
});

test('an unreadable path (a directory) is a clear error, not the defaults', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-agent-'));
  try { assert.throws(() => agent.loadConfig(dir), /Cannot read the config file/); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('normalizeConfig accepts undefined and does not share the default origins array', () => {
  const config = agent.normalizeConfig(undefined);
  config.allowedOrigins.push('https://x.example');
  assert.equal(agent.DEFAULT_CONFIG.allowedOrigins.length, 3);
});

test('isHostAllowed and isOriginAllowed on their own', () => {
  assert.ok(agent.isHostAllowed('127.0.0.1:9631'));
  assert.ok(!agent.isHostAllowed(undefined));
  assert.ok(!agent.isHostAllowed(''));
  assert.ok(agent.isOriginAllowed('http://localhost:5173', agent.DEFAULT_CONFIG));
  assert.ok(!agent.isOriginAllowed('not a url', agent.DEFAULT_CONFIG));
});

test('parsePrinterList: an array, a single object, an empty result and the status words', () => {
  const json = JSON.stringify([
    { Name: 'TEC', Default: true, PrinterStatus: 3, WorkOffline: false },
    { Name: 'Zebra "ZD"', Default: false, PrinterStatus: 3, WorkOffline: true },
    { Name: 'TSC', Default: false, PrinterStatus: 99, WorkOffline: false },
  ]);
  assert.deepEqual(agent.parsePrinterList(json), [
    { name: 'TEC', isDefault: true, status: 'ready' },
    { name: 'Zebra "ZD"', isDefault: false, status: 'offline' },
    { name: 'TSC', isDefault: false, status: 'unknown' },
  ]);
  assert.deepEqual(agent.parsePrinterList('{"Name":"One","Default":false,"PrinterStatus":4}'), [{ name: 'One', isDefault: false, status: 'printing' }]);
  assert.deepEqual(agent.parsePrinterList(''), []);
  assert.deepEqual(agent.parsePrinterList('[]'), []);
});

test('the Windows spooler refuses to run on another OS with a clear error', { skip: process.platform === 'win32' }, async () => {
  const spooler = agent.createWindowsSpooler();
  await assert.rejects(spooler.listPrinters(), /only available on Windows/);
  await assert.rejects(spooler.printRaw('x', Buffer.from('a')), /only available on Windows/);
});

test('the PowerShell scripts never contain the printer name or the data: they read them from the environment', () => {
  assert.match(agent.PRINT_SCRIPT, /\$env:PB_PRINTER/);
  assert.match(agent.PRINT_SCRIPT, /\$env:PB_FILE/);
  assert.match(agent.PRINT_SCRIPT, /pDataType = "RAW"/);
  for (const call of ['OpenPrinter', 'StartDocPrinter', 'StartPagePrinter', 'WritePrinter', 'EndPagePrinter', 'EndDocPrinter', 'ClosePrinter']) {
    assert.ok(agent.PRINT_SCRIPT.includes(call), call);
  }
  assert.match(agent.LIST_SCRIPT, /Win32_Printer/);
});

test('both PowerShell scripts parse (Windows PowerShell only)', { skip: process.platform !== 'win32' }, () => {
  for (const [name, script] of [['list', agent.LIST_SCRIPT], ['print', agent.PRINT_SCRIPT]]) {
    // Parser::ParseInput reports syntax errors without running anything (Add-Type is not executed)
    const check = '$e = $null; $t = $null; [void][System.Management.Automation.Language.Parser]::ParseInput($env:PB_SCRIPT, [ref]$t, [ref]$e); if ($e.Count -gt 0) { $e | ForEach-Object { $_.Message }; exit 1 }';
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', check], { env: { ...process.env, PB_SCRIPT: script }, encoding: 'utf8' });
    assert.equal(result.status, 0, `${name}: ${result.stdout}${result.stderr}`);
  }
});
