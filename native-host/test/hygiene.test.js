'use strict';

var assert = require('assert');
var fs = require('fs');
var os = require('os');
var path = require('path');
var hygiene = require('../lib/hygiene');

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'printkit-hygiene-test-'));
}

var failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log('ok  ' + name);
  } catch (err) {
    failures += 1;
    console.log('FAIL  ' + name);
    console.log('  ' + (err && err.stack ? err.stack : err));
  }
}

check('isMktempJobDir accepts mkdtemp names', function () {
  assert.strictEqual(hygiene.isMktempJobDir('printkit-a1b2c3'), true);
  assert.strictEqual(hygiene.isMktempJobDir('printkit-XXXXXX'), true);
});

check('isMktempJobDir rejects chrome profiles and logs', function () {
  assert.strictEqual(hygiene.isMktempJobDir('printkit-chrome-cdp'), false);
  assert.strictEqual(hygiene.isMktempJobDir('printkit-chrome-kiosk'), false);
  assert.strictEqual(hygiene.isMktempJobDir('printkit-chrome-profile'), false);
  assert.strictEqual(hygiene.isMktempJobDir('printkit-host.log'), false);
  assert.strictEqual(hygiene.isMktempJobDir('printkit-gdi-print.ps1'), false);
});

check('rmRecursive deletes a nested tree', function () {
  var dir = mkTmp();
  fs.writeFileSync(path.join(dir, 'a.txt'), 'x');
  fs.mkdirSync(path.join(dir, 'sub'));
  fs.writeFileSync(path.join(dir, 'sub', 'b.txt'), 'y');
  hygiene.rmRecursive(dir);
  assert.strictEqual(fs.existsSync(dir), false);
});

check('pruneStaleJobDirs removes old printkit job dirs only', function () {
  var tmp = mkTmp();
  var oldJob = path.join(tmp, 'printkit-oldjob');
  var freshJob = path.join(tmp, 'printkit-newjob');
  var profile = path.join(tmp, 'printkit-chrome-cdp');
  fs.mkdirSync(oldJob);
  fs.writeFileSync(path.join(oldJob, 'job.pdf'), 'pdf');
  fs.mkdirSync(freshJob);
  fs.writeFileSync(path.join(freshJob, 'job.pdf'), 'pdf');
  fs.mkdirSync(profile);
  fs.writeFileSync(path.join(profile, 'Preferences'), '{}');

  var ancient = new Date(Date.now() - 3 * 60 * 60 * 1000);
  fs.utimesSync(oldJob, ancient, ancient);

  var result = hygiene.pruneStaleJobDirs({ tmpdir: tmp, maxAgeMs: 2 * 60 * 60 * 1000 });
  assert.strictEqual(result.removed, 1);
  assert.strictEqual(fs.existsSync(oldJob), false);
  assert.strictEqual(fs.existsSync(freshJob), true);
  assert.strictEqual(fs.existsSync(profile), true);
  hygiene.rmRecursive(tmp);
});

check('scheduleRemoveDir(0) deletes immediately', function () {
  var dir = mkTmp();
  fs.writeFileSync(path.join(dir, 'job.html'), '<html></html>');
  hygiene.scheduleRemoveDir(dir, 0);
  assert.strictEqual(fs.existsSync(dir), false);
});

check('rotateLogIfNeeded rolls over a large log', function () {
  var logFile = hygiene.LOG_PATH;
  var backup = logFile + '.hygiene-test-bak';
  var old = logFile + '.old';
  var hadLog = fs.existsSync(logFile);
  if (hadLog) fs.renameSync(logFile, backup);
  try {
    if (fs.existsSync(old)) fs.unlinkSync(old);
    var chunk = Buffer.alloc(hygiene.LOG_MAX_BYTES + 100, 0x61);
    fs.writeFileSync(logFile, chunk);
    var rotated = hygiene.rotateLogIfNeeded();
    assert.strictEqual(rotated, true);
    assert.strictEqual(fs.existsSync(old), true);
    assert.strictEqual(fs.existsSync(logFile), false);
    hygiene.appendLog('after-rotate\n');
    var body = fs.readFileSync(logFile, 'utf8');
    assert.ok(body.indexOf('after-rotate') >= 0);
  } finally {
    try {
      fs.unlinkSync(logFile);
    } catch (_) {}
    try {
      fs.unlinkSync(old);
    } catch (_) {}
    if (hadLog) fs.renameSync(backup, logFile);
  }
});

check('pruneChromeCaches drops GPU/code caches but keeps the profile dir', function () {
  var dir = mkTmp();
  var gpu = path.join(dir, 'Default', 'GPUCache');
  fs.mkdirSync(gpu, { recursive: true });
  fs.writeFileSync(path.join(gpu, 'data_0'), 'cache');
  fs.writeFileSync(path.join(dir, 'First Run'), '');
  hygiene.pruneChromeCaches(dir);
  assert.strictEqual(fs.existsSync(gpu), false);
  assert.strictEqual(fs.existsSync(path.join(dir, 'First Run')), true);
  hygiene.rmRecursive(dir);
});

check('resetChromeSession drops tab-restore files', function () {
  var dir = mkTmp();
  var def = path.join(dir, 'Default');
  fs.mkdirSync(path.join(def, 'Sessions'), { recursive: true });
  fs.writeFileSync(path.join(def, 'Last Session'), 'old');
  fs.writeFileSync(path.join(def, 'Current Tabs'), 'tabs');
  fs.writeFileSync(path.join(def, 'Preferences'), '{}');
  hygiene.resetChromeSession(dir);
  assert.strictEqual(fs.existsSync(path.join(def, 'Last Session')), false);
  assert.strictEqual(fs.existsSync(path.join(def, 'Current Tabs')), false);
  assert.strictEqual(fs.existsSync(path.join(def, 'Sessions')), false);
  assert.strictEqual(fs.existsSync(path.join(def, 'Preferences')), true);
  hygiene.rmRecursive(dir);
});

check('chromeLockPresent sees lockfile', function () {
  var dir = mkTmp();
  assert.strictEqual(hygiene.chromeLockPresent(dir), false);
  fs.writeFileSync(path.join(dir, 'lockfile'), '');
  assert.strictEqual(hygiene.chromeLockPresent(dir), true);
  hygiene.rmRecursive(dir);
});

if (failures) {
  console.log(failures + ' failed');
  process.exit(1);
}
console.log('all passed');
