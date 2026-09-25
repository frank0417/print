/**
 * Native Messaging client for com.printkit.host
 */

export const NATIVE_HOST = 'com.printkit.host';

let cachedPort = null;
let seq = 0;
const waiters = new Map();

function nextId() {
  return `nm_${Date.now()}_${++seq}`;
}

function attachPort(port) {
  port.onMessage.addListener((msg) => {
    // Host may reply without id for simple request/response (1:1).
    // We use requestId correlation when present.
    const id = msg?.requestId;
    if (id) {
      const waiter = waiters.get(id);
      if (waiter) {
        waiters.delete(id);
        clearTimeout(waiter.timer);
        if (msg.ok === false) waiter.reject(new Error(msg.error || 'Native host error'));
        else waiter.resolve(msg);
      }
      // A reply whose waiter already timed out is stale. Never hand it to a
      // DIFFERENT waiter: a late "print ok" resolving the next print request
      // would mark the new job as done without printing → 用户重打 → 重复出纸.
      return;
    }
    // Id-less reply: resolve oldest waiter (host loop is strictly sequential).
    const first = waiters.keys().next().value;
    if (first != null) {
      const { resolve, reject, timer } = waiters.get(first);
      waiters.delete(first);
      clearTimeout(timer);
      if (msg?.ok === false) reject(new Error(msg.error || 'Native host error'));
      else resolve(msg);
    }
  });

  port.onDisconnect.addListener(() => {
    const err = chrome.runtime.lastError?.message || 'Native host disconnected';
    for (const [id, w] of waiters.entries()) {
      clearTimeout(w.timer);
      w.reject(new Error(err));
      waiters.delete(id);
    }
    cachedPort = null;
  });
}

export function getNativePort() {
  if (cachedPort) return cachedPort;
  try {
    const port = chrome.runtime.connectNative(NATIVE_HOST);
    attachPort(port);
    cachedPort = port;
    return port;
  } catch (err) {
    throw new Error(
      `无法连接本地打印代理 (${NATIVE_HOST})。请先安装 native-host。${err.message || ''}`
    );
  }
}

export function nativeRequest(action, payload = {}, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    let port;
    try {
      port = getNativePort();
    } catch (err) {
      reject(err);
      return;
    }

    // If connectNative failed asynchronously
    if (chrome.runtime.lastError) {
      reject(new Error(chrome.runtime.lastError.message));
      cachedPort = null;
      return;
    }

    const requestId = nextId();
    const timer = setTimeout(() => {
      waiters.delete(requestId);
      reject(new Error(`本地打印代理超时: ${action}`));
    }, timeoutMs);

    waiters.set(requestId, { resolve, reject, timer });
    try {
      port.postMessage({ action, requestId, payload });
    } catch (err) {
      clearTimeout(timer);
      waiters.delete(requestId);
      cachedPort = null;
      reject(err);
    }
  });
}

/** One-shot connectNative via sendNativeMessage (simpler, no persistent port). */
export function nativeSend(action, payload = {}, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`本地打印代理超时: ${action}`)), timeoutMs);
    try {
      chrome.runtime.sendNativeMessage(NATIVE_HOST, { action, payload }, (response) => {
        clearTimeout(timer);
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (!response) {
          reject(new Error('本地打印代理无响应'));
          return;
        }
        if (response.ok === false) {
          reject(new Error(response.error || 'Native host error'));
          return;
        }
        resolve(response);
      });
    } catch (err) {
      clearTimeout(timer);
      reject(err);
    }
  });
}

export async function probeNativeHost() {
  try {
    const res = await nativeSend('ping', {}, 5000);
    return { available: true, ...res };
  } catch (err) {
    return { available: false, error: err.message || String(err) };
  }
}
