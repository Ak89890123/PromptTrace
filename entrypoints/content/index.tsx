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

    // Background ↔ content capture protocol.
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      switch (message.type) {
        case 'toolbar/summon':
          // From the chrome.commands browser-level shortcut.
          window.dispatchEvent(new CustomEvent('prompttrace:summon'));
          return sendResponse({ ok: true });
        case 'capture/captureSelection': {
          const ok = overlay.captureSelection(null);
          return sendResponse({ ok });
        }
        case 'capture/assetAdded': {
          const asset: PendingAsset = message.payload.asset;
          overlay.trackAsset(asset, overlay.consumePendingAnchor() ?? {});
          return sendResponse({ ok: true });
        }
        case 'capture/assetRemoved':
          overlay.removeAsset(message.payload.pendingAssetId);
          return sendResponse({ ok: true });
        case 'capture/clearTracked':
          overlay.clearTracked();
          return sendResponse({ ok: true });
        case 'capture/assetReplaced': {
          const anchor = overlay.consumePendingAnchor() ?? {};
          overlay.removeAsset(message.payload.oldId);
          overlay.trackAsset(message.payload.asset, anchor);
          return sendResponse({ ok: true });
        }
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
