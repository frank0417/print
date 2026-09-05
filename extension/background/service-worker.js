/**
 * Background service worker: preview window + Native Messaging silent print.
 */

import { nativeRequest, probeNativeHost } from './native.js';

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
    case 'PRINT_FROM_PREVIEW':
      return printFromPreview(message.jobId, message.settings);
    case 'CLOSE_PREVIEW':
      if (message.jobId) {
        jobs.delete(message.jobId);
        await removePersistedJob(message.jobId);
      }
      return { ok: true };
    case 'PREWARM_HOST':
      nativeRequest('prewarm', {}, 30000).catch(() => {});
      return { ok: true };
    default:
      throw new Error(`未知消息: ${message?.type}`);
  }
}

/**
 * Routing:
 * - mode=preview → always open preview UI
 * - mode=print + showDialog=true → preview UI; toolbar print uses native host
 * - mode=print + showDialog=false → native silent print; if host missing → install guide
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
      if (isHostMissingError(err.message)) {
        return promptInstallHost({
          payload,
          sender,
          reason: err.message,
        });
      }
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
    width: 780,
    height: 860,
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

async function printFromPreview(jobId, settings = {}) {
  const { job } = await getJob(jobId);
  const merged = {
    ...job,
    settings: { ...(job.settings || {}), ...settings },
  };
  jobs.set(jobId, merged);
  await persistJob(jobId, merged);

  try {
    const result = await silentPrintViaNative(merged);
    return {
      ok: true,
      mode: 'native-silent',
      ...result,
    };
  } catch (err) {
    if (isHostMissingError(err.message)) {
      await openInstallGuide({ reason: err.message, jobId });
      return {
        ok: false,
        code: HOST_NOT_INSTALLED,
        error: err.message || '本地打印代理未安装，已打开安装说明',
      };
    }
    const error = new Error(err.message || '打印失败');
    error.code = 'NATIVE_PRINT_FAILED';
    throw error;
  }
}

async function silentPrintViaNative(payload) {
  const body = {
    title: payload.title,
    settings: payload.settings || {},
  };
  if (payload.pdfBase64) {
    body.pdfBase64 = payload.pdfBase64;
  } else {
    body.pages = payload.pages;
    body.stylesheets = payload.stylesheets;
  }

  const res = await nativeRequest('print', body, 180000);

  return {
    jobId: uid(),
    printer: res.printer,
    method: res.method,
    pdfPath: res.pdfPath,
    copies: res.copies,
    hostVersion: res.version,
  };
}

async function openPreviewJob(payload, sender) {
  nativeRequest('prewarm', {}, 30000).catch(() => {});
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
    width: 1100,
    height: 900,
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

let printersCache = { at: 0, value: null };

async function listPrintersWithStatus() {
  if (printersCache.value && Date.now() - printersCache.at < 30_000) {
    return printersCache.value;
  }

  try {
    const res = await nativeRequest('getPrinters', {}, 15000);
    const result = {
      printers: Array.isArray(res.printers)
        ? res.printers.map((p) => ({ ...p, source: p.source || 'native-host' }))
        : [],
      hostAvailable: true,
    };
    printersCache = { at: Date.now(), value: result };
    return result;
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
