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
  try {
    const line = `[${new Date().toISOString()}] ${args
      .map((a) => (typeof a === 'string' ? a : JSON.stringify(a)))
      .join(' ')}\n`;
    fs.appendFileSync(path.join(os.tmpdir(), 'printkit-host.log'), line);
  } catch (_) {
    /* ignore */
  }
}

function readMessage() {
  return new Promise((resolve, reject) => {
    const header = Buffer.alloc(4);
    let headerRead = 0;

    function onHeaderReadable() {
      const n = process.stdin.read(4 - headerRead);
      if (!n) return;
      n.copy(header, headerRead);
      headerRead += n.length;
      if (headerRead < 4) return;
      process.stdin.off('readable', onHeaderReadable);

      const len = header.readUInt32LE(0);
      if (len <= 0 || len > MAX_MESSAGE) {
        reject(new Error(`非法消息长度: ${len}`));
        return;
      }

      const chunks = [];
      let remaining = len;

      function onBodyReadable() {
        while (remaining > 0) {
          const chunk = process.stdin.read(Math.min(remaining, 64 * 1024));
          if (!chunk) return;
          chunks.push(chunk);
          remaining -= chunk.length;
        }
        process.stdin.off('readable', onBodyReadable);
        try {
          const raw = Buffer.concat(chunks).toString('utf8');
          resolve(JSON.parse(raw));
        } catch (err) {
          reject(err);
        }
      }

      process.stdin.on('readable', onBodyReadable);
      onBodyReadable();
    }

    process.stdin.on('readable', onHeaderReadable);
    onHeaderReadable();

    process.stdin.on('end', () => resolve(null));
    process.stdin.on('error', reject);
  });
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
      pdfPath,
      htmlPath: htmlPath || null,
      printer: printResult.printer,
      copies,
      method: printResult.method,
      jobDir,
    };
  } catch (err) {
    throw err;
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
