const updateBox = document.getElementById('updateBox');
const btnCheck = document.getElementById('checkUpdate');
const btnApply = document.getElementById('applyUpdate');
const btnUninstall = document.getElementById('uninstall');
let hostConnected = false;

function setUpdateMsg(text, kind) {
  if (!updateBox) return;
  updateBox.textContent = text || '';
  updateBox.className = text ? `show ${kind || ''}` : '';
}

function setBusy(busy) {
  [btnCheck, btnApply, btnUninstall].forEach((el) => {
    if (el) el.disabled = busy || !hostConnected;
  });
}

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
      hostConnected = true;
      setBusy(false);
      dot.className = 'dot ok';
      status.textContent = '已连接';
      const product = res.productVersion ? ` 安装包 v${res.productVersion}` : '';
      detail.textContent = `代理 v${res.version || '?'} · ${res.platform || ''} ${res.arch || ''}${product}`;
      if (hostVer) hostVer.textContent = res.productVersion || res.version || '?';
      checkUpdate(true);
    } else {
      hostConnected = false;
      setBusy(false);
      dot.className = 'dot bad';
      status.textContent = '未安装';
      detail.textContent = res?.error || '请点击「安装说明」';
      if (hostVer) hostVer.textContent = '未连接';
      hint.classList.add('show');
    }
  } catch (err) {
    hostConnected = false;
    setBusy(false);
    dot.className = 'dot bad';
    status.textContent = '错误';
    detail.textContent = err.message || String(err);
    if (hostVer) hostVer.textContent = '错误';
    hint.classList.add('show');
  }
}

async function checkUpdate(silent) {
  try {
    if (!silent) setBusy(true);
    const res = await chrome.runtime.sendMessage({ type: 'CHECK_UPDATE' });
    if (res?.newer) {
      setUpdateMsg(`发现新版本 v${res.latest}（当前 v${res.current}）。可点「立即升级」。`, 'warn');
    } else if (res?.ok) {
      if (silent) setUpdateMsg('');
      else setUpdateMsg(`已是最新版 v${res.current || res.latest}`, 'ok');
    } else if (!silent) {
      setUpdateMsg(
        (res?.error || '无法检查更新') + '。也可运行安装目录里的 Update-PrintKit，或指定内网 zip。',
        'bad'
      );
    }
    return res;
  } catch (err) {
    if (!silent) setUpdateMsg(err.message || String(err), 'bad');
    return null;
  } finally {
    if (!silent) setBusy(false);
  }
}

async function applyUpdate() {
  setBusy(true);
  setUpdateMsg('正在下载并覆盖安装，请稍候（可能需 1–2 分钟）…', 'warn');
  try {
    const res = await chrome.runtime.sendMessage({ type: 'APPLY_UPDATE' });
    if (!res?.ok) throw new Error(res?.error || '升级失败');
    if (res.skipped) {
      setUpdateMsg(`已是最新版 v${res.latest || res.current}`, 'ok');
      return;
    }
    setUpdateMsg(`已升级到 v${res.latest}，正在重载扩展…`, 'ok');
    setTimeout(() => chrome.runtime.reload(), 800);
  } catch (err) {
    setUpdateMsg(
      (err.message || String(err)) +
        '。可改用开始菜单「Update PrintKit」，或重跑最新安装包。',
      'bad'
    );
  } finally {
    setBusy(false);
  }
}

async function uninstall() {
  const ok = window.confirm(
    '确定卸载 PrintKit 本地打印代理？\n\n将删除安装目录并注销打印。\n扩展还需在 chrome://extensions 中手动移除。'
  );
  if (!ok) return;
  setBusy(true);
  setUpdateMsg('正在卸载…', 'warn');
  try {
    const res = await chrome.runtime.sendMessage({ type: 'UNINSTALL_PRINTKIT' });
    if (!res?.ok) throw new Error(res?.error || '卸载失败');
    setUpdateMsg('卸载已开始。请到 chrome://extensions 移除 PrintKit 扩展。', 'ok');
  } catch (err) {
    setUpdateMsg(err.message || String(err), 'bad');
  } finally {
    setBusy(false);
  }
}

document.getElementById('refresh').addEventListener('click', refresh);
document.getElementById('openGuide').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({
    type: 'OPEN_INSTALL_GUIDE',
    reason: '请按说明安装 PrintKit 本地打印代理后，再使用静默打印。',
  });
});
btnCheck.addEventListener('click', () => checkUpdate(false));
btnApply.addEventListener('click', applyUpdate);
btnUninstall.addEventListener('click', uninstall);
refresh();
