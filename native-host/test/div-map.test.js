'use strict';

var assert = require('assert');
var divMap = require('../../extension/lib/div-map.js');

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

function el(id) {
  return {
    id: id,
    nodeType: 1,
    offsetWidth: 794,
    offsetHeight: 559,
    outerHTML: '<div id="' + id + '">page ' + id + '</div>',
    querySelectorAll: function () {
      return [];
    },
    cloneNode: function () {
      return el(id);
    },
  };
}

function doc(map) {
  return {
    nodeType: 9,
    getElementById: function (id) {
      return map[id] || null;
    },
    querySelectorAll: function () {
      return [];
    },
  };
}

check('sequential page1..pageN mapping', function () {
  var d = doc({ page1: el('page1'), page2: el('page2'), page3: el('page3') });
  var pages = divMap.collectMappedPages({ documents: d }, d);
  assert.strictEqual(pages.length, 3);
  assert.deepStrictEqual(
    pages.map(function (p) {
      return p.id;
    }),
    ['page1', 'page2', 'page3']
  );
});

check('stops at first missing sequential id', function () {
  var d = doc({ page1: el('page1'), page3: el('page3') });
  var pages = divMap.collectMappedPages({ documents: d }, d);
  assert.strictEqual(pages.length, 1);
  assert.strictEqual(pages[0].id, 'page1');
});

check('page_div_prefix maps so_page1, so_page2', function () {
  var d = doc({ so_page1: el('so_page1'), so_page2: el('so_page2') });
  var pages = divMap.collectMappedPages({ documents: d, page_div_prefix: 'so_' }, d);
  assert.strictEqual(pages.length, 2);
  assert.strictEqual(pages[0].id, 'so_page1');
});

check('explicit pageIds list (arbitrary DIV ids)', function () {
  var d = doc({ head: el('head'), body: el('body'), foot: el('foot') });
  var pages = divMap.collectMappedPages({ documents: d, pageIds: ['head', 'foot'] }, d);
  assert.strictEqual(pages.length, 2);
  assert.strictEqual(pages[0].id, 'head');
  assert.strictEqual(pages[1].id, 'foot');
});

check('documents object is an id→html map', function () {
  var pages = divMap.collectMappedPages({
    documents: { page2: '<b>two</b>', page1: '<b>one</b>' },
  });
  assert.strictEqual(pages.length, 2);
  assert.strictEqual(pages[0].id, 'page1');
  assert.strictEqual(pages[0].html, '<b>one</b>');
  assert.strictEqual(pages[1].id, 'page2');
});

check('HTML string documents is a single page', function () {
  var pages = divMap.collectMappedPages({ documents: '<div id="page1">x</div>' });
  assert.strictEqual(pages.length, 1);
  assert.ok(pages[0].html.indexOf('page1') >= 0);
});

check('missing pages produce a DIV ID mapping error', function () {
  var msg = divMap.missingPageError({ page_div_prefix: 'bill_' });
  assert.ok(msg.indexOf('bill_page1') >= 0);
});

check('pxToMm matches 96dpi', function () {
  assert.strictEqual(divMap.pxToMm(96), 25.4);
});

if (failures) {
  console.log(failures + ' failed');
  process.exit(1);
}
console.log('all passed');
