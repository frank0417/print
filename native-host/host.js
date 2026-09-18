#!/usr/bin/env node
'use strict';

/**
 * PrintKit Native Messaging host
 * Protocol: Chrome Native Messaging (4-byte LE length + UTF-8 JSON)
 *
 * Supported actions:
 *   ping | getPrinters | getDefaultPrinter | print | getHostInfo
 *   checkUpdate | applyUpdate | uninstall
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { listPrinters, getDefaultPrinter, printPdf } = require('./lib/printers');
const { htmlJobToPdf } = require('./lib/html-to-pdf');
const update = require('./lib/update');
const hygiene = require('./lib/hygiene');

const HOST_VERSION = (() => {
  try {
    return require('./package.json').version;
  } catch (_) {
    return '0.3.0';
  }
})();

const MAX_MESSAGE = 1024 * 1024 * 64; // 64MB

function nodeMajor() {
  return parseInt(String(process.versions.node || '0').split('.')[0], 10) || 0;
}

function prewarmChromeSafe() {
  // chrome-cdp.js uses fetch/WebSocket/optional chaining — only load on Node 18+
  if (nodeMajor() < 18) {
    return Promise.resolve({ skipped: true, reason: 'node<' + process.versions.node });
  }
  const cdp = require('./lib/chrome-cdp');
  return cdp.prewarmChrome();
}

function log(...args) {
  const line = `[${new Date().toISOString()}] ${args
    .map((a) => (typeof a === 'string' ? a : JSON.stringify(a)))
    .join(' ')}\n`;
  hygiene.appendLog(line);
}

/**
 * One pair of stdin listeners for the whole process.
 * The previous per-message readMessage() added `end`/`error` listeners on
 * every native call and never removed them — after a few thousand prints
 * the host EventEmitter itself became a source of stutter.
 */
function createNativeReader() {
  let buf = Buffer.alloc(0);
  let mode = 'header';
  let needed = 4;
  const queue = [];
  let waiting = null;
  let ended = false;
  let failed = null;

  function deliver(err, msg) {
    if (waiting) {
      const w = waiting;
      waiting = null;
      if (err) w.reject(err);
      else w.resolve(msg);
      return;
    }
    if (err) failed = err;
    else queue.push(msg);
  }

  function consume() {
    while (buf.length >= needed) {
      if (mode === 'header') {
        needed = buf.readUInt32LE(0);
        buf = buf.slice(4);
        if (needed <= 0 || needed > MAX_MESSAGE) {
          const err = new Error(`非法消息长度: ${needed}`);
          needed = 4;
          mode = 'header';
          deliver(err);
          return;
        }
        mode = 'body';
      } else {
        const body = buf.slice(0, needed);
        buf = buf.slice(needed);
        mode = 'header';
        needed = 4;
        try {
          deliver(null, JSON.parse(body.toString('utf8')));
        } catch (err) {
          deliver(err);
        }
      }
    }
  }

  process.stdin.on('readable', () => {
    let chunk;
    while ((chunk = process.stdin.read())) {
      buf = Buffer.concat([buf, chunk]);
    }
    consume();
  });

  process.stdin.on('end', () => {
    ended = true;
    deliver(null, null);
  });

  process.stdin.on('error', (err) => {
    failed = err;
    deliver(err);
  });

  return function readMessage() {
    if (failed) return Promise.reject(failed);
    if (queue.length) return Promise.resolve(queue.shift());
    if (ended) return Promise.resolve(null);
    return new Promise((resolve, reject) => {
      waiting = { resolve, reject };
    });
  };
}

function writeMessage(obj) {
  const json = Buffer.from(JSON.stringify(obj), 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(json.length, 0);
  process.stdout.write(header);
  process.stdout.write(json);
}

async function handle(msg) {
  const action = (msg && (msg.action || msg.type)) || '';
  switch (action) {
    case 'ping':
      return {
        ok: true,
        pong: true,
        version: HOST_VERSION,
        productVersion: update.readLocalVersion(),
        platform: process.platform,
        arch: process.arch,
        node: process.version,
        installRoot: update.findInstallRoot(),
      };

    case 'getHostInfo':
      return {
        ok: true,
        version: HOST_VERSION,
        productVersion: update.readLocalVersion(),
        platform: process.platform,
        arch: process.arch,
        node: process.version,
        tmpdir: os.tmpdir(),
        installRoot: update.findInstallRoot(),
      };

    case 'checkUpdate':
      try {
        return await update.checkUpdate();
      } catch (err) {
        return {
          ok: false,
          error: err.message || String(err),
          current: update.readLocalVersion(),
          installRoot: update.findInstallRoot(),
        };
      }

    case 'applyUpdate':
      try {
        return await update.applyUpdate(msg.payload || {});
      } catch (err) {
        return { ok: false, error: err.message || String(err) };
      }

    case 'uninstall':
      return update.uninstallPrintKit(msg.payload || {});

    case 'getPrinters':
    case 'listPrinters':
    case 'getPrinterList': {
      const printers = await listPrinters();
      return { ok: true, printers };
    }

    case 'getDefaultPrinter': {
      const printer = await getDefaultPrinter();
      return { ok: true, printer };
    }

    case 'prewarm': {
      const info = await prewarmChromeSafe();
      return Object.assign({ ok: true, prewarmed: true }, info);
    }

    case 'print': {
      const result = await doPrint(msg.payload || msg);
      return { ok: true, ...result };
    }

    default:
      return { ok: false, error: `未知 action: ${action}` };
  }
}

async function doPrint(payload) {
  // Classify the target once (driver probe, cached) so PDF styling and the
  // print path agree on pin vs page layout for any brand.
  const settings = require('./lib/printer-kind').applyPrinterKind(payload.settings || {});
  const printer = settings.printer || settings.printerName || null;
  const copies = Math.max(1, Number(settings.copies) || 1);
  const jobDir = fs.mkdtempSync(path.join(os.tmpdir(), 'printkit-'));

  try {
    let pdfPath = payload.pdfPath || null;
    let htmlPath = payload.htmlPath || null;

    if (!pdfPath && payload.pdfBase64) {
      pdfPath = path.join(jobDir, 'job.pdf');
      fs.writeFileSync(pdfPath, Buffer.from(payload.pdfBase64, 'base64'));
    }

    // IPP/WSD lasers print HTML via Chrome kiosk — skip headless PDF (often
    // 2–17s with --virtual-time-budget=8000) when we already have pages.
    let ippHtmlOnly = false;
    if (
      !pdfPath &&
      process.platform === 'win32' &&
      printer &&
      Array.isArray(payload.pages) &&
      payload.pages.length
    ) {
      const { getWinPrinterMeta, isIppWsdPrinter } = require('./lib/printers');
      ippHtmlOnly = isIppWsdPrinter(getWinPrinterMeta(printer));
    }

    if (!pdfPath && ippHtmlOnly) {
      const { buildHtmlDocument } = require('./lib/html-to-pdf');
      htmlPath = path.join(jobDir, 'job.html');
      fs.writeFileSync(
        htmlPath,
        buildHtmlDocument({
          title: payload.title || 'PrintKit',
          pages: payload.pages || [],
          stylesheets: payload.stylesheets || [],
          settings,
        }),
        'utf8'
      );
      log('html-only for IPP/WSD (skip pdf)');
    } else if (!pdfPath) {
      const made = await htmlJobToPdf({
        jobDir,
        title: payload.title || 'PrintKit',
        pages: payload.pages || [],
        stylesheets: payload.stylesheets || [],
        settings,
      });
      // htmlJobToPdf may return string (legacy) or { pdfPath, htmlPath }
      if (typeof made === 'string') {
        pdfPath = made;
        htmlPath = path.join(jobDir, 'job.html');
      } else {
        pdfPath = made.pdfPath;
        htmlPath = made.htmlPath || path.join(jobDir, 'job.html');
      }
    }

    const printResult = await printPdf({
      pdfPath,
      printer,
      copies,
      settings: Object.assign({}, settings, { htmlPath: htmlPath }),
    });

    return {
      printer: printResult.printer,
      copies,
      method: printResult.method,
    };
  } finally {
    // Spooler / GDI already consumed the file; drop the temp HTML+PDF so
    // %TEMP%\printkit-* does not grow without bound across a shift.
    hygiene.scheduleRemoveDir(jobDir, process.argv.includes('--cli') ? 0 : 15000);
  }
}

function parseCliPayload(argv) {
  const payload = {};
  const payloadIdx = argv.indexOf('--payload');
  if (payloadIdx >= 0) {
    const src = argv[payloadIdx + 1] || '';
    if (src.charAt(0) === '{') {
      Object.assign(payload, JSON.parse(src));
    } else {
      Object.assign(payload, JSON.parse(fs.readFileSync(src, 'utf8')));
    }
  }
  const zipIdx = argv.indexOf('--zip');
  if (zipIdx >= 0) payload.zipPath = argv[zipIdx + 1];
  const urlIdx = argv.indexOf('--url');
  if (urlIdx >= 0) payload.url = argv[urlIdx + 1];
  if (argv.indexOf('--force') >= 0) payload.force = true;
  if (argv.indexOf('--yes') >= 0) payload.yes = true;
  return payload;
}

async function main() {
  // CLI mode: node host.js --cli ping|getPrinters|checkUpdate|applyUpdate|uninstall
  if (process.argv.includes('--cli')) {
    const action = process.argv[process.argv.indexOf('--cli') + 1] || 'ping';
    const payload = parseCliPayload(process.argv);
    const result = await handle({ action, payload });
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    if (!result.ok) process.exit(1);
    return;
  }

  process.stdin.on('error', (err) => log('stdin error', err.message));

  const pruned = hygiene.pruneStaleJobDirs();
  if (pruned.removed) log('pruned stale job dirs', pruned);
  hygiene.rotateLogIfNeeded();
  try {
    hygiene.pruneChromeCaches(path.join(os.tmpdir(), 'printkit-chrome-kiosk'));
    hygiene.pruneChromeCaches(path.join(os.tmpdir(), 'printkit-chrome-profile'));
  } catch (_) {
    /* ignore */
  }
  if (nodeMajor() >= 18) {
    try {
      require('./lib/chrome-cdp').recycleIfStale('host-start');
    } catch (_) {
      /* ignore */
    }
  }

  const readMessage = createNativeReader();

  // Keep reading messages until stdin ends
  for (;;) {
    let msg;
    try {
      msg = await readMessage();
    } catch (err) {
      log('read error', err.message);
      break;
    }
    if (msg == null) break;

    log('recv', { action: msg.action || msg.type });
    try {
      const result = await handle(msg);
      if (msg.requestId && result && typeof result === 'object') {
        result.requestId = msg.requestId;
      }
      writeMessage(result);
      log('send ok', { action: msg.action || msg.type });
    } catch (err) {
      log('handler error', err.message);
      writeMessage({ ok: false, error: err.message || String(err) });
    }
  }
}

main().catch((err) => {
  log('fatal', err.message);
  try {
    writeMessage({ ok: false, error: err.message || String(err) });
  } catch (_) {
    /* ignore */
  }
  process.exit(1);
});
