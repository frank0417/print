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

const hygiene = require('./hygiene');

const CDP_PORT = Number(process.env.PRINTKIT_CDP_PORT) || 19333;
const PROFILE_DIR = path.join(os.tmpdir(), 'printkit-chrome-cdp');
const META_PATH = path.join(os.tmpdir(), 'printkit-chrome-cdp.json');
const MAX_JOBS_PER_CHROME = Number(process.env.PRINTKIT_CDP_MAX_JOBS) || 40;
const MAX_AGE_MS = Number(process.env.PRINTKIT_CDP_MAX_AGE_MS) || 20 * 60 * 1000;
const IDLE_MS = Number(process.env.PRINTKIT_CDP_IDLE_MS) || 10 * 60 * 1000;

let chromeProc = null;
let idleTimer = null;

function log(...args) {
  const line = `[${new Date().toISOString()}] cdp ${args
    .map((a) => (typeof a === 'string' ? a : JSON.stringify(a)))
    .join(' ')}\n`;
  hygiene.appendLog(line);
}

function readMeta() {
  try {
    return JSON.parse(fs.readFileSync(META_PATH, 'utf8')) || {};
  } catch (_) {
    return {};
  }
}

function writeMeta(meta) {
  try {
    fs.writeFileSync(META_PATH, JSON.stringify(meta));
  } catch (_) {
    /* ignore */
  }
}

function bumpJobCount() {
  const meta = readMeta();
  meta.jobs = (Number(meta.jobs) || 0) + 1;
  meta.lastJobAt = Date.now();
  writeMeta(meta);
  return meta;
}

function metaIsStale(meta) {
  if (!meta || !meta.spawnedAt) return false;
  if (Date.now() - Number(meta.spawnedAt) >= MAX_AGE_MS) return 'age';
  if ((Number(meta.jobs) || 0) >= MAX_JOBS_PER_CHROME) return 'jobs';
  return false;
}

function clearIdleTimer() {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
}

function scheduleIdleShutdown() {
  clearIdleTimer();
  idleTimer = setTimeout(() => {
    shutdownHeadlessChrome('idle');
  }, IDLE_MS);
  if (idleTimer && typeof idleTimer.unref === 'function') idleTimer.unref();
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

function shutdownHeadlessChrome(reason) {
  clearIdleTimer();
  const meta = readMeta();
  const pid = (chromeProc && chromeProc.pid) || meta.pid;
  log('shutdown headless chrome', { reason: reason || 'unknown', pid: pid || null });
  hygiene.killProcessTree(pid);
  hygiene.killByUserDataDir(PROFILE_DIR);
  chromeProc = null;
  hygiene.pruneChromeCaches(PROFILE_DIR);
  try {
    fs.unlinkSync(META_PATH);
  } catch (_) {
    /* ignore */
  }
}

function recycleIfStale(reason) {
  const meta = readMeta();
  const why = metaIsStale(meta);
  if (why) {
    shutdownHeadlessChrome(reason || why);
    return { recycled: true, reason: why };
  }
  // v0.5.29 left a detached Chrome with no meta file. Drop it once on upgrade
  // so a bloated profile is not kept forever.
  if (reason === 'host-start' && !meta.spawnedAt) {
    try {
      if (fs.existsSync(PROFILE_DIR)) {
        shutdownHeadlessChrome('upgrade-no-meta');
        return { recycled: true, reason: 'upgrade-no-meta' };
      }
    } catch (_) {
      /* ignore */
    }
  }
  return { recycled: false };
}

async function ensureHeadlessChrome() {
  const recycled = recycleIfStale('ensure');
  if (recycled.recycled) await sleep(250);
  if (await isChromeUp()) {
    scheduleIdleShutdown();
    return { reused: true, port: CDP_PORT };
  }

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
  chromeProc = child;
  child.unref();
  writeMeta({ pid: child.pid, spawnedAt: Date.now(), jobs: 0, lastJobAt: 0 });
  log('spawned headless chrome', { pid: child.pid, port: CDP_PORT });

  for (let i = 0; i < 80; i++) {
    if (await isChromeUp()) {
      scheduleIdleShutdown();
      return { reused: false, port: CDP_PORT };
    }
    await sleep(100);
  }
  shutdownHeadlessChrome('spawn-timeout');
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
    await sleep(20);

    const paper = resolvePaper(settings);
    const pin = require('./html-to-pdf').isPinSettings(settings);
    const result = await cdp.send(
      'Page.printToPDF',
      {
        // Pin: gray cell fills dither into muddy dots. TXT has no fills.
        printBackground: !pin,
        // false: paperWidth/Height win over any @page in business CSS
        preferCSSPageSize: false,
        // paper inches already encode 横/竖 — never also set landscape
        landscape: false,
        displayHeaderFooter: false,
        scale: 1,
        paperWidth: paper.width / 25.4,
        paperHeight: paper.height / 25.4,
        // Margins are padding on .pk-page (same as preview). Do not add a
        // second CSS/@page/CDP inset — that shifts the ticket right/down.
        marginTop: 0,
        marginBottom: 0,
        marginLeft: 0,
        marginRight: 0,
        transferMode: 'ReturnAsBase64',
      },
      sessionId
    );
    if (!result || !result.data) throw new Error('Page.printToPDF 无数据');
    fs.writeFileSync(pdfPath, Buffer.from(result.data, 'base64'));
    bumpJobCount();
    scheduleIdleShutdown();
    return pdfPath;
  } finally {
    if (targetId) {
      try {
        await cdp.send('Target.closeTarget', { targetId });
      } catch (_) {
        /* ignore */
      }
    }
    try {
      if (cdp.ws && cdp.ws.readyState === 1) {
        const listed = await cdp.send('Target.getTargets');
        const leftovers = (listed && listed.targetInfos) || [];
        for (const t of leftovers) {
          const url = String((t && t.url) || '');
          if (t && t.targetId && t.targetId !== targetId && /file:\/\//i.test(url)) {
            try {
              await cdp.send('Target.closeTarget', { targetId: t.targetId });
            } catch (_) {
              /* ignore */
            }
          }
        }
      }
    } catch (_) {
      /* ignore */
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
  shutdownHeadlessChrome,
  recycleIfStale,
};
