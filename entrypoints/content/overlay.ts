import type { PendingAsset } from '@/src/core/domain/entities';
import type { AssetRole } from '@/src/core/domain/enums';

type CaptureAnchor = {
  range?: Range;
};

type TrackedItem = {
  id: string;
  range?: Range;
};

/**
 * Keeps DOM ranges needed for capture overlap detection and forwards capture
 * requests. Captured content is intentionally not decorated on the page.
 */
export type OverlayManager = ReturnType<typeof createOverlayManager>;

export function createOverlayManager() {
  const tracked = new Map<string, TrackedItem>();
  /** Cloned range of the selection at the last right-click / toolbar action. */
  let lastSelectionRange: Range | null = null;
  /** Anchor for the next asset-added or asset-replaced message from background. */
  let pendingAnchor: CaptureAnchor | null = null;

  document.addEventListener(
    'contextmenu',
    () => {
      const sel = window.getSelection();
      lastSelectionRange =
        sel && sel.rangeCount > 0 && !sel.isCollapsed ? sel.getRangeAt(0).cloneRange() : null;
    },
    true,
  );

  /** Find a tracked text item whose DOM range intersects the candidate range. */
  function findDomOverlap(candidate: Range): string | null {
    for (const item of tracked.values()) {
      if (!item.range) continue;
      try {
        const startsBeforeEnd = candidate.compareBoundaryPoints(Range.END_TO_START, item.range) < 0;
        const endsAfterStart = candidate.compareBoundaryPoints(Range.START_TO_END, item.range) > 0;
        if (startsBeforeEnd && endsAfterStart) return item.id;
      } catch {
        /* different documents or detached range */
      }
    }
    return null;
  }

  /** Capture the current text selection and send it as a pending asset. */
  function captureSelection(role: AssetRole | null, explicitRange?: Range | null): boolean {
    const sel = window.getSelection();
    const range =
      explicitRange ??
      (sel && sel.rangeCount > 0 && !sel.isCollapsed ? sel.getRangeAt(0).cloneRange() : lastSelectionRange);
    const text = range ? range.toString() : (sel?.toString() ?? '');
    if (!text.trim()) return false;
    pendingAnchor = range ? { range } : null;
    chrome.runtime.sendMessage({
      type: 'capture/createPendingAsset',
      payload: {
        pageUrl: location.href,
        pageTitle: document.title,
        assetType: 'text',
        textContent: text,
        role,
        domOverlapWith: range ? findDomOverlap(range) : null,
        capturedAt: new Date().toISOString(),
      },
    });
    return true;
  }

  /** Capture an <img>/<video> element directly (keyboard summon flow). */
  function captureMediaElement(el: HTMLImageElement | HTMLVideoElement, role: AssetRole | null): void {
    const assetType = el.tagName === 'IMG' ? 'image' : 'video';
    const srcUrl = (el as HTMLVideoElement).currentSrc || (el as HTMLImageElement).src || undefined;
    chrome.runtime.sendMessage({
      type: 'capture/createPendingAsset',
      payload: {
        pageUrl: location.href,
        pageTitle: document.title,
        assetType,
        originalUrl: srcUrl,
        role,
        capturedAt: new Date().toISOString(),
      },
    });
  }

  return {
    captureSelection,
    captureMediaElement,
    trackAsset: (asset: PendingAsset, anchor: CaptureAnchor): void => {
      tracked.set(asset.id, {
        id: asset.id,
        range: asset.assetType === 'text' ? anchor.range : undefined,
      });
    },
    removeAsset: (id: string): void => {
      tracked.delete(id);
    },
    clearTracked: (): void => {
      tracked.clear();
    },
    consumePendingAnchor: (): CaptureAnchor | null => {
      const anchor = pendingAnchor;
      pendingAnchor = null;
      return anchor;
    },
    anchorOf: (id: string): CaptureAnchor | null => {
      const item = tracked.get(id);
      return item?.range ? { range: item.range } : null;
    },
  };
}
