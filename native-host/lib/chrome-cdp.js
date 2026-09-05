'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

function resolveChromePath() {
  return require('./html-to-pdf').resolveChromePath();
}

function resolvePaper(settings) {
  return require('./html-to-pdf').resolvePaper(settings);
}

const CDP_PORT = Number(process.env.PRINTKIT_CDP_PORT) || 19333;
const PROFILE_DIR = path.join(os.tmpdir(), 'printkit-chrome-cdp');

function log(...args) {
  try {
    const line = `[${new Date().toISOString()}] cdp ${args
      .map((a) => (typeof a === 'string' ? a : JSON.stringify(a)))
      .join(' ')}\n`;
    fs.appendFileSync(path.join(os.tmpdir(), 'printkit-host.log'), line);
  } catch (_) {
    /* ignore */
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fileUrl(htmlPath) {
  const posix = htmlPath.replace(/\\/g, '/');
  return process.platform === 'win32'
    ? 'file:///' + encodeURI(posix)
    : 'file://' + encodeURI(posix);
}

async function chromeVersion() {
  const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`);
  if (!res.ok) throw new Error(`CDP HTTP ${res.status}`);
  return res.json();
}

async function isChromeUp() {
  try {
    await chromeVersion();
    return true;
  } catch (_) {
    return false;
  }
}

async function ensureHeadlessChrome() {
  if (await isChromeUp()) return { reused: true, port: CDP_PORT };

  const chrome = resolveChromePath();
  if (!chrome) {
    throw new Error('未找到 Chrome/Edge');
  }
  fs.mkdirSync(PROFILE_DIR, { recursive: true });

  const child = spawn(
    chrome,
    [
      '--headless=new',
      `--remote-debugging-port=${CDP_PORT}`,
      `--user-data-dir=${PROFILE_DIR}`,
      '--remote-allow-origins=*',
      '--disable-gpu',
      '--disable-software-rasterizer',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--disable-background-networking',
      '--disable-sync',
      '--disable-translate',
      '--disable-default-apps',
      '--disable-component-update',
      '--metrics-recording-only',
      '--mute-audio',
      '--no-pings',
      '--hide-scrollbars',
      '--allow-file-access-from-files',
      `--remote-debugging-address=127.0.0.1`,
      'about:blank',
    ],
    { detached: true, stdio: 'ignore', windowsHide: true }
  );
  child.unref();
  log('spawned headless chrome', { pid: child.pid, port: CDP_PORT });

  for (let i = 0; i < 80; i++) {
    if (await isChromeUp()) return { reused: false, port: CDP_PORT };
    await sleep(100);
  }
  throw new Error('预热 Chrome 超时');
}

class CdpClient {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.nextId = 0;
    this.pending = new Map();
    this.eventWaiters = [];
    this.ws.addEventListener('message', (event) => {
      const msg = JSON.parse(String(event.data));
      if (msg.id != null && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)));
        else resolve(msg.result);
        return;
      }
      if (msg.method) {
        const still = [];
        for (const waiter of this.eventWaiters) {
          if (
            waiter.method === msg.method &&
            (!waiter.sessionId || waiter.sessionId === msg.sessionId)
          ) {
            waiter.resolve(msg.params);
          } else {
            still.push(waiter);
          }
        }
        this.eventWaiters = still;
      }
    });
  }

  ready() {
    if (this.ws.readyState === 1) return Promise.resolve();
    return new Promise((resolve, reject) => {
      this.ws.addEventListener('open', () => resolve(), { once: true });
      this.ws.addEventListener('error', () => reject(new Error('CDP 连接失败')), {
        once: true,
      });
    });
  }

  send(method, params = {}, sessionId) {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP 超时: ${method}`));
      }, 30000);
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      const payload = { id, method, params };
      if (sessionId) payload.sessionId = sessionId;
      this.ws.send(JSON.stringify(payload));
    });
  }

  wait(method, sessionId, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.eventWaiters = this.eventWaiters.filter((w) => w.resolve !== resolve);
        reject(new Error(`等待 ${method} 超时`));
      }, timeoutMs);
      this.eventWaiters.push({
        method,
        sessionId,
        resolve: (params) => {
          clearTimeout(timer);
          resolve(params);
        },
      });
    });
  }

  close() {
    try {
      this.ws.close();
    } catch (_) {
      /* ignore */
    }
  }
}

async function htmlToPdfViaCdp({ htmlPath, pdfPath, settings }) {
  if (typeof WebSocket !== 'function') {
    throw new Error('当前 Node 不支持 WebSocket');
  }
  await ensureHeadlessChrome();
  const version = await chromeVersion();
  const cdp = new CdpClient(version.webSocketDebuggerUrl);
  await cdp.ready();

  let targetId;
  try {
    const created = await cdp.send('Target.createTarget', { url: 'about:blank' });
    targetId = created.targetId;
    const attached = await cdp.send('Target.attachToTarget', {
      targetId,
      flatten: true,
    });
    const sessionId = attached.sessionId;
    await cdp.send('Page.enable', {}, sessionId);
    await cdp.send('Runtime.enable', {}, sessionId);
    await cdp.send('Page.navigate', { url: fileUrl(htmlPath) }, sessionId);
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      try {
        const rs = await cdp.send(
          'Runtime.evaluate',
          { expression: 'document.readyState', returnByValue: true },
          sessionId
        );
        if (rs && rs.result && rs.result.value === 'complete') break;
      } catch (_) {
        /* keep polling */
      }
      await sleep(50);
    }
    await sleep(80);

    const paper = resolvePaper(settings);
    const result = await cdp.send(
      'Page.printToPDF',
      {
        printBackground: true,
        preferCSSPageSize: true,
        displayHeaderFooter: false,
        paperWidth: paper.width / 25.4,
        paperHeight: paper.height / 25.4,
        marginTop: 0,
        marginBottom: 0,
        marginLeft: 0,
        marginRight: 0,
      },
      sessionId
    );
    if (!result?.data) throw new Error('Page.printToPDF 无数据');
    fs.writeFileSync(pdfPath, Buffer.from(result.data, 'base64'));
    return pdfPath;
  } finally {
    if (targetId) {
      try {
        await cdp.send('Target.closeTarget', { targetId });
      } catch (_) {
        /* ignore */
      }
    }
    cdp.close();
  }
}

async function prewarmChrome() {
  return ensureHeadlessChrome();
}

module.exports = {
  htmlToPdfViaCdp,
  prewarmChrome,
  ensureHeadlessChrome,
};
