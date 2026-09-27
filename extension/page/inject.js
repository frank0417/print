/**
 * Page-world API aligned with classic jatoolsPrinter.
 * Core protocol: DIV ID 映射打印 — HTML 即模板，锁定 pageN（或自定义 id）直接出纸。
 *
 *   jatoolsPrinter.printPreview(myDoc)
 *   jatoolsPrinter.print(myDoc, showDialog)
 *   getJCP().printPreview(myDoc)
 */
(function injectPrintKit() {
  if (window.__printKitInjected) return;
  window.__printKitInjected = true;

  const SOURCE = 'printkit-page';
  const REPLY = 'printkit-page-reply';
  const DivMap = window.PrintKitDivMap;
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

  function ownerDoc(root) {
    if (!root) return document;
    if (root.nodeType === 9) return root;
    return root.ownerDocument || document;
  }

  function snapshotPage(rec, doc) {
    if (rec.html != null && !rec.node) {
      return {
        index: rec.index,
        id: rec.id || `page${rec.index}`,
        html: rec.html,
        width: rec.width || null,
        height: rec.height || null,
      };
    }
    const el = rec.node;
    const snap = DivMap
      ? DivMap.capturePageSnapshot(el, doc)
      : {
          html: el ? el.outerHTML : rec.html || '',
          width: el ? Math.max(el.offsetWidth || 0, el.scrollWidth || 0) : null,
          height: el ? Math.max(el.offsetHeight || 0, el.scrollHeight || 0) : null,
        };
    return {
      index: rec.index,
      id: rec.id || (el && el.id) || `page${rec.index}`,
      html: snap.html,
      width: snap.width,
      height: snap.height,
    };
  }

  function collectPages(myDoc) {
    const root = myDoc.documents || document;
    const doc = ownerDoc(root);
    if (DivMap) {
      const mapped = DivMap.collectMappedPages(myDoc, root);
      if (!mapped.length) {
        throw new Error(DivMap.missingPageError(myDoc));
      }
      return {
        pages: mapped.map((rec) => snapshotPage(rec, doc)),
        stylesheets: DivMap.collectStylesheets(doc),
        doc,
      };
    }

    // Fallback if div-map.js failed to inject.
    const prefix = myDoc.page_div_prefix || myDoc.pageDivPrefix || myDoc.pagePrefix || '';
    const pages = [];
    let i = 1;
    while (i <= 500) {
      const id = `${prefix}page${i}`;
      const el = doc.getElementById(id);
      if (!el) break;
      pages.push({
        index: i,
        id: el.id || id,
        html: el.outerHTML,
        width: Math.max(el.offsetWidth || 0, el.scrollWidth || 0) || null,
        height: Math.max(el.offsetHeight || 0, el.scrollHeight || 0) || null,
      });
      i += 1;
    }
    if (!pages.length && root && root.nodeType === 1) {
      pages.push({
        index: 1,
        id: root.id || 'page1',
        html: root.outerHTML,
        width: Math.max(root.offsetWidth || 0, root.scrollWidth || 0) || null,
        height: Math.max(root.offsetHeight || 0, root.scrollHeight || 0) || null,
      });
    }
    if (!pages.length) {
      throw new Error(
        `PrintKit: 未找到可打印页。请放置 id 为 "${prefix}page1"、"${prefix}page2"... 的元素`
      );
    }
    const sheets = [];
    for (const node of Array.from(doc.querySelectorAll('link[rel="stylesheet"], style'))) {
      if (node.tagName === 'LINK' && node.href) sheets.push({ type: 'link', href: node.href });
      else if (node.tagName === 'STYLE') sheets.push({ type: 'style', css: node.textContent || '' });
    }
    return { pages, stylesheets: sheets, doc };
  }

  function normalizeDoc(myDoc = {}) {
    if (!myDoc || typeof myDoc !== 'object') {
      throw new Error('PrintKit: myDoc 必须是对象');
    }

    const settings = { ...(myDoc.settings || {}) };
    const title = myDoc.title || document.title || '打印文档';
    const { pages, stylesheets } = collectPages(myDoc);

    const mappedIds = pages.map((p) => p.id);
    settings.divMap = {
      prefix: myDoc.page_div_prefix || myDoc.pageDivPrefix || myDoc.pagePrefix || '',
      ids: mappedIds,
      mode: 'div-id',
    };

    // Infer label/paper size from the first page box (px → mm @96dpi).
    const hasCustomSize =
      settings.pageWidth != null ||
      settings.pageHeight != null ||
      settings.width != null ||
      settings.height != null;
    const first = pages[0];
    if (!hasCustomSize && first && first.width > 40 && first.height > 40) {
      const mm = (px) => Math.round(((Number(px) * 25.4) / 96) * 100) / 100;
      settings.pageWidth = mm(first.width);
      settings.pageHeight = mm(first.height);
      settings.paperName = 'Custom';
      if (settings.orientation == null && settings.pageWidth > settings.pageHeight) {
        settings.orientation = 2;
      }
      if (
        settings.marginTop == null &&
        settings.marginRight == null &&
        settings.marginBottom == null &&
        settings.marginLeft == null &&
        settings.topMargin == null &&
        settings.rightMargin == null &&
        settings.bottomMargin == null &&
        settings.leftMargin == null
      ) {
        settings.marginTop = 0;
        settings.marginRight = 0;
        settings.marginBottom = 0;
        settings.marginLeft = 0;
      }
    }

    const overlay = myDoc.dragables || myDoc.overlay || null;
    if (myDoc.backgroundImage && !settings.backgroundImage) {
      settings.backgroundImage = myDoc.backgroundImage;
    }

    return {
      title,
      copyrights: myDoc.copyrights || '',
      settings,
      pages,
      stylesheets,
      overlay,
      mappedIds,
      doneName: typeof myDoc.done === 'function' ? true : false,
      sourceUrl: location.href,
    };
  }

  async function runPrint(myDoc, mode, showDialog) {
    const payload = normalizeDoc(myDoc);
    payload.mode = mode;
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

    /**
     * 列出当前页已被 DIV ID 映射到的打印节点（不触发打印）。
     * 便于业务自检：页面长什么样，纸上就是什么样。
     */
    listMappedPages(myDoc = {}) {
      const { pages } = collectPages({ ...myDoc, documents: myDoc.documents || document });
      return pages.map((p) => ({
        index: p.index,
        id: p.id,
        width: p.width,
        height: p.height,
      }));
    },

    async getPrinters(options = {}) {
      const result = await callExtension('GET_PRINTERS', {});
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

    async getHostStatus() {
      return callExtension('GET_HOST_STATUS', {});
    },

    async openInstallGuide(reason) {
      return callExtension('OPEN_INSTALL_GUIDE', {
        reason: reason || '请安装 PrintKit 本地打印代理',
      });
    },

    isInstalled() {
      return true;
    },

    version: '0.6.0',
    engine: 'div-id-map',
  };

  window.jatoolsPrinter = api;
  window.printKit = api;
  window.PrintKit = api;

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
      listMappedPages(myDoc) {
        return apiObj.listMappedPages(myDoc);
      },
      isInstalled() {
        return apiObj.isInstalled ? apiObj.isInstalled() : true;
      },
      version: apiObj.version,
      engine: apiObj.engine,
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

  window.dispatchEvent(
    new CustomEvent('printkit-ready', { detail: { version: api.version, engine: api.engine } })
  );
})();
