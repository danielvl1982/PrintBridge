const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { spawnSync } = require('node:child_process');
const agent = require('../agent/printbridge-agent.js');

// POST /print-image of the print agent: validation, flow and PowerShell argument set, all with a fake spooler (no printer, no PowerShell).

const { createServer, parseImageQuery, isPng, buildImageEnv, IMAGE_SCRIPT } = agent;

const PRINTERS = [
  { name: 'HP LaserJet "4" Pro', isDefault: true, status: 'ready' },
  { name: 'TEC B-EV4', isDefault: false, status: 'ready' },
];
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const png = (extra = 16) => Buffer.concat([PNG_SIGNATURE, Buffer.alloc(extra, 7)]);
const QUERY = 'printer=TEC%20B-EV4&widthMm=100&heightMm=50&dpi=300';

function fakeSpooler({ failImage = false, noImage = false } = {}) {
  const images = [];
  const spooler = {
    images,
    listPrinters: async () => PRINTERS,
    printRaw: async () => { throw new Error('RAW must not be used by /print-image'); },
  };
  if (!noImage) {
    spooler.printImage = async (name, data, options) => {
      if (failImage) throw new Error('Cannot print: the printer is not valid');
      images.push({ name, data: Buffer.from(data), options });
    };
  }
  return spooler;
}

async function withAgent(options, fn) {
  const { config, ...spoolerOptions } = options || {};
  const spooler = fakeSpooler(spoolerOptions);
  const logs = [];
  const server = createServer({ spooler, config, log: line => logs.push(line) });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const request = (method, path, { headers = {}, body } = {}) => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path, headers: { Host: `127.0.0.1:${port}`, ...headers }, agent: false }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (error) { /* 204 */ }
        resolve({ status: res.statusCode, headers: res.headers, json });
      });
    });
    req.on('error', reject);
    req.end(body);
  });
  try {
    await fn({ request, spooler, logs });
  } finally {
    await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  }
}

const printImage = (request, query, body, headers) => request('POST', `/print-image?${query}`, { headers: { 'Content-Type': 'image/png', ...headers }, body });

// ---- pure helpers -----------------------------------------------------------------------------------------------------

const parse = query => parseImageQuery(new URLSearchParams(query));
/** A valid query with one parameter replaced (URLSearchParams.get ignores a later duplicate). */
const withParam = (name, value, base = 'printer=P&widthMm=100&heightMm=50&dpi=300') => { const p = new URLSearchParams(base); p.set(name, value); return p.toString(); };

test('parseImageQuery: a valid query gives numbers, defaults (offsets 0, copies 1, paper default)', () => {
  const r = parse(QUERY);
  assert.equal(r.error, undefined);
  assert.deepEqual(r.value, { printer: 'TEC B-EV4', widthMm: 100, heightMm: 50, dpi: 300, offsetXmm: 0, offsetYmm: 0, copies: 1, paper: 'default' });
});

test('parseImageQuery: every option is read (decimals, negative offsets, copies, paper=label)', () => {
  const r = parse('printer=P&widthMm=99.5&heightMm=0.5&dpi=72&offsetXmm=-3.25&offsetYmm=100&copies=99&paper=label');
  assert.deepEqual(r.value, { printer: 'P', widthMm: 99.5, heightMm: 0.5, dpi: 72, offsetXmm: -3.25, offsetYmm: 100, copies: 99, paper: 'label' });
  assert.equal(parse('printer=P&widthMm=1000&heightMm=1000&dpi=1200&offsetXmm=-100').value.widthMm, 1000);
});

test('parseImageQuery: invalid values name the problem', () => {
  const base = 'printer=P&widthMm=100&heightMm=50&dpi=300';
  const bad = [
    ['widthMm=100&heightMm=50&dpi=300', /printer/],
    ['printer=&widthMm=100&heightMm=50&dpi=300', /printer/],
    ['printer=P&heightMm=50&dpi=300', /widthMm/],
    ['printer=P&widthMm=100&dpi=300', /heightMm/],
    ['printer=P&widthMm=100&heightMm=50', /dpi/],
    [withParam('widthMm', '0'), /widthMm/], [withParam('widthMm', '-5'), /widthMm/], [withParam('widthMm', '1000.1'), /widthMm/],
    [withParam('widthMm', 'abc'), /widthMm/], [withParam('widthMm', '1e2'), /widthMm/], [withParam('widthMm', ''), /widthMm/], [withParam('widthMm', 'NaN'), /widthMm/],
    [withParam('heightMm', '1001'), /heightMm/],
    [withParam('dpi', '71'), /dpi/], [withParam('dpi', '1201'), /dpi/], [withParam('dpi', 'x'), /dpi/],
    [withParam('offsetXmm', '100.5'), /offsetXmm/], [withParam('offsetXmm', '-101'), /offsetXmm/], [withParam('offsetYmm', 'z'), /offsetYmm/],
    [withParam('copies', '0'), /copies/], [withParam('copies', '100'), /copies/], [withParam('copies', '1.5'), /copies/], [withParam('copies', '-1'), /copies/],
    [withParam('paper', 'a4'), /paper/], [withParam('paper', ''), /paper/],
  ];
  for (const [query, pattern] of bad) {
    const r = parse(query);
    assert.equal(r.value, undefined, query);
    assert.match(r.error, pattern, query);
  }
});

test('isPng checks the 8-byte signature', () => {
  assert.equal(isPng(png()), true);
  assert.equal(isPng(PNG_SIGNATURE), true);
  assert.equal(isPng(PNG_SIGNATURE.subarray(0, 7)), false);
  assert.equal(isPng(Buffer.from('GIF89a......')), false);
  assert.equal(isPng(Buffer.alloc(0)), false);
  assert.equal(isPng(null), false);
});

test('buildImageEnv: the PowerShell arguments are plain strings, numbers with a dot, nothing interpolated', () => {
  const env = buildImageEnv('He said "hi"; calc $(x) \'', 'C:\\tmp\\a b.png', { widthMm: 99.5, heightMm: 50, dpi: 300, offsetXmm: -3.25, offsetYmm: 0, copies: 2, paper: 'label' });
  assert.deepEqual(env, {
    PB_PRINTER: 'He said "hi"; calc $(x) \'', PB_FILE: 'C:\\tmp\\a b.png', PB_WIDTH_MM: '99.5', PB_HEIGHT_MM: '50', PB_DPI: '300',
    PB_OFFSET_X_MM: '-3.25', PB_OFFSET_Y_MM: '0', PB_COPIES: '2', PB_PAPER: 'label',
  });
});

test('IMAGE_SCRIPT reads everything from the environment, draws in millimetres and disposes', () => {
  for (const name of ['PB_PRINTER', 'PB_FILE', 'PB_WIDTH_MM', 'PB_HEIGHT_MM', 'PB_DPI', 'PB_OFFSET_X_MM', 'PB_OFFSET_Y_MM', 'PB_COPIES', 'PB_PAPER']) {
    assert.ok(IMAGE_SCRIPT.includes(`$env:${name}`), name);
  }
  for (const part of ['PrintDocument', 'FromStream', 'OriginAtMargins = $false', 'Margins', 'GraphicsUnit]::Millimeter', 'NearestNeighbor', 'HasMorePages = $false', 'Dispose()', 'InvariantCulture']) {
    assert.ok(IMAGE_SCRIPT.includes(part), part);
  }
  assert.ok(!/\$\{/.test(IMAGE_SCRIPT));
});

test('IMAGE_SCRIPT parses (Windows PowerShell only)', { skip: process.platform !== 'win32' }, () => {
  const check = '$e = $null; $t = $null; [void][System.Management.Automation.Language.Parser]::ParseInput($env:PB_SCRIPT, [ref]$t, [ref]$e); if ($e.Count -gt 0) { $e | ForEach-Object { $_.Message }; exit 1 }';
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', check], { env: { ...process.env, PB_SCRIPT: IMAGE_SCRIPT }, encoding: 'utf8' });
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
});

test('the Windows spooler printImage refuses to run on another OS', { skip: process.platform === 'win32' }, async () => {
  await assert.rejects(agent.createWindowsSpooler().printImage('x', png(), parse(QUERY).value), /only available on Windows/);
});

// ---- HTTP flow --------------------------------------------------------------------------------------------------------

test('POST /print-image hands the PNG and the parsed options to the spooler as one job', async () => {
  const data = png(1000);
  await withAgent({}, async ({ request, spooler, logs }) => {
    const res = await printImage(request, `${QUERY}&offsetXmm=1.5&offsetYmm=-2&copies=3&paper=label`, data);
    assert.equal(res.status, 200);
    assert.deepEqual(res.json, { ok: true, bytes: data.length, copies: 3 });
    assert.equal(spooler.images.length, 1);
    assert.equal(spooler.images[0].name, 'TEC B-EV4');
    assert.ok(spooler.images[0].data.equals(data));
    assert.deepEqual(spooler.images[0].options, { widthMm: 100, heightMm: 50, dpi: 300, offsetXmm: 1.5, offsetYmm: -2, copies: 3, paper: 'label' });
    assert.equal(logs.length, 1);
    assert.match(logs[0], /print-image printer="TEC B-EV4"/);
  });
});

test('POST /print-image resolves the printer like /print (case-insensitive) and keeps odd names intact', async () => {
  await withAgent({}, async ({ request, spooler }) => {
    const res = await printImage(request, `printer=${encodeURIComponent('hp laserjet "4" pro')}&widthMm=10&heightMm=10&dpi=300`, png());
    assert.equal(res.status, 200);
    assert.equal(spooler.images[0].name, 'HP LaserJet "4" Pro');
  });
});

test('POST /print-image: an unknown printer is printer_not_found 404 and nothing is printed', async () => {
  await withAgent({}, async ({ request, spooler }) => {
    const res = await printImage(request, 'printer=Nope&widthMm=10&heightMm=10&dpi=300', png());
    assert.equal(res.status, 404);
    assert.equal(res.json.error, 'printer_not_found');
    assert.equal(spooler.images.length, 0);
  });
});

test('POST /print-image: invalid numbers are bad_request 400 with a Spanish message, before reading the printer list', async () => {
  await withAgent({}, async ({ request, spooler }) => {
    for (const query of [withParam('widthMm', '0', QUERY), withParam('dpi', '5', QUERY), withParam('copies', '100', QUERY), withParam('paper', 'a4', QUERY), 'widthMm=1&heightMm=1&dpi=300']) {
      const res = await printImage(request, query, png());
      assert.equal(res.status, 400, query);
      assert.equal(res.json.error, 'bad_request', query);
      assert.match(res.json.message, /Petici/);
      assert.ok(res.json.detail, query);
    }
    assert.equal(spooler.images.length, 0);
  });
});

test('POST /print-image: a body that is not a PNG is not_png 415; an empty body is bad_request', async () => {
  await withAgent({}, async ({ request, spooler }) => {
    const jpeg = await printImage(request, QUERY, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6]));
    assert.equal(jpeg.status, 415);
    assert.equal(jpeg.json.error, 'not_png');
    assert.match(jpeg.json.message, /PNG/);
    const tiny = await printImage(request, QUERY, Buffer.from([0x89, 0x50]));
    assert.equal(tiny.json.error, 'not_png');
    const empty = await printImage(request, QUERY, Buffer.alloc(0));
    assert.equal(empty.status, 400);
    assert.equal(empty.json.error, 'bad_request');
    assert.equal(spooler.images.length, 0);
  });
});

test('POST /print-image: the image limit is maxImageBytes (20 MB by default), independent of maxBytes', async () => {
  assert.equal(agent.DEFAULT_CONFIG.maxImageBytes, 20 * 1024 * 1024);
  await withAgent({ config: { maxBytes: 10, maxImageBytes: 100 } }, async ({ request, spooler }) => {
    const ok = await printImage(request, QUERY, png(50));
    assert.equal(ok.status, 200);
    const big = await printImage(request, QUERY, png(200));
    assert.equal(big.status, 413);
    assert.equal(big.json.error, 'too_large');
    assert.equal(spooler.images.length, 1);
  });
});

test('POST /print-image: a PowerShell / driver failure is spooler_error 502 with the sanitized detail', async () => {
  await withAgent({ failImage: true }, async ({ request, logs }) => {
    const res = await printImage(request, QUERY, png());
    assert.equal(res.status, 502);
    assert.equal(res.json.error, 'spooler_error');
    assert.match(res.json.detail, /not valid/);
    assert.match(logs[0], /print-image FAILED/);
  });
});

test('POST /print-image: a spooler without printImage is a spooler_error, not a crash', async () => {
  await withAgent({ noImage: true }, async ({ request }) => {
    const res = await printImage(request, QUERY, png());
    assert.equal(res.status, 502);
    assert.equal(res.json.error, 'spooler_error');
  });
});

test('POST /print-image: GET is method_not_allowed 405; a refused Origin is origin_refused 403', async () => {
  await withAgent({}, async ({ request, spooler }) => {
    const get = await request('GET', '/print-image');
    assert.equal(get.status, 405);
    assert.equal(get.json.error, 'method_not_allowed');
    const evil = await printImage(request, QUERY, png(), { Origin: 'https://evil.example' });
    assert.equal(evil.status, 403);
    assert.equal(evil.json.error, 'origin_refused');
    assert.equal(spooler.images.length, 0);
  });
});

test('POST /print-image: an allowed Origin gets the CORS headers; the preflight allows POST and Content-Type', async () => {
  await withAgent({}, async ({ request }) => {
    const origin = 'https://danielvl1982.github.io';
    const res = await printImage(request, QUERY, png(), { Origin: origin });
    assert.equal(res.status, 200);
    assert.equal(res.headers['access-control-allow-origin'], origin);
    const pre = await request('OPTIONS', '/print-image', { headers: { Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' } });
    assert.equal(pre.status, 204);
    assert.equal(pre.headers['access-control-allow-origin'], origin);
    assert.match(pre.headers['access-control-allow-methods'], /POST/);
    assert.match(pre.headers['access-control-allow-headers'], /Content-Type/i);
    assert.equal(pre.headers['access-control-allow-private-network'], 'true');
  });
});

test('config: maxImageBytes is validated', () => {
  assert.equal(agent.normalizeConfig({ maxImageBytes: 1234 }).maxImageBytes, 1234);
  for (const bad of [0, -1, 1.5, '5']) assert.throws(() => agent.normalizeConfig({ maxImageBytes: bad }), /"maxImageBytes"/);
});
