const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createServer, VERSION } = require('../agent/printbridge-agent.js');

// The print agent (agent/printbridge-agent.js) against a fake spooler on an ephemeral port: protocol, limits, origins, preflight.

const PRINTERS = [
  { name: 'TEC B-EV4', isDefault: true, status: 'ready' },
  { name: 'Zebra "ZD" 420', isDefault: false, status: 'offline' },
];

function fakeSpooler({ printers = PRINTERS, failList = false, failPrint = false } = {}) {
  const jobs = [];
  return {
    jobs,
    listPrinters: async () => { if (failList) throw new Error('list boom'); return printers; },
    printRaw: async (name, data) => { if (failPrint) throw new Error('print boom'); jobs.push({ name, data: Buffer.from(data) }); },
  };
}

/** Starts the agent on port 0 with a fake spooler; runs fn({ request, spooler, logs }); always closes the server. */
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
        const raw = Buffer.concat(chunks);
        let json = null;
        try { json = JSON.parse(raw.toString('utf8')); } catch (error) { /* not JSON (204) */ }
        resolve({ status: res.statusCode, headers: res.headers, json, raw });
      });
    });
    req.on('error', reject);
    req.end(body);
  });
  try {
    await fn({ request, spooler, logs, port });
  } finally {
    await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  }
}

const print = (request, query, body, headers) => request('POST', `/print?${query}`, { headers: { 'Content-Type': 'application/octet-stream', ...headers }, body });

test('GET /health answers ok, the version and the platform', async () => {
  await withAgent({}, async ({ request }) => {
    const res = await request('GET', '/health');
    assert.equal(res.status, 200);
    assert.deepEqual(res.json, { ok: true, version: VERSION, platform: process.platform });
  });
});

test('GET /printers lists what the spooler reports', async () => {
  await withAgent({}, async ({ request }) => {
    const res = await request('GET', '/printers');
    assert.equal(res.status, 200);
    assert.deepEqual(res.json, { printers: PRINTERS });
  });
});

test('GET /printers: a failing spooler is a spooler_error 502', async () => {
  await withAgent({ failList: true }, async ({ request }) => {
    const res = await request('GET', '/printers');
    assert.equal(res.status, 502);
    assert.equal(res.json.ok, false);
    assert.equal(res.json.error, 'spooler_error');
    assert.match(res.json.message, /impresi/i);
  });
});

test('POST /print sends the bytes untouched (0x00, 0x0D, 0x0A, 0xFF) as one job', async () => {
  const data = Buffer.from([0x53, 0x49, 0x5A, 0x45, 0x0D, 0x0A, 0x00, 0xFF, 0x80, 0x0D, 0x00, 0x0A]);
  await withAgent({}, async ({ request, spooler }) => {
    const res = await print(request, 'printer=TEC%20B-EV4', data);
    assert.equal(res.status, 200);
    assert.deepEqual(res.json, { ok: true, bytes: data.length, copies: 1 });
    assert.equal(spooler.jobs.length, 1);
    assert.equal(spooler.jobs[0].name, 'TEC B-EV4');
    assert.ok(spooler.jobs[0].data.equals(data));
  });
});

test('POST /print: a big body (1 MB of every byte value) arrives byte-exact', async () => {
  const data = Buffer.alloc(1024 * 1024);
  for (let i = 0; i < data.length; i++) data[i] = i % 256;
  await withAgent({}, async ({ request, spooler }) => {
    const res = await print(request, 'printer=TEC%20B-EV4', data);
    assert.equal(res.status, 200);
    assert.equal(res.json.bytes, data.length);
    assert.ok(spooler.jobs[0].data.equals(data));
  });
});

test('POST /print: copies repeat the data N times inside ONE job', async () => {
  const data = Buffer.from([0x01, 0x0D, 0x00, 0xFF]);
  await withAgent({}, async ({ request, spooler }) => {
    const res = await print(request, 'printer=TEC%20B-EV4&copies=3', data);
    assert.deepEqual(res.json, { ok: true, bytes: 4, copies: 3 });
    assert.equal(spooler.jobs.length, 1);
    assert.ok(spooler.jobs[0].data.equals(Buffer.concat([data, data, data])));
  });
});

test('POST /print: copies 1 and 99 are the limits', async () => {
  await withAgent({}, async ({ request, spooler }) => {
    assert.equal((await print(request, 'printer=TEC%20B-EV4&copies=1', Buffer.from('A'))).status, 200);
    const res = await print(request, 'printer=TEC%20B-EV4&copies=99', Buffer.from('A'));
    assert.equal(res.status, 200);
    assert.equal(spooler.jobs[1].data.length, 99);
  });
});

test('POST /print: bad copies (0, 100, -1, 1.5, abc, empty) are bad_request 400 and print nothing', async () => {
  await withAgent({}, async ({ request, spooler }) => {
    for (const copies of ['0', '100', '-1', '1.5', 'abc', '', '1e1']) {
      const res = await print(request, `printer=TEC%20B-EV4&copies=${copies}`, Buffer.from('A'));
      assert.equal(res.status, 400, `copies=${copies}`);
      assert.equal(res.json.error, 'bad_request');
    }
    assert.equal(spooler.jobs.length, 0);
  });
});

test('POST /print: a missing printer or an empty body is bad_request 400', async () => {
  await withAgent({}, async ({ request, spooler }) => {
    assert.equal((await print(request, 'copies=1', Buffer.from('A'))).json.error, 'bad_request');
    assert.equal((await print(request, 'printer=TEC%20B-EV4', Buffer.alloc(0))).json.error, 'bad_request');
    assert.equal(spooler.jobs.length, 0);
  });
});

test('POST /print: an unknown printer is printer_not_found 404', async () => {
  await withAgent({}, async ({ request, spooler }) => {
    const res = await print(request, 'printer=Nope', Buffer.from('A'));
    assert.equal(res.status, 404);
    assert.equal(res.json.error, 'printer_not_found');
    assert.equal(spooler.jobs.length, 0);
  });
});

test('POST /print: printer names with quotes, spaces and accents are matched exactly (and case-insensitively as a fallback)', async () => {
  await withAgent({ printers: [{ name: 'Zebra "ZD" 420', isDefault: false, status: 'ready' }, { name: 'Etiquetas ñ', isDefault: false, status: 'ready' }] }, async ({ request, spooler }) => {
    assert.equal((await print(request, `printer=${encodeURIComponent('Zebra "ZD" 420')}`, Buffer.from('A'))).status, 200);
    assert.equal((await print(request, `printer=${encodeURIComponent('etiquetas Ñ')}`, Buffer.from('A'))).status, 200);
    assert.deepEqual(spooler.jobs.map(j => j.name), ['Zebra "ZD" 420', 'Etiquetas ñ']);
  });
});

test('POST /print: a body over maxBytes is too_large 413, declared or not', async () => {
  await withAgent({ config: { maxBytes: 100 } }, async ({ request, spooler }) => {
    const res = await print(request, 'printer=TEC%20B-EV4', Buffer.alloc(101, 0x41));
    assert.equal(res.status, 413);
    assert.equal(res.json.error, 'too_large');
    assert.equal((await print(request, 'printer=TEC%20B-EV4', Buffer.alloc(100, 0x41))).status, 200);
    assert.equal(spooler.jobs.length, 1);
  });
});

test('POST /print: the default limit is 5 MB', async () => {
  await withAgent({}, async ({ request, spooler }) => {
    assert.equal((await print(request, 'printer=TEC%20B-EV4', Buffer.alloc(5 * 1024 * 1024, 0x41))).status, 200);
    assert.equal(spooler.jobs[0].data.length, 5 * 1024 * 1024);
    // Over the limit by one byte: refused before anything is read (the declared Content-Length)
    const over = await request('POST', '/print?printer=TEC%20B-EV4', { headers: { 'Content-Length': String(5 * 1024 * 1024 + 1) } });
    assert.equal(over.status, 413);
  });
});

test('POST /print: a spooler failure is spooler_error 502 and the data is not logged', async () => {
  await withAgent({ failPrint: true }, async ({ request, logs }) => {
    const res = await print(request, 'printer=TEC%20B-EV4', Buffer.from('SECRET-LABEL'));
    assert.equal(res.status, 502);
    assert.equal(res.json.error, 'spooler_error');
    assert.ok(logs.length >= 1);
    assert.ok(logs.every(line => !line.includes('SECRET-LABEL')));
  });
});

test('POST /print logs one line per print: time, printer, bytes and copies, never the data', async () => {
  await withAgent({}, async ({ request, logs }) => {
    await print(request, 'printer=TEC%20B-EV4&copies=2', Buffer.from('SECRET-LABEL'));
    assert.equal(logs.length, 1);
    assert.match(logs[0], /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d print printer="TEC B-EV4" bytes=12 copies=2$/);
  });
});

test('unknown route is 404 and a wrong method is 405, both JSON', async () => {
  await withAgent({}, async ({ request }) => {
    const missing = await request('GET', '/nope');
    assert.equal(missing.status, 404);
    assert.equal(missing.json.ok, false);
    assert.equal((await request('POST', '/health')).status, 405);
    assert.equal((await request('GET', '/print?printer=x')).status, 405);
  });
});

// ---- Origins ---------------------------------------------------------------------------------------------------------

const ALLOWED = [
  'https://danielvl1982.github.io', 'http://localhost', 'http://localhost:8080', 'http://localhost:5500',
  'http://127.0.0.1', 'http://127.0.0.1:3000',
];
const REFUSED = [
  'https://evil.example', 'http://danielvl1982.github.io', 'https://danielvl1982.github.io:8443', 'https://danielvl1982.github.io.evil.example',
  'https://localhost', 'http://localhost.evil.example', 'http://127.0.0.2', 'http://evil.example:80', 'null-ish', '',
];

test('allowed origins get the exact origin echoed back (never *) and Vary: Origin', async () => {
  await withAgent({}, async ({ request }) => {
    for (const origin of ALLOWED) {
      const res = await request('GET', '/health', { headers: { Origin: origin } });
      assert.equal(res.status, 200, origin);
      assert.equal(res.headers['access-control-allow-origin'], origin);
      assert.equal(res.headers.vary, 'Origin');
    }
  });
});

test('refused origins get origin_refused 403 without CORS headers, on GET and POST', async () => {
  await withAgent({}, async ({ request, spooler }) => {
    for (const origin of REFUSED) {
      const res = await request('GET', '/printers', { headers: { Origin: origin } });
      assert.equal(res.status, 403, origin);
      assert.equal(res.json.error, 'origin_refused');
      assert.equal(res.headers['access-control-allow-origin'], undefined);
      const post = await print(request, 'printer=TEC%20B-EV4', Buffer.from('A'), { Origin: origin });
      assert.equal(post.status, 403, origin);
    }
    assert.equal(spooler.jobs.length, 0);
  });
});

test('a request without Origin (curl on this machine) is allowed', async () => {
  await withAgent({}, async ({ request }) => {
    const res = await request('GET', '/health');
    assert.equal(res.status, 200);
    assert.equal(res.headers['access-control-allow-origin'], undefined);
  });
});

test('the null origin (file://) is refused by default and allowed with allowFileOrigin', async () => {
  await withAgent({}, async ({ request }) => {
    const res = await request('GET', '/health', { headers: { Origin: 'null' } });
    assert.equal(res.status, 403);
    assert.equal(res.json.error, 'origin_refused');
  });
  await withAgent({ config: { allowFileOrigin: true } }, async ({ request }) => {
    const res = await request('GET', '/health', { headers: { Origin: 'null' } });
    assert.equal(res.status, 200);
    assert.equal(res.headers['access-control-allow-origin'], 'null');
    const pre = await request('OPTIONS', '/print', { headers: { Origin: 'null', 'Access-Control-Request-Method': 'POST' } });
    assert.equal(pre.status, 204);
  });
});

test('custom allowedOrigins replace the defaults; a port in an entry is exact', async () => {
  await withAgent({ config: { allowedOrigins: ['https://labels.example', 'http://localhost:4000'] } }, async ({ request }) => {
    assert.equal((await request('GET', '/health', { headers: { Origin: 'https://labels.example' } })).status, 200);
    assert.equal((await request('GET', '/health', { headers: { Origin: 'http://localhost:4000' } })).status, 200);
    assert.equal((await request('GET', '/health', { headers: { Origin: 'http://localhost:4001' } })).status, 403);
    assert.equal((await request('GET', '/health', { headers: { Origin: 'https://danielvl1982.github.io' } })).status, 403);
  });
});

// ---- Preflight -------------------------------------------------------------------------------------------------------

test('the preflight of an allowed origin carries methods, headers, Private-Network and Vary', async () => {
  await withAgent({}, async ({ request, spooler }) => {
    const res = await request('OPTIONS', '/print?printer=x', {
      headers: {
        Origin: 'https://danielvl1982.github.io', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type',
        'Access-Control-Request-Private-Network': 'true',
      },
    });
    assert.equal(res.status, 204);
    assert.equal(res.headers['access-control-allow-origin'], 'https://danielvl1982.github.io');
    assert.match(res.headers['access-control-allow-methods'], /POST/);
    assert.match(res.headers['access-control-allow-methods'], /GET/);
    assert.match(res.headers['access-control-allow-headers'], /Content-Type/i);
    assert.equal(res.headers['access-control-allow-private-network'], 'true');
    assert.equal(res.headers.vary, 'Origin');
    assert.equal(spooler.jobs.length, 0);
  });
});

test('the preflight of a refused origin is origin_refused 403', async () => {
  await withAgent({}, async ({ request }) => {
    const res = await request('OPTIONS', '/print', { headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST' } });
    assert.equal(res.status, 403);
    assert.equal(res.headers['access-control-allow-origin'], undefined);
    assert.equal(res.headers['access-control-allow-private-network'], undefined);
  });
});

// ---- Host header (DNS rebinding) ----------------------------------------------------------------------------------------

test('a Host header that is not 127.0.0.1 / localhost is refused (DNS rebinding)', async () => {
  await withAgent({}, async ({ request }) => {
    for (const host of ['evil.example', 'evil.example:9631', '192.168.1.5:9631', '127.0.0.1.evil.example', 'localhost.evil.example:80']) {
      const res = await request('GET', '/health', { headers: { Host: host } });
      assert.equal(res.status, 403, host);
      assert.equal(res.json.error, 'origin_refused');
    }
    for (const host of ['127.0.0.1', '127.0.0.1:9631', 'localhost', 'localhost:9631', 'LOCALHOST:9631']) {
      assert.equal((await request('GET', '/health', { headers: { Host: host } })).status, 200, host);
    }
  });
});

test('a rebinding page is refused even when its Origin looks fine and the Host is its own name', async () => {
  await withAgent({}, async ({ request }) => {
    const res = await request('GET', '/printers', { headers: { Host: 'rebind.example:9631', Origin: 'http://rebind.example:9631' } });
    assert.equal(res.status, 403);
  });
});

test('createServer refuses a spooler without the two methods', () => {
  assert.throws(() => createServer({ spooler: {}, config: {} }), /spooler/);
  assert.throws(() => createServer({ config: {} }), /spooler/);
});
