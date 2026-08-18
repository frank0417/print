async function refresh() {
  const dot = document.getElementById('dot');
  const status = document.getElementById('status');
  const detail = document.getElementById('detail');
  status.textContent = '检测中…';
  dot.className = 'dot';
  detail.textContent = '';

  try {
    const res = await chrome.runtime.sendMessage({ type: 'GET_HOST_STATUS' });
    if (res?.available) {
      dot.className = 'dot ok';
      status.textContent = '已连接';
      detail.textContent = `v${res.version || '?'} · ${res.platform || ''} ${res.arch || ''}`;
    } else {
      dot.className = 'dot bad';
      status.textContent = '未安装';
      detail.textContent = res?.error || '请运行 native-host 安装脚本';
    }
  } catch (err) {
    dot.className = 'dot bad';
    status.textContent = '错误';
    detail.textContent = err.message || String(err);
  }
}

document.getElementById('refresh').addEventListener('click', refresh);
refresh();
