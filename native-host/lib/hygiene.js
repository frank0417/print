'use strict';

/**
 * Runtime hygiene for the long-lived Native Messaging host.
 * Compatible with bundled Node 12 (Windows 7).
 *
 * The host stays up for the lifetime of chrome.runtime.connectNative().
 * Without cleanup, temp jobs / logs / leftover Chrome profiles grow until
 * the warehouse PC starts stuttering after a few hours of printing.
 */

var fs = require('fs');
var os = require('os');
var path = require('path');
var { spawnSync } = require('child_process');

var LOG_PATH = path.join(os.tmpdir(), 'printkit-host.log');
var LOG_MAX_BYTES = 2 * 1024 * 1024;
var JOB_DIR_MAX_AGE_MS = 2 * 60 * 60 * 1000;
var CHROME_PROFILE_DIRS = [
  'printkit-chrome-cdp',
  'printkit-chrome-profile',
  'printkit-chrome-kiosk',
];

function logPath() {
  return LOG_PATH;
}

function rmRecursive(p) {
  if (!p || !fs.existsSync(p)) return;
  var st;
  try {
    st = fs.lstatSync(p);
  } catch (_) {
    return;
  }
  if (st.isDirectory()) {
    var names = [];
    try {
      names = fs.readdirSync(p);
    } catch (_) {
      return;
    }
    for (var i = 0; i < names.length; i++) {
      rmRecursive(path.join(p, names[i]));
    }
    try {
      fs.rmdirSync(p);
    } catch (_) {
      /* still in use */
    }
  } else {
    try {
      fs.unlinkSync(p);
    } catch (_) {
      /* still in use */
    }
  }
}

function rotateLogIfNeeded() {
  try {
    var st = fs.statSync(LOG_PATH);
    if (!st || st.size < LOG_MAX_BYTES) return false;
    var old = LOG_PATH + '.old';
    try {
      fs.unlinkSync(old);
    } catch (_) {
      /* ignore */
    }
    fs.renameSync(LOG_PATH, old);
    return true;
  } catch (_) {
    return false;
  }
}

function appendLog(line) {
  try {
    rotateLogIfNeeded();
    fs.appendFileSync(LOG_PATH, line);
  } catch (_) {
    /* ignore */
  }
}

function isMktempJobDir(name) {
  // fs.mkdtemp('printkit-') → printkit-XXXXXX (random, not our profile names)
  if (!/^printkit-[A-Za-z0-9_-]+$/.test(name)) return false;
  for (var i = 0; i < CHROME_PROFILE_DIRS.length; i++) {
    if (name === CHROME_PROFILE_DIRS[i]) return false;
  }
  return (
    name.indexOf('chrome') < 0 &&
    name.indexOf('update') < 0 &&
    name.indexOf('gdi') < 0 &&
    name.indexOf('probe') < 0 &&
    name.indexOf('devmode') < 0
  );
}

function pruneStaleJobDirs(opts) {
  opts = opts || {};
  var tmp = opts.tmpdir || os.tmpdir();
  var maxAge = opts.maxAgeMs != null ? opts.maxAgeMs : JOB_DIR_MAX_AGE_MS;
  var now = Date.now();
  var removed = 0;
  var names = [];
  try {
    names = fs.readdirSync(tmp);
  } catch (_) {
    return { removed: 0 };
  }
  for (var i = 0; i < names.length; i++) {
    var name = names[i];
    if (!isMktempJobDir(name)) continue;
    var full = path.join(tmp, name);
    var st;
    try {
      st = fs.statSync(full);
    } catch (_) {
      continue;
    }
    if (!st.isDirectory()) continue;
    var mtime = st.mtimeMs != null ? st.mtimeMs : st.mtime && st.mtime.getTime();
    if (mtime && now - mtime > maxAge) {
      rmRecursive(full);
      removed += 1;
    }
  }
  return { removed: removed };
}

function scheduleRemoveDir(dir, delayMs) {
  if (!dir) return;
  var wait = delayMs == null ? 15000 : Number(delayMs) || 0;
  if (wait <= 0) {
    rmRecursive(dir);
    return;
  }
  var t = setTimeout(function () {
    rmRecursive(dir);
  }, wait);
  if (t && typeof t.unref === 'function') t.unref();
}

function killProcessTree(pid) {
  if (!pid) return;
  try {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
        windowsHide: true,
        timeout: 5000,
      });
    } else {
      try {
        process.kill(Number(pid), 'SIGKILL');
      } catch (_) {
        /* ignore */
      }
    }
  } catch (_) {
    /* ignore */
  }
}

/**
 * Kill only Chrome/Edge instances launched with our user-data-dir.
 * Never matches the user's everyday Chrome profile.
 */
function killByUserDataDir(profileDir) {
  if (!profileDir) return;
  var marker = String(profileDir);
  if (process.platform === 'win32') {
    var n = marker.replace(/'/g, "''");
    spawnSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        "$ErrorActionPreference='SilentlyContinue';$m='" +
          n +
          "'; Get-WmiObject Win32_Process | Where-Object { $_.CommandLine -like ('*' + $m + '*') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }",
      ],
      { windowsHide: true, timeout: 8000, encoding: 'utf8' }
    );
    return;
  }
  spawnSync('pkill', ['-f', marker], { timeout: 5000, encoding: 'utf8' });
}

function chromeProfilePath(name) {
  return path.join(os.tmpdir(), name || CHROME_PROFILE_DIRS[0]);
}

function pruneChromeCaches(profileDir) {
  if (!profileDir || !fs.existsSync(profileDir)) return;
  var extra = [
    path.join(profileDir, 'Crashpad'),
    path.join(profileDir, 'BrowserMetrics'),
    path.join(profileDir, 'Default', 'GPUCache'),
    path.join(profileDir, 'Default', 'Code Cache'),
    path.join(profileDir, 'Default', 'Cache'),
    path.join(profileDir, 'Default', 'Service Worker'),
    path.join(profileDir, 'ShaderCache'),
    path.join(profileDir, 'GrShaderCache'),
  ];
  for (var i = 0; i < extra.length; i++) {
    rmRecursive(extra[i]);
  }
}

/**
 * Drop tab-restore files so the next --kiosk-printing launch does not
 * reopen the previous job HTML and window.print() it again.
 * (We taskkill kiosk Chrome after each job, which Chrome treats as a crash.)
 */
function resetChromeSession(profileDir) {
  if (!profileDir) return;
  var def = path.join(profileDir, 'Default');
  var files = [
    'Current Session',
    'Current Tabs',
    'Last Session',
    'Last Tabs',
    'Visited Links',
  ];
  for (var i = 0; i < files.length; i++) {
    rmRecursive(path.join(def, files[i]));
  }
  rmRecursive(path.join(def, 'Sessions'));
  rmRecursive(path.join(profileDir, 'Crashpad'));
}

function chromeLockPresent(profileDir) {
  if (!profileDir) return false;
  var names = ['lockfile', 'SingletonLock', 'SingletonSocket', 'SingletonCookie'];
  for (var i = 0; i < names.length; i++) {
    try {
      if (fs.existsSync(path.join(profileDir, names[i]))) return true;
    } catch (_) {
      /* ignore */
    }
  }
  return false;
}

module.exports = {
  LOG_PATH: LOG_PATH,
  LOG_MAX_BYTES: LOG_MAX_BYTES,
  logPath: logPath,
  rmRecursive: rmRecursive,
  rotateLogIfNeeded: rotateLogIfNeeded,
  appendLog: appendLog,
  isMktempJobDir: isMktempJobDir,
  pruneStaleJobDirs: pruneStaleJobDirs,
  scheduleRemoveDir: scheduleRemoveDir,
  killProcessTree: killProcessTree,
  killByUserDataDir: killByUserDataDir,
  chromeProfilePath: chromeProfilePath,
  pruneChromeCaches: pruneChromeCaches,
  resetChromeSession: resetChromeSession,
  chromeLockPresent: chromeLockPresent,
  CHROME_PROFILE_DIRS: CHROME_PROFILE_DIRS,
};
