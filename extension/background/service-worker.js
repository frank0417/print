/**
 * Background service worker: store print jobs and open preview window.
 */

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

async function createPrintJob(payload, sender) {
  if (!payload?.pages?.length) {
    throw new Error('没有可打印的页面内容');
  }

  const jobId = uid();
  const job = {
    id: jobId,
    createdAt: Date.now(),
    tabId: sender?.tab?.id ?? null,
    frameId: sender?.frameId ?? 0,
    ...payload,
  };
  jobs.set(jobId, job);

  // Persist briefly so preview page can load after service worker sleep.
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

/**
 * Desktop Chrome 无法像 JCP 本地客户端那样枚举系统打印机。
 * ChromeOS 企业策略下可用 chrome.printing；此处做能力探测并优雅降级。
 */
async function listPrinters() {
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

// Cleanup old jobs periodically
setInterval(() => {
  const expireBefore = Date.now() - 30 * 60 * 1000;
  for (const [id, job] of jobs.entries()) {
    if (job.createdAt < expireBefore) {
      jobs.delete(id);
      removePersistedJob(id);
    }
  }
}, 60_000);
