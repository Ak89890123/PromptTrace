// Minimal chrome.* stub so the built MV3 content script can run on a plain
// page for visual QA of the in-page UI (edge panel + selection toolbar).
(() => {
  const listeners = [];
  const session = { assets: [], conflicts: [], errors: [], wizardStage: 'idle' };
  let assetSeq = 0;

  function broadcast() {
    for (const fn of listeners) {
      try {
        fn({ type: 'capture/sessionUpdated', payload: { state: session } }, {}, () => {});
      } catch (e) {
        console.error('listener failed', e);
      }
    }
  }

  const noopEvent = { addListener() {}, removeListener() {}, hasListener: () => false };

  window.chrome = {
    runtime: {
      id: 'harness',
      getURL: (p) => '/' + p,
      sendMessage: async (msg) => {
        console.log('[stub] sendMessage', msg && msg.type);
        if (!msg) return {};
        if (msg.type === 'capture/getSession') return { state: session };
        if (msg.type === 'capture/createPendingAsset') {
          const asset = {
            id: 'a' + ++assetSeq,
            assetType: msg.payload.assetType,
            role: msg.payload.role ?? null,
            textContent: msg.payload.textContent,
            originalUrl: msg.payload.originalUrl,
            pageUrl: msg.payload.pageUrl,
            pageTitle: msg.payload.pageTitle,
            capturedAt: msg.payload.capturedAt,
          };
          session.assets.push(asset);
          broadcast();
          // mimic background → content overlay echo
          for (const fn of listeners) {
            fn({ type: 'overlay/assetAdded', payload: { asset } }, {}, () => {});
          }
          return { ok: true };
        }
        if (msg.type === 'capture/assignAssetRole') {
          const a = session.assets.find((x) => x.id === msg.payload.pendingAssetId);
          if (a) a.role = msg.payload.role;
          broadcast();
          return { ok: true };
        }
        if (msg.type === 'capture/clearSession') {
          session.assets.length = 0;
          broadcast();
          return { ok: true };
        }
        if (msg.type === 'taxonomy/get') {
          return {
            categories: [
              { id: 'c1', parentId: null, name: '生文', isBuiltin: true, isActive: true, sortOrder: 0 },
              { id: 'c2', parentId: 'c1', name: '改寫', isBuiltin: false, isActive: true, sortOrder: 0 },
            ],
            presets: [
              { id: 'p1', modelName: 'Claude', provider: 'Anthropic', isActive: true, isDefault: false, sortOrder: 0 },
            ],
          };
        }
        return { ok: true };
      },
      onMessage: {
        addListener: (fn) => listeners.push(fn),
        removeListener: (fn) => {
          const i = listeners.indexOf(fn);
          if (i >= 0) listeners.splice(i, 1);
        },
        hasListener: () => true,
      },
      onConnect: noopEvent,
      connect: () => ({
        onDisconnect: noopEvent,
        onMessage: noopEvent,
        postMessage() {},
        disconnect() {},
      }),
    },
    storage: {
      local: {
        get: async () => ({}),
        set: async () => {},
      },
      onChanged: noopEvent,
    },
    tabs: { query: async () => [] },
  };
  window.browser = window.chrome;
})();
