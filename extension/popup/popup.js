async function refresh() {
  const dot = document.getElementById('dot');
  const status = document.getElementById('status');
  const detail = document.getElementById('detail');
  const hint = document.getElementById('installHint');
  const extVer = document.getElementById('extVer');
  const hostVer = document.getElementById('hostVer');
  const manifest = chrome.runtime.getManifest();
  if (extVer) extVer.textContent = manifest.version || '?';
  status.textContent = '检测中…';
  dot.className = 'dot';
  detail.textContent = '';
  hint.classList.remove('show');

  try {
    const res = await chrome.runtime.sendMessage({ type: 'GET_HOST_STATUS' });
    if (res?.available) {
      dot.className = 'dot ok';
      status.textContent = '已连接';
      detail.textContent = `代理 v${res.version || '?'} · ${res.platform || ''} ${res.arch || ''}`;
      if (hostVer) hostVer.textContent = res.version || '?';
    } else {
      dot.className = 'dot bad';
      status.textContent = '未安装';
      detail.textContent = res?.error || '请点击「安装说明」';
      if (hostVer) hostVer.textContent = '未连接';
      hint.classList.add('show');
    }
  } catch (err) {
    dot.className = 'dot bad';
    status.textContent = '错误';
    detail.textContent = err.message || String(err);
    if (hostVer) hostVer.textContent = '错误';
    hint.classList.add('show');
  }
}

document.getElementById('refresh').addEventListener('click', refresh);
document.getElementById('openGuide').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({
    type: 'OPEN_INSTALL_GUIDE',
    reason: '请按说明安装 PrintKit 本地打印代理后，再使用静默打印。',
  });
});
refresh();
