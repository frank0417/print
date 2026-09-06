const params = new URLSearchParams(location.search);
const reason = params.get('reason') || '';
const jobId = params.get('jobId') || '';

const els = {
  reason: document.getElementById('reason'),
  dot: document.getElementById('dot'),
  status: document.getElementById('status'),
  detail: document.getElementById('detail'),
  btnRecheck: document.getElementById('btnRecheck'),
  btnPreview: document.getElementById('btnPreview'),
  btnClose: document.getElementById('btnClose'),
};

if (reason) {
  els.reason.textContent = reason;
}

els.btnPreview.hidden = !jobId;

async function recheck() {
  els.status.textContent = '检测中…';
  els.dot.className = 'dot';
  els.detail.textContent = '';
  els.btnRecheck.disabled = true;
  try {
    const res = await chrome.runtime.sendMessage({ type: 'GET_HOST_STATUS' });
    if (res?.available) {
      els.dot.className = 'dot ok';
      els.status.textContent = '已安装并连接';
      els.detail.textContent = `v${res.version || '?'} · ${res.platform || ''} ${res.arch || ''} · 可关闭本窗口后重试打印`;
    } else {
      els.dot.className = 'dot bad';
      els.status.textContent = '仍未检测到';
      els.detail.textContent = res?.error || '请完成安装脚本后点击重新检测';
    }
  } catch (err) {
    els.dot.className = 'dot bad';
    els.status.textContent = '检测失败';
    els.detail.textContent = err.message || String(err);
  } finally {
    els.btnRecheck.disabled = false;
  }
}

els.btnRecheck.addEventListener('click', recheck);

els.btnPreview.addEventListener('click', async () => {
  els.btnPreview.disabled = true;
  try {
    const res = await chrome.runtime.sendMessage({
      type: 'OPEN_PREVIEW_FOR_JOB',
      jobId,
    });
    if (res?.error) throw new Error(res.error);
    window.close();
  } catch (err) {
    els.detail.textContent = err.message || String(err);
    els.btnPreview.disabled = false;
  }
});

els.btnClose.addEventListener('click', () => window.close());

recheck();
