'use strict';

var assert = require('assert');
var htmlToPdf = require('../lib/html-to-pdf');

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

check('printOffset reads mm X/Y', function () {
  var off = htmlToPdf.printOffset({ offsetX: 2.5, offsetY: -1 });
  assert.strictEqual(off.x, 2.5);
  assert.strictEqual(off.y, -1);
});

check('buildHtmlDocument applies translate offset', function () {
  var html = htmlToPdf.buildHtmlDocument({
    title: 'offset-job',
    pages: [{ id: 'page1', html: '<div id="page1">hello</div>' }],
    stylesheets: [],
    settings: { paperName: 'A4', offsetX: 1.5, offsetY: -0.8 },
  });
  assert.ok(html.indexOf('translate(1.5mm, -0.8mm)') >= 0);
  assert.ok(html.indexOf('id="page1"') >= 0);
});

check('zero offset still emits translate(0mm, 0mm)', function () {
  var html = htmlToPdf.buildHtmlDocument({
    title: 'zero',
    pages: [{ html: '<div id="page1">x</div>' }],
    settings: { paperName: 'A5', orientation: 2 },
  });
  assert.ok(html.indexOf('translate(0mm, 0mm)') >= 0);
});

check('background is omitted unless printBackground=true', function () {
  var html = htmlToPdf.buildHtmlDocument({
    title: 'bg',
    pages: [{ html: '<div id="page1">x</div>' }],
    settings: {
      paperName: 'A4',
      backgroundImage: 'data:image/png;base64,AAAA',
      printBackground: false,
    },
  });
  assert.ok(html.indexOf('pk-page::before') < 0);
});

if (failures) {
  console.log(failures + ' failed');
  process.exit(1);
}
console.log('all passed');
