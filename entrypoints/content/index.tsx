import ReactDOM from 'react-dom/client';
import type { PendingAsset } from '@/src/core/domain/entities';
import { createOverlayManager } from './overlay';
import PanelApp from './PanelApp';
import './style.css';

export default defineContentScript({
  matches: ['<all_urls>'],
  allFrames: false,
  cssInjectionMode: 'ui',
  async main(ctx) {
    const overlay = createOverlayManager();

    // Background ↔ content overlay protocol.
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      switch (message.type) {
        case 'toolbar/summon':
          // From the chrome.commands browser-level shortcut.
          window.dispatchEvent(new CustomEvent('prompttrace:summon'));
          return sendResponse({ ok: true });
        case 'overlay/captureSelection': {
          const ok = overlay.captureSelection(null);
          return sendResponse({ ok });
        }
        case 'overlay/markMedia':
          overlay.markMedia(message.payload.srcUrl, message.payload.assetType);
          return sendResponse({ ok: true });
        case 'overlay/assetAdded': {
          const asset: PendingAsset = message.payload.asset;
          overlay.addFrame(asset, overlay.consumePendingAnchor() ?? {});
          return sendResponse({ ok: true });
        }
        case 'overlay/roleChanged':
          overlay.setRoleColor(message.payload.pendingAssetId, message.payload.role);
          return sendResponse({ ok: true });
        case 'overlay/removeFrame':
          overlay.removeFrame(message.payload.pendingAssetId);
          return sendResponse({ ok: true });
        case 'overlay/replaceFrame': {
          const anchor = overlay.consumePendingAnchor() ?? overlay.anchorOf(message.payload.oldId) ?? {};
          overlay.removeFrame(message.payload.oldId);
          overlay.addFrame(message.payload.asset, anchor);
          return sendResponse({ ok: true });
        }
        case 'overlay/clearAll':
          overlay.clearAll();
          return sendResponse({ ok: true });
        case 'overlay/flash':
          overlay.flash(message.payload.pendingAssetId);
          return sendResponse({ ok: true });
        default:
          return;
      }
    });

    // Floating UI (selection toolbar + right-edge glass panel) in a shadow root.
    const ui = await createShadowRootUi(ctx, {
      name: 'prompttrace-ui',
      position: 'overlay',
      anchor: 'html',
      zIndex: 2147483647,
      onMount: (container) => {
        const root = ReactDOM.createRoot(container);
        root.render(<PanelApp overlay={overlay} />);
        return root;
      },
      onRemove: (root) => root?.unmount(),
    });
    ui.mount();
  },
});
