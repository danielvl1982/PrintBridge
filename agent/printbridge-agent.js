#!/usr/bin/env node
/**
 * PrintBridge print agent: a tiny local HTTP service that sends the bytes of a label to a Windows printer as RAW data.
 * A web page cannot talk to a USB label printer in RAW mode by itself; this agent does it on its behalf.
 *
 * Node >= 18, CommonJS, zero npm dependencies. Windows is the target (the spooler is reached through PowerShell and winspool.drv),
 * but the HTTP protocol is independent of it: createServer({ spooler, config }) takes the spooler as an injected interface
 *   { listPrinters(): Promise<[{ name, isDefault, status }]>, printRaw(printerName, Buffer): Promise<void>,
 *     printImage?(printerName, pngBuffer, { widthMm, heightMm, dpi, offsetXmm, offsetYmm, copies, paper }): Promise<void> }
 * so the tests run it against a fake on any OS.
 *
 * HTTP API (127.0.0.1 only, default port 9631):
 *   GET  /health                              -> { ok, version, platform }
 *   GET  /printers                            -> { printers: [{ name, isDefault, status }] }
 *   POST /print?printer=<name>&copies=<1..99> -> body = raw bytes (application/octet-stream) -> { ok: true, bytes, copies }
 *   POST /print-image?printer=<name>&widthMm=&heightMm=&dpi=[&offsetXmm=&offsetYmm=&copies=&paper=label|default]
 *                                             -> body = PNG (image/png), printed through the driver -> { ok: true, bytes, copies }
 *   errors: { ok: false, error: <code>, message: <Spanish text> } with the codes
 *     origin_refused 403, printer_not_found 404, too_large 413, bad_request 400, not_png 415, spooler_error 502
 *     (plus not_found 404 / method_not_allowed 405 for unknown routes)
 * Copies are the data repeated N times inside ONE spooler job. The label data is never logged.
 * Run it with `node agent/printbridge-agent.js [--config <file>]`.
 */
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const VERSION = '1.0.0';
const HOST = '127.0.0.1';
const MAX_COPIES = 99;
/** Upper bound of the repeated data of one job (body x copies), whatever maxBytes says. */
const MAX_JOB_BYTES = 100 * 1024 * 1024;
const POWERSHELL_TIMEOUT_MS = 60000;

const DEFAULT_CONFIG = Object.freeze({
  port: 9631,
  allowedOrigins: Object.freeze(['https://danielvl1982.github.io', 'http://localhost', 'http://127.0.0.1']),
  allowFileOrigin: false,
  maxBytes: 5 * 1024 * 1024,
  maxImageBytes: 20 * 1024 * 1024,
});

// ---------------------------------------------------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------------------------------------------------

/** Merges a parsed config object over the defaults; throws Error('Invalid config: ...') on a wrong type or value. */
function normalizeConfig(raw) {
  if (raw === undefined || raw === null) raw = {};
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid config: the file must contain a JSON object');
  const config = { ...DEFAULT_CONFIG, allowedOrigins: [...DEFAULT_CONFIG.allowedOrigins] };
  if (raw.port !== undefined) {
    if (!Number.isInteger(raw.port) || raw.port < 0 || raw.port > 65535) throw new Error('Invalid config: "port" must be an integer between 0 and 65535');
    config.port = raw.port;
  }
  if (raw.allowedOrigins !== undefined) {
    if (!Array.isArray(raw.allowedOrigins) || raw.allowedOrigins.some(o => typeof o !== 'string' || o.trim() === '')) {
      throw new Error('Invalid config: "allowedOrigins" must be an array of origin strings');
    }
    config.allowedOrigins = raw.allowedOrigins.map(o => o.trim().replace(/\/+$/, ''));
  }
  if (raw.allowFileOrigin !== undefined) {
    if (typeof raw.allowFileOrigin !== 'boolean') throw new Error('Invalid config: "allowFileOrigin" must be true or false');
    config.allowFileOrigin = raw.allowFileOrigin;
  }
  if (raw.maxBytes !== undefined) {
    if (!Number.isInteger(raw.maxBytes) || raw.maxBytes < 1) throw new Error('Invalid config: "maxBytes" must be a positive integer');
    config.maxBytes = raw.maxBytes;
  }
  if (raw.maxImageBytes !== undefined) {
    if (!Number.isInteger(raw.maxImageBytes) || raw.maxImageBytes < 1) throw new Error('Invalid config: "maxImageBytes" must be a positive integer');
    config.maxImageBytes = raw.maxImageBytes;
  }
  return config;
}

/** Reads a config file. A missing file means the defaults; an unreadable or invalid one throws a clear Error. */
function loadConfig(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return normalizeConfig({});
    throw new Error(`Cannot read the config file ${file}: ${error.message}`);
  }
  let raw;
  try {
    raw = JSON.parse(text.replace(/^﻿/, ''));
  } catch (error) {
    throw new Error(`The config file ${file} is not valid JSON: ${error.message}`);
  }
  try {
    return normalizeConfig(raw);
  } catch (error) {
    throw new Error(`${error.message} (${file})`);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Origin and Host checks
// ---------------------------------------------------------------------------------------------------------------------

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost']);

/**
 * Is this Origin header value allowed? An entry for http://localhost or http://127.0.0.1 without a port accepts any port;
 * every other entry must match exactly. The `null` origin (file://) needs allowFileOrigin.
 */
function isOriginAllowed(origin, config) {
  if (origin === 'null') return config.allowFileOrigin === true;
  let given;
  try { given = new URL(origin); } catch (error) { return false; }
  if (given.origin === 'null' || given.origin !== origin.replace(/\/+$/, '')) return false;
  return config.allowedOrigins.some(entry => {
    let allowed;
    try { allowed = new URL(entry); } catch (error) { return false; }
    const anyPort = allowed.protocol === 'http:' && LOCAL_HOSTS.has(allowed.hostname) && allowed.port === '' && !/:\d+$/.test(entry);
    if (anyPort) return given.protocol === allowed.protocol && given.hostname === allowed.hostname;
    return given.origin === allowed.origin;
  });
}

/** Host header without the port; only the loopback names pass (a DNS rebinding page would carry its own name). */
function isHostAllowed(hostHeader) {
  if (typeof hostHeader !== 'string' || hostHeader === '') return false;
  const match = /^(\[[^\]]*\]|[^:]*)(?::\d+)?$/.exec(hostHeader.trim().toLowerCase());
  return !!match && LOCAL_HOSTS.has(match[1]);
}

// ---------------------------------------------------------------------------------------------------------------------
// Windows spooler (PowerShell + winspool.drv). The printer name and the data file travel in environment variables, never
// inside the command text, so a name with quotes or spaces cannot break or inject anything.
// ---------------------------------------------------------------------------------------------------------------------

const LIST_SCRIPT = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$printers = @(Get-CimInstance Win32_Printer | Select-Object Name,Default,PrinterStatus,WorkOffline)
ConvertTo-Json -InputObject $printers -Compress
`;

const PRINT_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class PbRawPrinter {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public class DOCINFO {
    [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
  }
  [DllImport("winspool.drv", EntryPoint = "OpenPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern bool OpenPrinter(string name, out IntPtr handle, IntPtr defaults);
  [DllImport("winspool.drv", EntryPoint = "StartDocPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern int StartDocPrinter(IntPtr handle, int level, [In] DOCINFO info);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool StartPagePrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool WritePrinter(IntPtr handle, byte[] data, int count, out int written);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool EndPagePrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool EndDocPrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool ClosePrinter(IntPtr handle);

  static void Check(bool ok) { if (!ok) throw new Win32Exception(Marshal.GetLastWin32Error()); }

  public static void Send(string printer, byte[] data) {
    IntPtr handle;
    Check(OpenPrinter(printer, out handle, IntPtr.Zero));
    try {
      DOCINFO info = new DOCINFO();
      info.pDocName = "PrintBridge";
      info.pDataType = "RAW";
      Check(StartDocPrinter(handle, 1, info) > 0);
      try {
        Check(StartPagePrinter(handle));
        int written;
        Check(WritePrinter(handle, data, data.Length, out written));
        if (written != data.Length) throw new Exception("Only " + written + " of " + data.Length + " bytes were written");
        Check(EndPagePrinter(handle));
      } finally {
        EndDocPrinter(handle);
      }
    } finally {
      ClosePrinter(handle);
    }
  }
}
'@
$bytes = [System.IO.File]::ReadAllBytes($env:PB_FILE)
[PbRawPrinter]::Send($env:PB_PRINTER, $bytes)
`;

/**
 * Prints a PNG through the printer driver with System.Drawing.Printing.PrintDocument. Everything variable travels in
 * environment variables (PB_PRINTER, PB_FILE, PB_WIDTH_MM, PB_HEIGHT_MM, PB_DPI, PB_OFFSET_X_MM, PB_OFFSET_Y_MM, PB_COPIES,
 * PB_PAPER), never inside the command text. Numbers arrive with a dot and are parsed with the invariant culture.
 * The image is drawn in millimetres at (offsetX, offsetY) with width x height: 100 % scale, never fitted to the page.
 * Interpolation: NearestNeighbor when the PNG was rendered at the printer resolution or finer (keeps barcode bars sharp, no blur);
 * HighQualityBicubic only when the PNG has fewer dots than the printer (an upscale, where nearest neighbour would make uneven bars).
 */
const IMAGE_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$inv = [System.Globalization.CultureInfo]::InvariantCulture
$script:widthMm = [double]::Parse($env:PB_WIDTH_MM, $inv)
$script:heightMm = [double]::Parse($env:PB_HEIGHT_MM, $inv)
$script:imageDpi = [double]::Parse($env:PB_DPI, $inv)
$script:offsetX = [double]::Parse($env:PB_OFFSET_X_MM, $inv)
$script:offsetY = [double]::Parse($env:PB_OFFSET_Y_MM, $inv)
$copies = [int]$env:PB_COPIES
$script:pbError = $null
$stream = $null
$script:image = $null
$doc = $null
try {
  $bytes = [System.IO.File]::ReadAllBytes($env:PB_FILE)
  $stream = New-Object System.IO.MemoryStream (,$bytes)
  $script:image = [System.Drawing.Image]::FromStream($stream)
  $doc = New-Object System.Drawing.Printing.PrintDocument
  $doc.PrinterSettings.PrinterName = $env:PB_PRINTER
  if (-not $doc.PrinterSettings.IsValid) { throw 'The printer is not valid' }
  $doc.PrinterSettings.Copies = [int16]$copies
  $doc.DocumentName = 'PrintBridge'
  $doc.OriginAtMargins = $false
  $doc.DefaultPageSettings.Margins = New-Object System.Drawing.Printing.Margins 0, 0, 0, 0
  if ($env:PB_PAPER -eq 'label') {
    $paperW = [int][Math]::Round($script:widthMm / 25.4 * 100)
    $paperH = [int][Math]::Round($script:heightMm / 25.4 * 100)
    $doc.DefaultPageSettings.PaperSize = New-Object System.Drawing.Printing.PaperSize 'PrintBridge label', $paperW, $paperH
  }
  $doc.add_PrintPage({
    param($sender, $e)
    try {
      $g = $e.Graphics
      if ($script:imageDpi -ge ($g.DpiX - 0.5)) {
        $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
      } else {
        $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      }
      $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::Half
      $g.PageUnit = [System.Drawing.GraphicsUnit]::Millimeter
      $g.DrawImage($script:image, [single]$script:offsetX, [single]$script:offsetY, [single]$script:widthMm, [single]$script:heightMm)
      $e.HasMorePages = $false
    } catch {
      $script:pbError = $_.Exception.Message
      $e.Cancel = $true
    }
  })
  $doc.Print()
  if ($script:pbError) { throw $script:pbError }
} finally {
  if ($doc) { $doc.Dispose() }
  if ($script:image) { $script:image.Dispose() }
  if ($stream) { $stream.Dispose() }
}
`;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MAX_SIZE_MM = 1000;
const MAX_OFFSET_MM = 100;

/** Does the buffer start with the 8-byte PNG signature? Exported for the tests. */
function isPng(buffer) {
  return Buffer.isBuffer(buffer) && buffer.length >= PNG_SIGNATURE.length && buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE);
}

/**
 * Validates the query of POST /print-image. Returns { value: { printer, widthMm, heightMm, dpi, offsetXmm, offsetYmm, copies, paper } }
 * or { error: <English detail> }. Pure: no printer, no PowerShell. Exported for the tests.
 */
function parseImageQuery(params) {
  const printer = params.get('printer');
  if (!printer) return { error: 'Missing "printer"' };
  const number = (name, { min, max, minExclusive = false, required = false, fallback = 0, integer = false }) => {
    if (!params.has(name)) return required ? { error: `Missing "${name}"` } : { number: fallback };
    const text = params.get(name);
    const valid = (integer ? /^\d{1,3}$/ : /^-?\d{1,6}(\.\d{1,6})?$/).test(text);
    const n = valid ? Number(text) : NaN;
    if (!(n >= min && n <= max) || (minExclusive && n === min)) {
      return { error: `"${name}" must be a number ${minExclusive ? 'greater than' : 'from'} ${min}${minExclusive ? ' and up to' : ' to'} ${max}` };
    }
    return { number: n };
  };
  const specs = {
    widthMm: { min: 0, max: MAX_SIZE_MM, minExclusive: true, required: true },
    heightMm: { min: 0, max: MAX_SIZE_MM, minExclusive: true, required: true },
    dpi: { min: 72, max: 1200, required: true },
    offsetXmm: { min: -MAX_OFFSET_MM, max: MAX_OFFSET_MM },
    offsetYmm: { min: -MAX_OFFSET_MM, max: MAX_OFFSET_MM },
    copies: { min: 1, max: MAX_COPIES, fallback: 1, integer: true },
  };
  const value = { printer };
  for (const name of Object.keys(specs)) {
    const r = number(name, specs[name]);
    if (r.error) return { error: r.error };
    value[name] = r.number;
  }
  const paper = params.has('paper') ? params.get('paper') : 'default';
  if (paper !== 'label' && paper !== 'default') return { error: '"paper" must be "label" or "default"' };
  value.paper = paper;
  return { value: { printer, widthMm: value.widthMm, heightMm: value.heightMm, dpi: value.dpi, offsetXmm: value.offsetXmm, offsetYmm: value.offsetYmm, copies: value.copies, paper } };
}

/** The environment variables IMAGE_SCRIPT reads. Numbers are formatted with a dot, whatever the locale. Exported for the tests. */
function buildImageEnv(printerName, file, options) {
  return {
    PB_PRINTER: printerName,
    PB_FILE: file,
    PB_WIDTH_MM: String(options.widthMm),
    PB_HEIGHT_MM: String(options.heightMm),
    PB_DPI: String(options.dpi),
    PB_OFFSET_X_MM: String(options.offsetXmm),
    PB_OFFSET_Y_MM: String(options.offsetYmm),
    PB_COPIES: String(options.copies),
    PB_PAPER: options.paper,
  };
}

/** PrinterStatus codes of Win32_Printer, as short words. */
const STATUS_NAMES = { 3: 'ready', 4: 'printing', 5: 'warming-up', 6: 'stopped', 7: 'offline' };

/** Turns the Win32_Printer JSON into [{ name, isDefault, status }]. Exported for the tests. */
function parsePrinterList(json) {
  const text = String(json).trim();
  if (text === '') return [];
  const parsed = JSON.parse(text);
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  return rows
    .filter(row => row && typeof row.Name === 'string' && row.Name !== '')
    .map(row => ({
      name: row.Name,
      isDefault: row.Default === true,
      status: row.WorkOffline === true ? 'offline' : (STATUS_NAMES[row.PrinterStatus] || 'unknown'),
    }));
}

/** Runs a PowerShell script (passed encoded, so no quoting issues) and resolves with its stdout. */
function runPowerShell(script, env = {}) {
  return new Promise((resolve, reject) => {
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const out = [];
    const err = [];
    let settled = false;
    const finish = (fn, value) => { if (!settled) { settled = true; clearTimeout(timer); fn(value); } };
    const timer = setTimeout(() => { child.kill(); finish(reject, new Error('PowerShell timed out')); }, POWERSHELL_TIMEOUT_MS);
    child.stdout.on('data', chunk => out.push(chunk));
    child.stderr.on('data', chunk => err.push(chunk));
    child.on('error', error => finish(reject, error));
    child.on('close', code => {
      if (code === 0) finish(resolve, Buffer.concat(out).toString('utf8'));
      else finish(reject, new Error((Buffer.concat(err).toString('utf8').trim() || `PowerShell exited with code ${code}`).slice(0, 500)));
    });
  });
}

/** The default spooler: lists printers with Win32_Printer and writes RAW jobs through winspool.drv. */
function createWindowsSpooler() {
  const requireWindows = () => {
    if (process.platform !== 'win32') return Promise.reject(new Error('The Windows spooler is only available on Windows'));
    return null;
  };
  return {
    listPrinters() {
      return requireWindows() || runPowerShell(LIST_SCRIPT).then(parsePrinterList);
    },
    async printRaw(printerName, data) {
      const unsupported = requireWindows();
      if (unsupported) return unsupported;
      const file = path.join(os.tmpdir(), `printbridge-${crypto.randomBytes(8).toString('hex')}.bin`);
      fs.writeFileSync(file, data);
      try {
        await runPowerShell(PRINT_SCRIPT, { PB_PRINTER: printerName, PB_FILE: file });
      } finally {
        try { fs.unlinkSync(file); } catch (error) { /* already gone */ }
      }
    },
    async printImage(printerName, data, options) {
      const unsupported = requireWindows();
      if (unsupported) return unsupported;
      const file = path.join(os.tmpdir(), `printbridge-${crypto.randomBytes(8).toString('hex')}.png`);
      fs.writeFileSync(file, data);
      try {
        await runPowerShell(IMAGE_SCRIPT, buildImageEnv(printerName, file, options));
      } finally {
        try { fs.unlinkSync(file); } catch (error) { /* already gone */ }
      }
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------------------------------------------------

const MESSAGES = {
  origin_refused: 'Origen no permitido: la petición no viene de una página autorizada',
  printer_not_found: 'La impresora no existe en este equipo',
  too_large: 'Los datos son demasiado grandes',
  bad_request: 'Petición no válida',
  not_png: 'La imagen no es un PNG válido',
  spooler_error: 'El sistema de impresión no pudo completar la operación',
  not_found: 'Ruta no encontrada',
  method_not_allowed: 'Método no permitido',
};

function stamp() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** Reads the request body up to `limit` bytes; resolves { body } or { tooLarge: true } as soon as the limit is passed. */
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let done = false;
    req.on('data', chunk => {
      if (done) return;
      size += chunk.length;
      if (size > limit) { done = true; resolve({ tooLarge: true }); return; }
      chunks.push(chunk);
    });
    req.on('end', () => { if (!done) { done = true; resolve({ body: Buffer.concat(chunks) }); } });
    req.on('error', error => { if (!done) { done = true; reject(error); } });
  });
}

/** Builds (without listening) the agent's http.Server. `log(line)` defaults to console.log. */
function createServer({ spooler, config: rawConfig, log = line => console.log(line) } = {}) {
  const config = normalizeConfig(rawConfig);
  if (!spooler || typeof spooler.listPrinters !== 'function' || typeof spooler.printRaw !== 'function') {
    throw new Error('createServer needs a spooler with listPrinters() and printRaw()');
  }

  function send(res, status, payload, headers = {}) {
    const body = Buffer.from(JSON.stringify(payload));
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': body.length, 'Cache-Control': 'no-store', ...headers });
    res.end(body);
  }

  function fail(res, status, error, headers, detail) {
    const payload = { ok: false, error, message: MESSAGES[error] };
    if (detail) payload.detail = String(detail).slice(0, 300);
    send(res, status, payload, headers);
  }

  async function handle(req, res) {
    const origin = req.headers.origin;
    if (!isHostAllowed(req.headers.host)) return fail(res, 403, 'origin_refused', { Connection: 'close' });
    let cors = {};
    if (origin !== undefined) {
      if (!isOriginAllowed(origin, config)) return fail(res, 403, 'origin_refused', { Connection: 'close' });
      cors = { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' };
    }

    const url = new URL(req.url, `http://${HOST}`);
    if (req.method === 'OPTIONS') {
      const preflight = origin === undefined ? {} : {
        ...cors,
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Private-Network': 'true',
        'Access-Control-Max-Age': '600',
      };
      res.writeHead(204, { ...preflight, 'Content-Length': 0 });
      return res.end();
    }

    if (url.pathname === '/health') {
      if (req.method !== 'GET') return fail(res, 405, 'method_not_allowed', cors);
      return send(res, 200, { ok: true, version: VERSION, platform: process.platform }, cors);
    }

    if (url.pathname === '/printers') {
      if (req.method !== 'GET') return fail(res, 405, 'method_not_allowed', cors);
      try {
        return send(res, 200, { printers: await spooler.listPrinters() }, cors);
      } catch (error) {
        return fail(res, 502, 'spooler_error', cors, error && error.message);
      }
    }

    if (url.pathname === '/print') {
      if (req.method !== 'POST') return fail(res, 405, 'method_not_allowed', cors);
      return print(req, res, url, cors);
    }

    if (url.pathname === '/print-image') {
      if (req.method !== 'POST') return fail(res, 405, 'method_not_allowed', cors);
      return printImage(req, res, url, cors);
    }

    return fail(res, 404, 'not_found', cors);
  }

  async function print(req, res, url, cors) {
    const printerName = url.searchParams.get('printer');
    if (!printerName) return fail(res, 400, 'bad_request', cors, 'Missing "printer"');
    const copiesText = url.searchParams.has('copies') ? url.searchParams.get('copies') : '1';
    const copies = /^\d{1,3}$/.test(copiesText) ? Number(copiesText) : 0;
    if (copies < 1 || copies > MAX_COPIES) return fail(res, 400, 'bad_request', cors, `"copies" must be an integer between 1 and ${MAX_COPIES}`);

    const declared = Number(req.headers['content-length']);
    const closing = { ...cors, Connection: 'close' };
    if (Number.isFinite(declared) && declared > config.maxBytes) return fail(res, 413, 'too_large', closing);
    const read = await readBody(req, config.maxBytes);
    if (read.tooLarge) return fail(res, 413, 'too_large', closing);
    const { body } = read;
    if (body.length === 0) return fail(res, 400, 'bad_request', cors, 'Empty body');
    if (body.length * copies > MAX_JOB_BYTES) return fail(res, 413, 'too_large', cors);

    let printers;
    try {
      printers = await spooler.listPrinters();
    } catch (error) {
      return fail(res, 502, 'spooler_error', cors, error && error.message);
    }
    const wanted = printerName.toLowerCase();
    const printer = printers.find(p => p.name === printerName) || printers.find(p => p.name.toLowerCase() === wanted);
    if (!printer) return fail(res, 404, 'printer_not_found', cors);

    const data = copies === 1 ? body : Buffer.concat(Array(copies).fill(body));
    try {
      await spooler.printRaw(printer.name, data);
    } catch (error) {
      log(`${stamp()} print FAILED printer="${printer.name}" bytes=${body.length} copies=${copies}`);
      return fail(res, 502, 'spooler_error', cors, error && error.message);
    }
    log(`${stamp()} print printer="${printer.name}" bytes=${body.length} copies=${copies}`);
    return send(res, 200, { ok: true, bytes: body.length, copies }, cors);
  }

  /** POST /print-image: validate everything first, then hand the PNG to the spooler (PrintDocument through the driver). */
  async function printImage(req, res, url, cors) {
    const parsed = parseImageQuery(url.searchParams);
    if (parsed.error) return fail(res, 400, 'bad_request', cors, parsed.error);
    const { printer: printerName, ...options } = parsed.value;

    const declared = Number(req.headers['content-length']);
    const closing = { ...cors, Connection: 'close' };
    if (Number.isFinite(declared) && declared > config.maxImageBytes) return fail(res, 413, 'too_large', closing);
    const read = await readBody(req, config.maxImageBytes);
    if (read.tooLarge) return fail(res, 413, 'too_large', closing);
    const { body } = read;
    if (body.length === 0) return fail(res, 400, 'bad_request', cors, 'Empty body');
    if (!isPng(body)) return fail(res, 415, 'not_png', cors);

    let printers;
    try {
      printers = await spooler.listPrinters();
    } catch (error) {
      return fail(res, 502, 'spooler_error', cors, error && error.message);
    }
    const wanted = printerName.toLowerCase();
    const printer = printers.find(p => p.name === printerName) || printers.find(p => p.name.toLowerCase() === wanted);
    if (!printer) return fail(res, 404, 'printer_not_found', cors);

    const summary = `printer="${printer.name}" bytes=${body.length} size=${options.widthMm}x${options.heightMm}mm dpi=${options.dpi} copies=${options.copies}`;
    try {
      if (typeof spooler.printImage !== 'function') throw new Error('This spooler cannot print images');
      await spooler.printImage(printer.name, body, options);
    } catch (error) {
      log(`${stamp()} print-image FAILED ${summary}`);
      return fail(res, 502, 'spooler_error', cors, error && error.message);
    }
    log(`${stamp()} print-image ${summary}`);
    return send(res, 200, { ok: true, bytes: body.length, copies: options.copies }, cors);
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch(error => {
      if (!res.headersSent) fail(res, 502, 'spooler_error', {}, error && error.message);
      else res.destroy();
    });
  });
  server.printbridgeConfig = config;
  return server;
}

// ---------------------------------------------------------------------------------------------------------------------
// Command line
// ---------------------------------------------------------------------------------------------------------------------

function main(argv) {
  const at = argv.indexOf('--config');
  const file = at >= 0 && argv[at + 1] ? path.resolve(argv[at + 1]) : path.join(__dirname, 'config.json');
  let config;
  try {
    config = loadConfig(file);
  } catch (error) {
    console.error(`PrintBridge agent: ${error.message}`);
    process.exit(1);
  }
  const server = createServer({ spooler: createWindowsSpooler(), config });
  server.on('error', error => {
    console.error(error.code === 'EADDRINUSE'
      ? `PrintBridge agent: port ${config.port} is already in use (is the agent already running? or change "port" in config.json)`
      : `PrintBridge agent: ${error.message}`);
    process.exit(1);
  });
  server.listen(config.port, HOST, () => {
    console.log(`${stamp()} PrintBridge agent ${VERSION} listening on http://${HOST}:${server.address().port}`);
    console.log(`${stamp()} allowed origins: ${config.allowedOrigins.join(', ')}${config.allowFileOrigin ? ', file:// (null)' : ''}`);
  });
}

module.exports = { createServer, createWindowsSpooler, loadConfig, normalizeConfig, isOriginAllowed, isHostAllowed, parsePrinterList, runPowerShell, parseImageQuery, isPng, buildImageEnv, LIST_SCRIPT, PRINT_SCRIPT, IMAGE_SCRIPT, DEFAULT_CONFIG, VERSION };

if (require.main === module) main(process.argv.slice(2));
