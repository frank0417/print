/**
 * Background service worker: preview window + Native Messaging silent print.
 */

import { nativeSend, probeNativeHost } from './native.js';

const jobs = new Map();

const HOST_NOT_INSTALLED = 'HOST_NOT_INSTALLED';

function uid() {
  return `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function isHostMissingError(message = '') {
  const text = String(message || '');
  return (
    /Specified native messaging host not found/i.test(text) ||
    /Access to the specified native messaging host is forbidden/i.test(text) ||
    /Native host has exited/i.test(text) ||
    /本地打印代理未安装/i.test(text) ||
    /无法连接本地打印代理/i.test(text) ||
    /未安装或未注册/i.test(text)
  );
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then(sendResponse)
    .catch((err) =>
      sendResponse({
        error: err.message || String(err),
        code: err.code || undefined,
      })
    );
  return true;
});

async function handleMessage(message, sender) {
  switch (message?.type) {
    case 'PRINT_JOB':
      return createPrintJob(message.payload, sender);
    case 'GET_JOB':
      return getJob(message.jobId);
    case 'GET_PRINTERS':
      return listPrintersWithStatus();
    case 'GET_HOST_STATUS':
      return probeNativeHost();
    case 'OPEN_INSTALL_GUIDE':
      return openInstallGuide({
        reason: message.reason,
        jobId: message.jobId,
      });
    case 'OPEN_PREVIEW_FOR_JOB':
      return reopenPreviewForJob(message.jobId, sender);
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
 * - mode=print + showDialog=false → native silent print; if host missing → install guide
 */
async function createPrintJob(payload, sender) {
  if (!payload?.pages?.length) {
    throw new Error('没有可打印的页面内容');
  }

  const wantSilent = payload.mode === 'print' && payload.showDialog === false;
  const forcePreview = payload.forcePreview === true;

  if (wantSilent && !forcePreview) {
    const host = await probeNativeHost();
    if (!host.available) {
      return promptInstallHost({
        payload,
        sender,
        reason: host.error || '未检测到本地打印代理 com.printkit.host',
      });
    }

    try {
      const result = await silentPrintViaNative(payload, host);
      return {
        ok: true,
        mode: 'native-silent',
        ...result,
      };
    } catch (err) {
      if (isHostMissingError(err.message)) {
        return promptInstallHost({
          payload,
          sender,
          reason: err.message,
        });
      }
      // Host is present but print failed — surface error (no silent fallback)
      const error = new Error(err.message || '静默打印失败');
      error.code = 'NATIVE_PRINT_FAILED';
      throw error;
    }
  }

  return openPreviewJob(payload, sender);
}

async function promptInstallHost({ payload, sender, reason }) {
  const jobId = uid();
  const job = {
    id: jobId,
    createdAt: Date.now(),
    tabId: sender?.tab?.id ?? null,
    frameId: sender?.frameId ?? 0,
    ...payload,
    // Ensure preview path works if user clicks "改用预览打印"
    mode: payload.mode || 'print',
    showDialog: true,
  };
  jobs.set(jobId, job);
  await persistJob(jobId, job);

  const guide = await openInstallGuide({ reason, jobId });

  return {
    ok: false,
    code: HOST_NOT_INSTALLED,
    error: '本地打印代理未安装，已打开安装说明',
    reason,
    jobId,
    windowId: guide.windowId,
    installGuide: true,
  };
}

async function openInstallGuide({ reason, jobId } = {}) {
  const qs = new URLSearchParams();
  if (reason) qs.set('reason', reason);
  if (jobId) qs.set('jobId', jobId);
  const url = chrome.runtime.getURL(
    `install/guide.html${qs.toString() ? `?${qs}` : ''}`
  );

  const win = await chrome.windows.create({
    url,
    type: 'popup',
    width: 760,
    height: 720,
    focused: true,
  });

  return { ok: true, windowId: win?.id ?? null };
}

async function reopenPreviewForJob(jobId, sender) {
  const { job } = await getJob(jobId);
  return openPreviewJob(
    {
      ...job,
      mode: 'print',
      showDialog: true,
      forcePreview: true,
    },
    sender
  );
}

async function silentPrintViaNative(payload, hostProbe) {
  const host = hostProbe || (await probeNativeHost());
  if (!host.available) {
    const err = new Error(host.error || '本地打印代理未安装或未注册');
    err.code = HOST_NOT_INSTALLED;
    throw err;
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
  const jobId = payload.id || uid();
  const job = {
    id: jobId,
    createdAt: Date.now(),
    tabId: sender?.tab?.id ?? null,
    frameId: sender?.frameId ?? 0,
    ...payload,
    id: jobId,
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

async function listPrintersWithStatus() {
  const host = await probeNativeHost();
  if (!host.available) {
    return {
      printers: [],
      hostAvailable: false,
      code: HOST_NOT_INSTALLED,
      error: host.error || '本地打印代理未安装',
    };
  }

  try {
    const res = await nativeSend('getPrinters', {}, 15000);
    return {
      printers: Array.isArray(res.printers)
        ? res.printers.map((p) => ({ ...p, source: p.source || 'native-host' }))
        : [],
      hostAvailable: true,
    };
  } catch (err) {
    if (isHostMissingError(err.message)) {
      return {
        printers: [],
        hostAvailable: false,
        code: HOST_NOT_INSTALLED,
        error: err.message,
      };
    }
    throw err;
  }
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
