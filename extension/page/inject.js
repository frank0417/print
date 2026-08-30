/**
 * Page-world API aligned with classic jatoolsPrinter.
 * Injected into every page so business code can call:
 *   jatoolsPrinter.printPreview(myDoc)
 *   jatoolsPrinter.print(myDoc, showDialog)
 *   getJCP().printPreview(myDoc)  /  getJCP().then(jcp => jcp.printPreview(myDoc))
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
    const prefix =
      myDoc.page_div_prefix || myDoc.pageDivPrefix || myDoc.pagePrefix || '';
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
      if (result && result.ok === false) {
        const err = new Error(result.error || '打印失败');
        err.code = result.code;
        err.result = result;
        if (typeof myDoc.done === 'function') {
          try {
            myDoc.done(err, result);
          } catch (_) {
            /* ignore */
          }
        }
        throw err;
      }
      if (typeof myDoc.done === 'function') {
        try {
          myDoc.done(null, result);
        } catch (_) {
          /* ignore user callback errors */
        }
      }
      return result;
    } catch (err) {
      if (typeof myDoc.done === 'function' && !err.result) {
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
     *   true  → 打开预览；预览窗点「打印」走本地代理
     *   false → 本地代理静默打印；未安装时弹出安装说明（不自动回退）
     */
    print(myDoc, showDialog = true) {
      return runPrint(myDoc, 'print', showDialog !== false);
    },

    /** 列出本机打印机（需安装 native-host；未安装会提示） */
    async getPrinters(options = {}) {
      const result = await callExtension('GET_PRINTERS', {});
      // bridge may return array (legacy) or object
      if (Array.isArray(result)) return result;
      if (result?.hostAvailable === false) {
        if (options.promptInstall !== false) {
          await callExtension('OPEN_INSTALL_GUIDE', {
            reason: result.error || '获取打印机需要先安装本地打印代理',
          }).catch(() => {});
        }
        const err = new Error(result.error || '本地打印代理未安装');
        err.code = result.code || 'HOST_NOT_INSTALLED';
        err.printers = [];
        throw err;
      }
      return result?.printers || [];
    },

    async getDefaultPrinter() {
      try {
        const list = await api.getPrinters({ promptInstall: false });
        return list?.find((p) => p.isDefault) || list?.[0] || null;
      } catch (_) {
        return null;
      }
    },

    /** 探测本地打印代理是否可用 */
    async getHostStatus() {
      return callExtension('GET_HOST_STATUS', {});
    },

    /** 打开安装说明窗口 */
    async openInstallGuide(reason) {
      return callExtension('OPEN_INSTALL_GUIDE', {
        reason: reason || '请安装 PrintKit 本地打印代理',
      });
    },

    isInstalled() {
      return true;
    },

    version: '0.3.0',
  };

  // Classic global
  window.jatoolsPrinter = api;
  // Alias for newer naming / project brand
  window.printKit = api;
  window.PrintKit = api;

  /**
   * Dual-compat getter. Must be a plain object (not a Promise instance):
   *   getJCP().printPreview(myDoc)           — classic JSP / jcpfree.js
   *   getJCP().then(jcp => jcp.printPreview) — Promise style
   * Extra properties on native Promise are stripped by .then / Promise.resolve.
   */
  function wrapJcp(apiObj) {
    const wrapped = {
      printPreview(myDoc, _progress) {
        return apiObj.printPreview(myDoc);
      },
      print(myDoc, showDialog) {
        return apiObj.print(myDoc, showDialog);
      },
      getPrinters(options) {
        return apiObj.getPrinters(options);
      },
      getDefaultPrinter() {
        return apiObj.getDefaultPrinter();
      },
      getHostStatus() {
        return apiObj.getHostStatus();
      },
      openInstallGuide(reason) {
        return apiObj.openInstallGuide(reason);
      },
      isInstalled() {
        return apiObj.isInstalled ? apiObj.isInstalled() : true;
      },
      version: apiObj.version,
      then(resolve, reject) {
        return Promise.resolve(apiObj).then(resolve, reject);
      },
      catch(reject) {
        return Promise.resolve(apiObj).catch(reject);
      },
    };
    return wrapped;
  }

  window.getJCP = function getJCP() {
    return wrapJcp(api);
  };
  window.getJatoolsPrinter = window.getJCP;
  window.declareJatoolsPrinter = function declareJatoolsPrinter() {};

  window.dispatchEvent(new CustomEvent('printkit-ready', { detail: { version: api.version } }));
})();
