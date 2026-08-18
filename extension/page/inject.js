/**
 * Page-world API aligned with classic jatoolsPrinter.
 * Injected into every page so business code can call:
 *   jatoolsPrinter.printPreview(myDoc)
 *   jatoolsPrinter.print(myDoc, showDialog)
 *   getJCP().then(jcp => jcp.printPreview(myDoc))
 */
(function injectPrintKit() {
  if (window.__printKitInjected) return;
  window.__printKitInjected = true;

  const SOURCE = 'printkit-page';
  const REPLY = 'printkit-page-reply';
  let seq = 0;
  const pending = new Map();

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== REPLY) return;
    const waiter = pending.get(data.id);
    if (!waiter) return;
    pending.delete(data.id);
    if (data.ok) waiter.resolve(data.result);
    else waiter.reject(new Error(data.error || 'PrintKit error'));
  });

  function callExtension(type, payload, timeoutMs = 15000) {
    const id = `pk_${Date.now()}_${++seq}`;
    const wait = type === 'PRINT_JOB' ? 180000 : timeoutMs;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      window.postMessage({ source: SOURCE, id, type, payload }, '*');
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          reject(new Error('PrintKit: 扩展未响应，请确认已安装并启用 PrintKit 扩展'));
        }
      }, wait);
    });
  }

  function collectPageElements(root, prefix = '') {
    const doc = root?.nodeType === 9 ? root : root?.ownerDocument || document;
    const pages = [];
    let i = 1;
    while (i <= 500) {
      const id = `${prefix}page${i}`;
      const el = doc.getElementById(id);
      if (!el) break;
      pages.push(el);
      i += 1;
    }
    return pages;
  }

  function collectStylesheets(doc) {
    const sheets = [];
    for (const node of Array.from(doc.querySelectorAll('link[rel="stylesheet"], style'))) {
      if (node.tagName === 'LINK' && node.href) {
        sheets.push({ type: 'link', href: node.href });
      } else if (node.tagName === 'STYLE') {
        sheets.push({ type: 'style', css: node.textContent || '' });
      }
    }
    return sheets;
  }

  function normalizeDoc(myDoc = {}) {
    if (!myDoc || typeof myDoc !== 'object') {
      throw new Error('PrintKit: myDoc 必须是对象');
    }

    const settings = { ...(myDoc.settings || {}) };
    const prefix = myDoc.page_div_prefix || myDoc.pageDivPrefix || '';
    let pagesHtml = [];
    let stylesheets = [];
    let title = myDoc.title || document.title || '打印文档';

    if (typeof myDoc.documents === 'string') {
      // HTML string document
      pagesHtml = [{ index: 1, id: 'page1', html: myDoc.documents }];
    } else if (Array.isArray(myDoc.documents)) {
      pagesHtml = myDoc.documents.map((item, i) => {
        if (typeof item === 'string') {
          return { index: i + 1, id: `page${i + 1}`, html: item };
        }
        if (item && item.nodeType === 1) {
          return { index: i + 1, id: item.id || `page${i + 1}`, html: item.outerHTML };
        }
        return { index: i + 1, id: `page${i + 1}`, html: String(item ?? '') };
      });
    } else {
      const root = myDoc.documents || document;
      const doc = root.nodeType === 9 ? root : root.ownerDocument || document;
      stylesheets = collectStylesheets(doc);

      let pageEls = collectPageElements(doc, prefix);
      if (!pageEls.length && root.nodeType === 1) {
        pageEls = [root];
      }
      if (!pageEls.length) {
        throw new Error(
          `PrintKit: 未找到可打印页。请放置 id 为 "${prefix}page1"、"${prefix}page2"... 的元素`
        );
      }
      pagesHtml = pageEls.map((el, index) => ({
        index: index + 1,
        id: el.id || `page${index + 1}`,
        html: el.outerHTML,
        width: el.offsetWidth || null,
        height: el.offsetHeight || null,
      }));
    }

    // Overlay / 套打底图：仅预览可见
    const overlay = myDoc.dragables || myDoc.overlay || null;

    return {
      title,
      copyrights: myDoc.copyrights || '',
      settings,
      pages: pagesHtml,
      stylesheets,
      overlay,
      doneName: typeof myDoc.done === 'function' ? true : false,
      sourceUrl: location.href,
    };
  }

  async function runPrint(myDoc, mode, showDialog) {
    const payload = normalizeDoc(myDoc);
    payload.mode = mode; // 'preview' | 'print'
    payload.showDialog = !!showDialog;

    try {
      const result = await callExtension('PRINT_JOB', payload);
      if (typeof myDoc.done === 'function') {
        try {
          myDoc.done(null, result);
        } catch (_) {
          /* ignore user callback errors */
        }
      }
      return result;
    } catch (err) {
      if (typeof myDoc.done === 'function') {
        try {
          myDoc.done(err);
        } catch (_) {
          /* ignore */
        }
      }
      throw err;
    }
  }

  const api = {
    /** 打印预览（对齐 jatoolsPrinter.printPreview） */
    printPreview(myDoc) {
      return runPrint(myDoc, 'preview', true);
    },

    /**
     * 打印（对齐 jatoolsPrinter.print）
     * @param {object} myDoc
     * @param {boolean} [showDialog=true]
     *   true  → 打开预览并调系统打印对话框
     *   false → 优先走本地代理静默打印（settings.printer 可指定打印机）；
     *           未安装代理时回退到预览自动打印
     */
    print(myDoc, showDialog = true) {
      return runPrint(myDoc, 'print', showDialog !== false);
    },

    /** 列出本机打印机（需安装 native-host） */
    async getPrinters() {
      return callExtension('GET_PRINTERS', {});
    },

    async getDefaultPrinter() {
      const list = await api.getPrinters();
      return list?.find((p) => p.isDefault) || list?.[0] || null;
    },

    /** 探测本地打印代理是否可用 */
    async getHostStatus() {
      return callExtension('GET_HOST_STATUS', {});
    },

    isInstalled() {
      return true;
    },

    version: '0.2.0',
  };

  // Classic global
  window.jatoolsPrinter = api;
  // Alias for newer naming / project brand
  window.printKit = api;
  window.PrintKit = api;

  // JCP-style promise getter
  window.getJCP = function getJCP() {
    return Promise.resolve(api);
  };

  window.dispatchEvent(new CustomEvent('printkit-ready', { detail: { version: api.version } }));
})();
