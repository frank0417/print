/**
 * Content-script bridge: inject page API + relay messages to the service worker.
 */
(function bridge() {
  const PAGE_SOURCE = 'printkit-page';
  const PAGE_REPLY = 'printkit-page-reply';

  function injectPageScript() {
    try {
      const src = chrome.runtime.getURL('page/inject.js');
      const script = document.documentElement
        ? document.documentElement.ownerDocument.createElement('script')
        : null;
      const s = document.createElement('script');
      s.src = src;
      s.async = false;
      s.dataset.printkit = '1';
      (document.documentElement || document.head || document).appendChild(s);
      s.onload = () => s.remove();
    } catch (err) {
      console.warn('[PrintKit] inject failed', err);
    }
  }

  injectPageScript();

  window.addEventListener('message', async (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== PAGE_SOURCE || !data.id) return;

    const reply = (ok, result, error) => {
      window.postMessage(
        {
          source: PAGE_REPLY,
          id: data.id,
          ok,
          result,
          error: error ? String(error.message || error) : undefined,
        },
        '*'
      );
    };

    try {
      if (data.type === 'PRINT_JOB') {
        const result = await chrome.runtime.sendMessage({
          type: 'PRINT_JOB',
          payload: data.payload,
        });
        if (result?.error) throw new Error(result.error);
        reply(true, result);
        return;
      }

      if (data.type === 'GET_PRINTERS') {
        const result = await chrome.runtime.sendMessage({ type: 'GET_PRINTERS' });
        if (result?.error) throw new Error(result.error);
        reply(true, result?.printers || []);
        return;
      }

      reply(false, null, new Error(`未知消息类型: ${data.type}`));
    } catch (err) {
      // Extension context invalidated etc.
      reply(false, null, err);
    }
  });
})();
