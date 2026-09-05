#!/usr/bin/env node
'use strict';

/**
 * PrintKit Native Messaging host
 * Protocol: Chrome Native Messaging (4-byte LE length + UTF-8 JSON)
 *
 * Supported actions:
 *   ping | getPrinters | getDefaultPrinter | print | getHostInfo
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { listPrinters, getDefaultPrinter, printPdf } = require('./lib/printers');
const { htmlJobToPdf } = require('./lib/html-to-pdf');
const { prewarmChrome } = require('./lib/chrome-cdp');

const MAX_MESSAGE = 1024 * 1024 * 64; // 64MB

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
  const action = msg?.action || msg?.type;
  switch (action) {
    case 'ping':
      return {
        ok: true,
        pong: true,
        version: '0.2.2',
        platform: process.platform,
        arch: process.arch,
      };

    case 'getHostInfo':
      return {
        ok: true,
        version: '0.2.2',
        platform: process.platform,
        arch: process.arch,
        node: process.version,
        tmpdir: os.tmpdir(),
      };

    case 'getPrinters': {
      const printers = await listPrinters();
      return { ok: true, printers };
    }

    case 'getDefaultPrinter': {
      const printer = await getDefaultPrinter();
      return { ok: true, printer };
    }

    case 'prewarm': {
      const info = await prewarmChrome();
      return { ok: true, prewarmed: true, ...info };
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
  const settings = payload.settings || {};
  const printer = settings.printer || settings.printerName || null;
  const copies = Math.max(1, Number(settings.copies) || 1);
  const jobDir = fs.mkdtempSync(path.join(os.tmpdir(), 'printkit-'));

  try {
    let pdfPath = payload.pdfPath || null;

    if (!pdfPath && payload.pdfBase64) {
      pdfPath = path.join(jobDir, 'job.pdf');
      fs.writeFileSync(pdfPath, Buffer.from(payload.pdfBase64, 'base64'));
    }

    if (!pdfPath) {
      pdfPath = await htmlJobToPdf({
        jobDir,
        title: payload.title || 'PrintKit',
        pages: payload.pages || [],
        stylesheets: payload.stylesheets || [],
        settings,
      });
    }

    const printResult = await printPdf({
      pdfPath,
      printer,
      copies,
      settings,
    });

    return {
      pdfPath,
      printer: printResult.printer,
      copies,
      method: printResult.method,
      jobDir,
    };
  } catch (err) {
    throw err;
  }
}

async function main() {
  // CLI mode for manual testing: node host.js --cli getPrinters
  if (process.argv.includes('--cli')) {
    const action = process.argv[process.argv.indexOf('--cli') + 1] || 'ping';
    let payload = {};
    const payloadIdx = process.argv.indexOf('--payload');
    if (payloadIdx >= 0) {
      payload = JSON.parse(fs.readFileSync(process.argv[payloadIdx + 1], 'utf8'));
    }
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
