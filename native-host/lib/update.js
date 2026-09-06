'use strict';

/**
 * PrintKit in-place updater / uninstaller.
 * Compatible with bundled Node 12 (Windows 7).
 *
 * Remote upgrade sources (first match wins for applyUpdate):
 *   payload.zipPath  local or UNC zip (\\\\server\\share\\PrintKit-Setup-windows.zip)
 *   payload.url      http(s) zip URL (internal mirror)
 *   GitHub Releases  latest / tagged PrintKit-Setup-*.zip
 */

var fs = require('fs');
var os = require('os');
var path = require('path');
var http = require('http');
var https = require('https');
var zlib = require('zlib');
var urlMod = require('url');
var { spawn, spawnSync, execFileSync } = require('child_process');

var REPO = 'frank0417/print';
var USER_AGENT = 'PrintKit-Updater/0.5.29';
var HOST_NAME = 'com.printkit.host';
var EXT_ID = 'memmopnlapcegennpipheiadaonehljd';
var SETUP_ZIP = {
  win32: 'PrintKit-Setup-windows.zip',
  darwin: 'PrintKit-Setup-macos.zip',
};

function log() {
  var args = Array.prototype.slice.call(arguments);
  var line =
    '[' +
    new Date().toISOString() +
    '] ' +
    args
      .map(function (a) {
        return typeof a === 'string' ? a : JSON.stringify(a);
      })
      .join(' ') +
    '\n';
  try {
    fs.appendFileSync(path.join(os.tmpdir(), 'printkit-update.log'), line);
  } catch (_) {
    /* ignore */
  }
}

function mkdirp(dir) {
  if (!dir || fs.existsSync(dir)) return;
  mkdirp(path.dirname(dir));
  try {
    fs.mkdirSync(dir);
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
  }
}

function looksLikeInstall(dir) {
  return (
    dir &&
    fs.existsSync(path.join(dir, 'host', 'host.js')) &&
    fs.existsSync(path.join(dir, 'extension', 'manifest.json'))
  );
}

function findInstallRoot() {
  var hostDir = path.join(__dirname, '..');
  var parent = path.join(hostDir, '..');
  if (looksLikeInstall(parent)) return parent;
  if (process.platform === 'win32') {
    var win = path.join(process.env.LOCALAPPDATA || '', 'PrintKit');
    if (looksLikeInstall(win)) return win;
    return win;
  }
  var mac = path.join(os.homedir(), 'Library', 'Application Support', 'PrintKit');
  if (looksLikeInstall(mac)) return mac;
  return parent;
}

function readKeyValueFile(filePath) {
  var out = {};
  if (!fs.existsSync(filePath)) return out;
  var text = fs.readFileSync(filePath, 'utf8');
  var lines = text.split(/\r?\n/);
  for (var i = 0; i < lines.length; i++) {
    var m = lines[i].match(/^\s*([A-Za-z0-9_.-]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return null;
  }
}

function parseVer(raw) {
  var s = String(raw || '').replace(/^v/i, '');
  var parts = s.split(/[^\d]+/);
  return [
    parseInt(parts[0], 10) || 0,
    parseInt(parts[1], 10) || 0,
    parseInt(parts[2], 10) || 0,
  ];
}

function cmpVer(a, b) {
  var x = parseVer(a);
  var y = parseVer(b);
  for (var i = 0; i < 3; i++) {
    if (x[i] > y[i]) return 1;
    if (x[i] < y[i]) return -1;
  }
  return 0;
}

function readLocalVersion(installRoot) {
  var root = installRoot || findInstallRoot();
  var fromTxt = readKeyValueFile(path.join(root, 'VERSION.txt')).version;
  if (fromTxt) return String(fromTxt).replace(/^v/i, '');
  var man = readJsonFile(path.join(root, 'extension', 'manifest.json'));
  if (man && man.version) return String(man.version).replace(/^v/i, '');
  var pkg = readJsonFile(path.join(__dirname, '..', 'package.json'));
  if (pkg && pkg.version) return String(pkg.version).replace(/^v/i, '');
  return '0.0.0';
}

function setupZipName() {
  return SETUP_ZIP[process.platform] || SETUP_ZIP.win32;
}

function githubDownloadUrl(tag) {
  var t = String(tag || '').replace(/^v/i, '');
  if (!t) {
    return 'https://github.com/' + REPO + '/releases/latest/download/' + setupZipName();
  }
  return 'https://github.com/' + REPO + '/releases/download/v' + t + '/' + setupZipName();
}

function httpsRequest(targetUrl, destPath, redirectLeft) {
  if (redirectLeft == null) redirectLeft = 6;
  return new Promise(function (resolve, reject) {
    var parsed = urlMod.parse(targetUrl);
    var lib = parsed.protocol === 'http:' ? http : https;
    var opts = {
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.path,
      method: 'GET',
      headers: {
        'User-Agent': USER_AGENT,
        Accept: destPath ? '*/*' : 'application/vnd.github+json',
      },
    };
    var req = lib.request(opts, function (res) {
      var loc = res.headers && res.headers.location;
      if (res.statusCode >= 300 && res.statusCode < 400 && loc) {
        res.resume();
        if (redirectLeft <= 0) {
          reject(new Error('Too many redirects: ' + targetUrl));
          return;
        }
        var next = urlMod.resolve(targetUrl, loc);
        httpsRequest(next, destPath, redirectLeft - 1).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        var errChunks = [];
        res.on('data', function (c) {
          if (errChunks.length < 20) errChunks.push(c);
        });
        res.on('end', function () {
          reject(
            new Error(
              'HTTP ' + res.statusCode + ' ' + targetUrl + ' ' + Buffer.concat(errChunks).toString('utf8').slice(0, 200)
            )
          );
        });
        return;
      }
      if (destPath) {
        mkdirp(path.dirname(destPath));
        var out = fs.createWriteStream(destPath);
        res.pipe(out);
        out.on('finish', function () {
          resolve({ path: destPath, headers: res.headers });
        });
        out.on('error', reject);
        return;
      }
      var chunks = [];
      res.on('data', function (c) {
        chunks.push(c);
      });
      res.on('end', function () {
        resolve({
          body: Buffer.concat(chunks).toString('utf8'),
          headers: res.headers,
          url: targetUrl,
        });
      });
    });
    req.setTimeout(destPath ? 10 * 60 * 1000 : 20000, function () {
      req.abort();
      reject(new Error('Timeout fetching ' + targetUrl));
    });
    req.on('error', reject);
    req.end();
  });
}

function tagFromLocation(loc) {
  if (!loc) return '';
  var m = String(loc).match(/\/releases\/tag\/v?([^/?#]+)/i);
  return m ? m[1] : '';
}

function fetchLatestTag() {
  return httpsRequest('https://api.github.com/repos/' + REPO + '/releases/latest')
    .then(function (res) {
      var data = JSON.parse(res.body);
      var tag = String(data.tag_name || data.name || '').replace(/^v/i, '');
      if (!tag) throw new Error('GitHub release has no tag');
      return tag;
    })
    .catch(function (apiErr) {
      log('github api failed', apiErr.message || String(apiErr));
      return httpsRequest('https://github.com/' + REPO + '/releases/latest').then(function (res) {
        var tag = tagFromLocation(res.url) || tagFromLocation((res.headers && res.headers.location) || '');
        if (!tag) throw new Error('Cannot detect latest version (GitHub unreachable: ' + (apiErr.message || apiErr) + ')');
        return tag;
      });
    });
}

function rmrf(dir) {
  if (!fs.existsSync(dir)) return;
  var entries = fs.readdirSync(dir);
  for (var i = 0; i < entries.length; i++) {
    var p = path.join(dir, entries[i]);
    var st;
    try {
      st = fs.lstatSync(p);
    } catch (_) {
      continue;
    }
    if (st.isDirectory()) rmrf(p);
    else {
      try {
        fs.unlinkSync(p);
      } catch (_) {
        /* ignore */
      }
    }
  }
  try {
    fs.rmdirSync(dir);
  } catch (_) {
    /* ignore */
  }
}

function unzipFile(zipPath, destDir) {
  var buf = fs.readFileSync(zipPath);
  var eocd = -1;
  var min = Math.max(0, buf.length - 65557);
  for (var i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Not a zip file: ' + zipPath);
  var count = buf.readUInt16LE(eocd + 10);
  var cdOff = buf.readUInt32LE(eocd + 16);
  var pos = cdOff;
  mkdirp(destDir);
  for (var n = 0; n < count; n++) {
    if (buf.readUInt32LE(pos) !== 0x02014b50) throw new Error('Corrupt zip central directory');
    var method = buf.readUInt16LE(pos + 10);
    var compSize = buf.readUInt32LE(pos + 20);
    var uncompSize = buf.readUInt32LE(pos + 24);
    var nameLen = buf.readUInt16LE(pos + 28);
    var extraLen = buf.readUInt16LE(pos + 30);
    var commentLen = buf.readUInt16LE(pos + 32);
    var localOff = buf.readUInt32LE(pos + 42);
    var name = buf.slice(pos + 46, pos + 46 + nameLen).toString('utf8');
    pos += 46 + nameLen + extraLen + commentLen;

    if (!name || /(?:^|\/|\\)\.\.(?:\/|\\|$)/.test(name) || path.isAbsolute(name)) continue;
    var localNameLen = buf.readUInt16LE(localOff + 26);
    var localExtraLen = buf.readUInt16LE(localOff + 28);
    var dataStart = localOff + 30 + localNameLen + localExtraLen;
    var data = buf.slice(dataStart, dataStart + compSize);
    var outPath = path.join(destDir, name.replace(/\//g, path.sep));
    if (/\/$/.test(name)) {
      mkdirp(outPath);
      continue;
    }
    mkdirp(path.dirname(outPath));
    var content;
    if (method === 0) content = data;
    else if (method === 8) content = zlib.inflateRawSync(data);
    else throw new Error('Unsupported zip method ' + method + ' for ' + name);
    if (uncompSize && content.length !== uncompSize) {
      /* some zips omit sizes; still write */
    }
    fs.writeFileSync(outPath, content);
  }
}

function findAppRoot(extractDir) {
  if (fs.existsSync(path.join(extractDir, 'app', 'host', 'host.js'))) {
    return path.join(extractDir, 'app');
  }
  var names = fs.readdirSync(extractDir);
  for (var i = 0; i < names.length; i++) {
    var p = path.join(extractDir, names[i], 'app');
    if (fs.existsSync(path.join(p, 'host', 'host.js'))) return p;
  }
  throw new Error('Update zip is missing app/host/host.js');
}

function copyFileReplace(src, dest, skipped) {
  mkdirp(path.dirname(dest));
  try {
    fs.copyFileSync(src, dest);
    return;
  } catch (err) {
    if (err.code !== 'EBUSY' && err.code !== 'EPERM' && err.code !== 'EACCES') throw err;
  }
  var bak = dest + '.bak';
  try {
    if (fs.existsSync(bak)) {
      try {
        fs.unlinkSync(bak);
      } catch (_) {
        /* ignore */
      }
    }
    fs.renameSync(dest, bak);
    fs.copyFileSync(src, dest);
    try {
      fs.unlinkSync(bak);
    } catch (_) {
      /* ignore */
    }
  } catch (err2) {
    skipped.push(dest);
    log('skip locked file', dest, err2.message || String(err2));
  }
}

function copyDir(src, dest, skipped) {
  skipped = skipped || [];
  mkdirp(dest);
  var entries = fs.readdirSync(src);
  for (var i = 0; i < entries.length; i++) {
    var s = path.join(src, entries[i]);
    var d = path.join(dest, entries[i]);
    var st = fs.lstatSync(s);
    if (st.isDirectory()) copyDir(s, d, skipped);
    else if (st.isFile()) copyFileReplace(s, d, skipped);
  }
  return skipped;
}

function writeNativeHostRegistration(installRoot) {
  var nodeExe =
    process.platform === 'win32'
      ? path.join(installRoot, 'runtime', 'node', 'node.exe')
      : path.join(installRoot, 'runtime', 'node', 'bin', 'node');
  var hostJs = path.join(installRoot, 'host', 'host.js');
  if (!fs.existsSync(nodeExe)) throw new Error('Bundled Node missing: ' + nodeExe);
  if (!fs.existsSync(hostJs)) throw new Error('host.js missing: ' + hostJs);

  var launcher;
  if (process.platform === 'win32') {
    launcher = path.join(installRoot, 'printkit-host.cmd');
    fs.writeFileSync(launcher, '@echo off\r\n"' + nodeExe + '" "' + hostJs + '" %*\r\n', 'ascii');
  } else {
    launcher = path.join(installRoot, 'printkit-host');
    fs.writeFileSync(launcher, '#!/bin/bash\nexec "' + nodeExe + '" "' + hostJs + '" "$@"\n', 'utf8');
    try {
      fs.chmodSync(launcher, 0o755);
    } catch (_) {
      /* ignore */
    }
  }

  var manifest = {
    name: HOST_NAME,
    description: 'PrintKit Native Messaging Host',
    path: launcher,
    type: 'stdio',
    allowed_origins: ['chrome-extension://' + EXT_ID + '/'],
  };
  var manifestPath = path.join(installRoot, HOST_NAME + '.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  if (process.platform === 'win32') {
    var keys = [
      'HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\' + HOST_NAME,
      'HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\' + HOST_NAME,
      'HKCU\\Software\\Chromium\\NativeMessagingHosts\\' + HOST_NAME,
    ];
    for (var i = 0; i < keys.length; i++) {
      spawnSync('reg', ['add', keys[i], '/ve', '/t', 'REG_SZ', '/d', manifestPath, '/f'], {
        windowsHide: true,
        encoding: 'utf8',
      });
    }
  } else {
    var dirs = [
      path.join(os.homedir(), 'Library/Application Support/Google/Chrome/NativeMessagingHosts'),
      path.join(os.homedir(), 'Library/Application Support/Chromium/NativeMessagingHosts'),
      path.join(os.homedir(), 'Library/Application Support/Microsoft Edge/NativeMessagingHosts'),
    ];
    for (var j = 0; j < dirs.length; j++) {
      mkdirp(dirs[j]);
      fs.writeFileSync(path.join(dirs[j], HOST_NAME + '.json'), JSON.stringify(manifest, null, 2));
    }
  }
  return { launcher: launcher, manifestPath: manifestPath, nodeExe: nodeExe, hostJs: hostJs };
}

function pingHost(reg) {
  try {
    var out = execFileSync(reg.nodeExe, [reg.hostJs, '--cli', 'ping'], {
      encoding: 'utf8',
      timeout: 15000,
      windowsHide: true,
    });
    return String(out || '').trim();
  } catch (err) {
    return 'ping failed: ' + (err.message || String(err));
  }
}

function checkUpdate() {
  var installRoot = findInstallRoot();
  var current = readLocalVersion(installRoot);
  return fetchLatestTag().then(function (latest) {
    return {
      ok: true,
      current: current,
      latest: latest,
      newer: cmpVer(latest, current) > 0,
      installRoot: installRoot,
      zipUrl: githubDownloadUrl(latest),
      latestUrl: githubDownloadUrl(''),
    };
  });
}

function resolveZipSource(payload, latestTag) {
  payload = payload || {};
  if (payload.zipPath) {
    var abs = path.resolve(payload.zipPath);
    if (!fs.existsSync(abs)) throw new Error('Zip not found: ' + abs);
    return { kind: 'file', path: abs };
  }
  if (payload.url) return { kind: 'url', url: payload.url };
  if (latestTag) return { kind: 'url', url: githubDownloadUrl(latestTag) };
  return { kind: 'url', url: githubDownloadUrl('') };
}

function applyUpdate(payload) {
  payload = payload || {};
  if (!payload.url && process.env.PRINTKIT_UPDATE_URL) payload.url = process.env.PRINTKIT_UPDATE_URL;
  if (!payload.zipPath && process.env.PRINTKIT_UPDATE_ZIP) payload.zipPath = process.env.PRINTKIT_UPDATE_ZIP;
  var installRoot = findInstallRoot();
  if (!looksLikeInstall(installRoot)) {
    throw new Error('PrintKit install not found at ' + installRoot);
  }
  var current = readLocalVersion(installRoot);
  var force = payload.force === true;

  return Promise.resolve()
    .then(function () {
      if (payload.zipPath || payload.url) return '';
      return fetchLatestTag().catch(function (err) {
        log('latest tag skipped', err.message || String(err));
        return '';
      });
    })
    .then(function (latest) {
      if (!force && latest && cmpVer(latest, current) <= 0) {
        return {
          ok: true,
          skipped: true,
          reason: 'already-latest',
          current: current,
          latest: latest || current,
          installRoot: installRoot,
        };
      }
      var work = path.join(os.tmpdir(), 'printkit-update-' + Date.now());
      mkdirp(work);
      var source = resolveZipSource(payload, latest);
      var zipFile = source.kind === 'file' ? source.path : path.join(work, setupZipName());
      log('applyUpdate', { current: current, latest: latest, source: source, installRoot: installRoot });

      var ready =
        source.kind === 'file'
          ? Promise.resolve()
          : httpsRequest(source.url, zipFile).then(function () {});

      return ready.then(function () {
        var extractDir = path.join(work, 'extract');
        unzipFile(zipFile, extractDir);
        var appRoot = findAppRoot(extractDir);
        var pkgVer = readKeyValueFile(path.join(appRoot, 'VERSION.txt')).version || latest || current;
        if (!force && cmpVer(pkgVer, current) <= 0 && !payload.url && !payload.zipPath) {
          rmrf(work);
          return {
            ok: true,
            skipped: true,
            reason: 'already-latest',
            current: current,
            latest: pkgVer,
            installRoot: installRoot,
          };
        }

        var skipped = [];
        var names = fs.readdirSync(appRoot);
        for (var i = 0; i < names.length; i++) {
          var s = path.join(appRoot, names[i]);
          var d = path.join(installRoot, names[i]);
          var st = fs.lstatSync(s);
          if (st.isDirectory()) copyDir(s, d, skipped);
          else copyFileReplace(s, d, skipped);
        }

        var reg = writeNativeHostRegistration(installRoot);
        var ping = pingHost(reg);
        rmrf(work);
        return {
          ok: true,
          applied: true,
          current: current,
          latest: String(pkgVer).replace(/^v/i, ''),
          installRoot: installRoot,
          skippedLocked: skipped,
          ping: ping,
          reloadExtension: true,
        };
      });
    });
}

function spawnDetached(command, args, extraEnv) {
  var child = spawn(command, args || [], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    cwd: os.tmpdir(),
    env: extraEnv ? Object.assign({}, process.env, extraEnv) : process.env,
  });
  child.unref();
}

function uninstallPrintKit(payload) {
  payload = payload || {};
  var installRoot = findInstallRoot();
  if (process.platform === 'win32') {
    var bat = path.join(installRoot, 'Uninstall-PrintKit.bat');
    if (fs.existsSync(bat)) {
      spawnDetached('cmd.exe', ['/c', bat, '/S']);
      return {
        ok: true,
        pending: true,
        installRoot: installRoot,
        message: 'Uninstall started. Remove the extension in chrome://extensions.',
      };
    }
    spawnDetached('cmd.exe', [
      '/c',
      'reg delete "HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\' +
        HOST_NAME +
        '" /f & reg delete "HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\' +
        HOST_NAME +
        '" /f & ping 127.0.0.1 -n 2 >nul & rmdir /s /q "' +
        installRoot +
        '"',
    ]);
    return {
      ok: true,
      pending: true,
      installRoot: installRoot,
      message: 'Uninstall started. Remove the extension in chrome://extensions.',
    };
  }

  var sh = path.join(installRoot, 'Uninstall-PrintKit.command');
  if (fs.existsSync(sh)) {
    spawnDetached('/bin/bash', [sh], { PRINTKIT_NO_PAUSE: '1' });
  } else {
    spawnDetached('/bin/bash', [
      '-lc',
      'rm -f "$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts/' +
        HOST_NAME +
        '.json"; rm -rf ' +
        JSON.stringify(installRoot),
    ]);
  }
  return {
    ok: true,
    pending: true,
    installRoot: installRoot,
    message: 'Uninstall started. Remove the extension in chrome://extensions.',
  };
}

module.exports = {
  findInstallRoot: findInstallRoot,
  readLocalVersion: readLocalVersion,
  checkUpdate: checkUpdate,
  applyUpdate: applyUpdate,
  uninstallPrintKit: uninstallPrintKit,
  unzipFile: unzipFile,
  cmpVer: cmpVer,
};
