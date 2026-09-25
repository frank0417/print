/**
 * DIV ID 映射打印 — PrintKit 的核心排版协议。
 *
 * 页面上的 HTML 就是模板：按 id 锁定 DOM 节点，一页一 DIV，
 * 不必转成私有格式，也不必再维护一份设计器模板。
 *
 * 查找顺序：
 *   1. myDoc.pageIds / page_ids / ids          显式 id 列表
 *   2. myDoc.documents 为 { id: html|Element } 的映射表
 *   3. 连续 id：`${page_div_prefix}page1` … pageN（缺号即停）
 *
 * 可在 Node（测试）与页面世界共用。浏览器侧的像素级快照见 capturePageSnapshot。
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  if (typeof root !== 'undefined') {
    root.PrintKitDivMap = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var MAX_PAGES = 500;
  var PX_PER_IN = 96;
  var MM_PER_IN = 25.4;

  function asArray(v) {
    if (!v) return [];
    if (Array.isArray(v)) return v;
    return [];
  }

  function isNode(v) {
    return !!(v && typeof v === 'object' && typeof v.nodeType === 'number');
  }

  function isDocument(v) {
    return isNode(v) && v.nodeType === 9;
  }

  function isElement(v) {
    return isNode(v) && v.nodeType === 1;
  }

  function pagePrefix(myDoc) {
    if (!myDoc || typeof myDoc !== 'object') return '';
    var p = myDoc.page_div_prefix || myDoc.pageDivPrefix || myDoc.pagePrefix;
    return p == null ? '' : String(p);
  }

  /**
   * Resolve the list of DIV ids that become print pages.
   * `lookup` is optional: function(id) => truthy if that id exists.
   */
  function resolvePageIds(myDoc, lookup) {
    myDoc = myDoc || {};
    var explicit = myDoc.pageIds || myDoc.page_ids || myDoc.ids;
    if (Array.isArray(explicit) && explicit.length) {
      return explicit.map(function (id) {
        return String(id);
      }).filter(Boolean);
    }

    var docs = myDoc.documents;
    if (docs && typeof docs === 'object' && !isNode(docs) && !Array.isArray(docs)) {
      var keys = Object.keys(docs);
      keys.sort(function (a, b) {
        var ma = /^page(\d+)$/i.exec(a);
        var mb = /^page(\d+)$/i.exec(b);
        if (ma && mb) return Number(ma[1]) - Number(mb[1]);
        if (ma) return -1;
        if (mb) return 1;
        return a.localeCompare(b);
      });
      return keys;
    }

    var prefix = pagePrefix(myDoc);
    var ids = [];
    var get = typeof lookup === 'function' ? lookup : null;
    if (!get) return ids;
    for (var i = 1; i <= MAX_PAGES; i += 1) {
      var id = prefix + 'page' + i;
      if (!get(id)) break;
      ids.push(id);
    }
    return ids;
  }

  function lookupFromDoc(doc) {
    if (!doc || typeof doc.getElementById !== 'function') {
      return function () {
        return null;
      };
    }
    return function (id) {
      return doc.getElementById(id);
    };
  }

  /**
   * Collect page records from a document / myDoc.
   * Returns [{ index, id, node?, html? }].
   */
  function collectMappedPages(myDoc, root) {
    myDoc = myDoc || {};
    var docs = myDoc.documents;

    if (typeof docs === 'string') {
      return [{ index: 1, id: 'page1', html: docs }];
    }

    if (Array.isArray(docs)) {
      return docs.map(function (item, i) {
        if (typeof item === 'string') {
          return { index: i + 1, id: 'page' + (i + 1), html: item };
        }
        if (isElement(item)) {
          return { index: i + 1, id: item.id || 'page' + (i + 1), node: item };
        }
        if (item && typeof item === 'object') {
          return {
            index: i + 1,
            id: item.id || 'page' + (i + 1),
            html: item.html != null ? String(item.html) : String(item),
            node: isElement(item.node) ? item.node : null,
          };
        }
        return { index: i + 1, id: 'page' + (i + 1), html: String(item == null ? '' : item) };
      });
    }

    var doc = null;
    if (isDocument(root)) doc = root;
    else if (isElement(root)) doc = root.ownerDocument || null;
    else if (isDocument(docs)) doc = docs;
    else if (isElement(docs)) doc = docs.ownerDocument || null;

    if (docs && typeof docs === 'object' && !isNode(docs)) {
      var mapKeys = resolvePageIds(myDoc);
      return mapKeys.map(function (id, i) {
        var item = docs[id];
        if (typeof item === 'string') {
          return { index: i + 1, id: id, html: item };
        }
        if (isElement(item)) {
          return { index: i + 1, id: item.id || id, node: item };
        }
        return { index: i + 1, id: id, html: String(item == null ? '' : item) };
      });
    }

    var lookup = lookupFromDoc(doc);
    var ids = resolvePageIds(myDoc, lookup);
    var pages = [];
    for (var i = 0; i < ids.length; i += 1) {
      var el = lookup(ids[i]);
      if (isElement(el)) {
        pages.push({ index: i + 1, id: el.id || ids[i], node: el });
      } else if (el) {
        pages.push({ index: i + 1, id: ids[i], html: String(el) });
      }
    }

    if (!pages.length && isElement(docs)) {
      pages.push({ index: 1, id: docs.id || 'page1', node: docs });
    }
    if (!pages.length && isElement(root) && !isDocument(root)) {
      pages.push({ index: 1, id: root.id || 'page1', node: root });
    }
    return pages;
  }

  function pxToMm(px) {
    var n = Number(px);
    if (!n || n <= 0) return null;
    return Math.round(((n * MM_PER_IN) / PX_PER_IN) * 100) / 100;
  }

  function inferBoxMm(page) {
    var w = page && (page.width || page.offsetWidth || page.scrollWidth);
    var h = page && (page.height || page.offsetHeight || page.scrollHeight);
    if (page && page.node) {
      w = Math.max(page.node.offsetWidth || 0, page.node.scrollWidth || 0, w || 0);
      h = Math.max(page.node.offsetHeight || 0, page.node.scrollHeight || 0, h || 0);
    }
    return { widthMm: pxToMm(w), heightMm: pxToMm(h), widthPx: w || null, heightPx: h || null };
  }

  function missingPageError(myDoc) {
    var prefix = pagePrefix(myDoc);
    var explicit = asArray(myDoc && (myDoc.pageIds || myDoc.page_ids || myDoc.ids));
    if (explicit.length) {
      return 'PrintKit: 未找到可打印页。pageIds 映射的节点不存在：' + explicit.join(', ');
    }
    return (
      'PrintKit: 未找到可打印页。请放置 id 为 "' +
      prefix +
      'page1"、"' +
      prefix +
      'page2"... 的元素（DIV ID 映射打印）'
    );
  }

  /**
   * Absolute-ize URLs and freeze form/canvas state so the snapshot
   * matches what the user sees on screen.
   */
  function capturePageSnapshot(el, doc) {
    if (!isElement(el)) {
      return { html: '', width: null, height: null };
    }
    doc = doc || el.ownerDocument || (typeof document !== 'undefined' ? document : null);
    var width = Math.max(el.offsetWidth || 0, el.scrollWidth || 0) || null;
    var height = Math.max(el.offsetHeight || 0, el.scrollHeight || 0) || null;

    var html;
    try {
      var clone = el.cloneNode(true);
      freezeCanvases(el, clone);
      freezeMedia(clone, doc);
      freezeFormValues(el, clone);
      html = clone.outerHTML;
    } catch (_) {
      html = el.outerHTML;
    }
    return { html: html, width: width, height: height };
  }

  function freezeCanvases(srcEl, clone) {
    var srcList = srcEl.querySelectorAll ? srcEl.querySelectorAll('canvas') : [];
    var dstList = clone.querySelectorAll ? clone.querySelectorAll('canvas') : [];
    for (var i = 0; i < srcList.length && i < dstList.length; i += 1) {
      var src = srcList[i];
      var dst = dstList[i];
      try {
        var url = src.toDataURL('image/png');
        var img = clone.ownerDocument
          ? clone.ownerDocument.createElement('img')
          : dst.ownerDocument.createElement('img');
        img.setAttribute('src', url);
        if (src.width) img.setAttribute('width', String(src.width));
        if (src.height) img.setAttribute('height', String(src.height));
        img.setAttribute('alt', src.getAttribute('alt') || '');
        if (dst.parentNode) dst.parentNode.replaceChild(img, dst);
      } catch (_) {
        /* tainted canvas */
      }
    }
  }

  function freezeMedia(clone, doc) {
    if (!clone.querySelectorAll) return;
    var imgs = clone.querySelectorAll('img');
    for (var i = 0; i < imgs.length; i += 1) {
      var img = imgs[i];
      var src = img.currentSrc || img.src;
      if (src) img.setAttribute('src', src);
    }
    var sources = clone.querySelectorAll('source, video, audio');
    for (var j = 0; j < sources.length; j += 1) {
      var node = sources[j];
      if (node.src) node.setAttribute('src', node.src);
    }
    var useDoc = doc || (typeof document !== 'undefined' ? document : null);
    if (!useDoc || !useDoc.createElement) return;
    var links = clone.querySelectorAll('[href]');
    for (var k = 0; k < links.length; k += 1) {
      var a = links[k];
      var href = a.getAttribute('href');
      if (!href || href.charAt(0) === '#' || /^javascript:/i.test(href)) continue;
      try {
        var abs = a.href;
        if (abs) a.setAttribute('href', abs);
      } catch (_) {
        /* ignore */
      }
    }
  }

  function freezeFormValues(srcEl, clone) {
    var sel = 'input, textarea, select';
    var srcList = srcEl.querySelectorAll ? srcEl.querySelectorAll(sel) : [];
    var dstList = clone.querySelectorAll ? clone.querySelectorAll(sel) : [];
    for (var i = 0; i < srcList.length && i < dstList.length; i += 1) {
      var src = srcList[i];
      var dst = dstList[i];
      var tag = (src.tagName || '').toLowerCase();
      var type = String(src.type || '').toLowerCase();
      if (tag === 'textarea') {
        dst.textContent = src.value;
      } else if (tag === 'select') {
        dst.value = src.value;
        var opts = dst.querySelectorAll('option');
        for (var o = 0; o < opts.length; o += 1) {
          if (opts[o].value === src.value) opts[o].setAttribute('selected', 'selected');
          else opts[o].removeAttribute('selected');
        }
      } else if (type === 'checkbox' || type === 'radio') {
        if (src.checked) dst.setAttribute('checked', 'checked');
        else dst.removeAttribute('checked');
      } else if (type !== 'password') {
        dst.setAttribute('value', src.value);
      }
    }
  }

  function collectStylesheets(doc) {
    var sheets = [];
    if (!doc || !doc.querySelectorAll) return sheets;
    var nodes = doc.querySelectorAll('link[rel="stylesheet"], style');
    for (var i = 0; i < nodes.length; i += 1) {
      var node = nodes[i];
      if (node.tagName === 'LINK' && node.href) {
        sheets.push({ type: 'link', href: node.href });
      } else if (node.tagName === 'STYLE') {
        sheets.push({ type: 'style', css: node.textContent || '' });
      }
    }
    return sheets;
  }

  return {
    MAX_PAGES: MAX_PAGES,
    pagePrefix: pagePrefix,
    resolvePageIds: resolvePageIds,
    collectMappedPages: collectMappedPages,
    capturePageSnapshot: capturePageSnapshot,
    collectStylesheets: collectStylesheets,
    inferBoxMm: inferBoxMm,
    pxToMm: pxToMm,
    missingPageError: missingPageError,
    isNode: isNode,
    isElement: isElement,
    isDocument: isDocument,
  };
});
