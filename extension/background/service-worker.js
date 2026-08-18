/**
 * Background service worker: preview window + Native Messaging silent print.
 */

import { nativeSend, probeNativeHost } from './native.js';

const jobs = new Map();

function uid() {
  return `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then(sendResponse)
    .catch((err) => sendResponse({ error: err.message || String(err) }));
  return true;
});

async function handleMessage(message, sender) {
  switch (message?.type) {
    case 'PRINT_JOB':
      return createPrintJob(message.payload, sender);
    case 'GET_JOB':
      return getJob(message.jobId);
    case 'GET_PRINTERS':
      return { printers: await listPrinters() };
    case 'GET_HOST_STATUS':
      return probeNativeHost();
    case 'CLOSE_PREVIEW':
      if (message.jobId) {
        jobs.delete(message.jobId);
        await removePersistedJob(message.jobId);
      }
      return { ok: true };
    default:
      throw new Error(`未知消息: ${message?.type}`);
  }
}

/**
 * Routing:
 * - mode=preview → always open preview UI
 * - mode=print + showDialog=true → preview UI then system dialog
 * - mode=print + showDialog=false → prefer native silent print; fallback to preview auto-print
 */
async function createPrintJob(payload, sender) {
  if (!payload?.pages?.length) {
    throw new Error('没有可打印的页面内容');
  }

  const wantSilent = payload.mode === 'print' && payload.showDialog === false;
  const forcePreview = payload.forcePreview === true;

  if (wantSilent && !forcePreview) {
    try {
      const result = await silentPrintViaNative(payload);
      return {
        ok: true,
        mode: 'native-silent',
        ...result,
      };
    } catch (err) {
      // Fall back to preview auto-print so jobs still succeed without host.
      console.warn('[PrintKit] native silent print failed, fallback to preview:', err.message);
      payload = {
        ...payload,
        nativeFallbackError: err.message,
      };
    }
  }

  return openPreviewJob(payload, sender);
}

async function silentPrintViaNative(payload) {
  const host = await probeNativeHost();
  if (!host.available) {
    throw new Error(host.error || '本地打印代理未安装或未注册');
  }

  const res = await nativeSend(
    'print',
    {
      title: payload.title,
      pages: payload.pages,
      stylesheets: payload.stylesheets,
      settings: payload.settings || {},
    },
    180000
  );

  return {
    jobId: uid(),
    printer: res.printer,
    method: res.method,
    pdfPath: res.pdfPath,
    copies: res.copies,
    hostVersion: host.version,
  };
}

async function openPreviewJob(payload, sender) {
  const jobId = uid();
  const job = {
    id: jobId,
    createdAt: Date.now(),
    tabId: sender?.tab?.id ?? null,
    frameId: sender?.frameId ?? 0,
    ...payload,
  };
  jobs.set(jobId, job);
  await persistJob(jobId, job);

  const previewUrl = chrome.runtime.getURL(
    `preview/preview.html?jobId=${encodeURIComponent(jobId)}`
  );

  const win = await chrome.windows.create({
    url: previewUrl,
    type: 'popup',
    width: 980,
    height: 820,
    focused: true,
  });

  return {
    ok: true,
    jobId,
    windowId: win?.id ?? null,
    mode: payload.mode,
    nativeFallbackError: payload.nativeFallbackError || null,
  };
}

async function persistJob(jobId, job) {
  const key = `job:${jobId}`;
  if (chrome.storage?.session) {
    await chrome.storage.session.set({ [key]: job });
    return;
  }
  await chrome.storage.local.set({ [key]: job });
}

async function readPersistedJob(jobId) {
  const key = `job:${jobId}`;
  if (chrome.storage?.session) {
    const stored = await chrome.storage.session.get(key);
    if (stored[key]) return stored[key];
  }
  const local = await chrome.storage.local.get(key);
  return local[key] || null;
}

async function removePersistedJob(jobId) {
  const key = `job:${jobId}`;
  try {
    if (chrome.storage?.session) await chrome.storage.session.remove(key);
  } catch (_) {
    /* ignore */
  }
  try {
    await chrome.storage.local.remove(key);
  } catch (_) {
    /* ignore */
  }
}

async function getJob(jobId) {
  if (!jobId) throw new Error('缺少 jobId');
  if (jobs.has(jobId)) return { job: jobs.get(jobId) };

  const job = await readPersistedJob(jobId);
  if (!job) throw new Error('打印任务不存在或已过期');
  jobs.set(jobId, job);
  return { job };
}

async function listPrinters() {
  try {
    const res = await nativeSend('getPrinters', {}, 15000);
    if (Array.isArray(res.printers)) {
      return res.printers.map((p) => ({ ...p, source: p.source || 'native-host' }));
    }
  } catch (_) {
    /* fall through */
  }

  try {
    if (chrome.printing?.getPrinters) {
      const printers = await chrome.printing.getPrinters();
      return (printers || []).map((p) => ({
        name: p.name,
        id: p.id,
        description: p.description,
        isDefault: false,
        source: 'chrome.printing',
      }));
    }
  } catch (_) {
    /* not available */
  }
  return [];
}

setInterval(() => {
  const expireBefore = Date.now() - 30 * 60 * 1000;
  for (const [id, job] of jobs.entries()) {
    if (job.createdAt < expireBefore) {
      jobs.delete(id);
      removePersistedJob(id);
    }
  }
}, 60_000);
