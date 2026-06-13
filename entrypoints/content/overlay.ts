import type { PendingAsset } from '@/src/core/domain/entities';
import type { AssetRole } from '@/src/core/domain/enums';
import {
  DEFAULT_ROLE_COLORS,
  DEFAULT_SETTINGS,
  loadSettings,
  onSettingsChanged,
  type DisplaySettings,
} from '@/src/ui/roleColors';

type TrackedItem = {
  id: string;
  assetType: PendingAsset['assetType'];
  range?: Range;
  element?: Element;
  frame: HTMLDivElement;
};

/**
 * Draws role-colored frames over captured selections / media in the page
 * (main document, outside the shadow UI so frames hug page content).
 */
export type OverlayManager = ReturnType<typeof createOverlayManager>;

export function createOverlayManager() {
  let settings: DisplaySettings = DEFAULT_SETTINGS;
  loadSettings().then((s) => {
    settings = s;
    container.style.display = s.overlayEnabled ? '' : 'none';
  });
  onSettingsChanged((s) => {
    settings = s;
    container.style.display = s.overlayEnabled ? '' : 'none';
  });

  const tracked = new Map<string, TrackedItem>();
  /** Element the user last right-clicked (anchors image/video frames). */
  let lastContextTarget: Element | null = null;
  /** Cloned range of the selection at last right-click / toolbar action. */
  let lastSelectionRange: Range | null = null;
  /** Anchor for the next `overlay/assetAdded` that arrives from background. */
  let pendingAnchor: { range?: Range; element?: Element } | null = null;

  const container = document.createElement('div');
  container.id = 'prompttrace-overlay-container';
  container.style.cssText =
    'position:absolute;top:0;left:0;width:0;height:0;pointer-events:none;z-index:2147483646;';
  document.documentElement.appendChild(container);

  const style = document.createElement('style');
  style.textContent = `
    .prompttrace-frame {
      position: absolute;
      pointer-events: none;
      border-radius: 10px;
      border: 2px solid var(--role-color, ${DEFAULT_ROLE_COLORS.pending});
      background: color-mix(in srgb, var(--role-color, ${DEFAULT_ROLE_COLORS.pending}) 10%, transparent);
      box-shadow:
        0 0 0 1px rgba(255, 255, 255, 0.85),
        0 0 0 3px rgba(15, 23, 42, 0.65),
        0 0 18px color-mix(in srgb, var(--role-color, ${DEFAULT_ROLE_COLORS.pending}) 45%, transparent);
      z-index: 2147483646;
      transition: border-color 0.15s ease;
    }
    @keyframes prompttrace-flash {
      0%, 100% { opacity: 1; }
      25%, 75% { opacity: 0.15; }
      50% { opacity: 1; }
    }
    .prompttrace-frame--flash { animation: prompttrace-flash 0.9s ease 2; }
  `;
  document.documentElement.appendChild(style);

  document.addEventListener(
    'contextmenu',
    (e) => {
      lastContextTarget = e.target instanceof Element ? e.target : null;
      const sel = window.getSelection();
      lastSelectionRange =
        sel && sel.rangeCount > 0 && !sel.isCollapsed ? sel.getRangeAt(0).cloneRange() : null;
    },
    true,
  );

  function rectFor(item: TrackedItem): DOMRect | null {
    try {
      if (item.element) return item.element.getBoundingClientRect();
      if (item.range) return item.range.getBoundingClientRect();
    } catch {
      /* range invalidated by DOM changes */
    }
    return null;
  }

  function positionFrame(item: TrackedItem): void {
    const rect = rectFor(item);
    if (!rect || (rect.width === 0 && rect.height === 0)) {
      item.frame.style.display = 'none';
      return;
    }
    item.frame.style.display = '';
    item.frame.style.left = `${rect.left + window.scrollX - 4}px`;
    item.frame.style.top = `${rect.top + window.scrollY - 4}px`;
    item.frame.style.width = `${rect.width + 8}px`;
    item.frame.style.height = `${rect.height + 8}px`;
  }

  function repositionAll(): void {
    for (const item of tracked.values()) positionFrame(item);
  }
  window.addEventListener('scroll', repositionAll, { passive: true });
  window.addEventListener('resize', repositionAll, { passive: true });

  function colorFor(role: AssetRole | null): string {
    return role ? settings.roleColors[role] : settings.roleColors.pending;
  }

  function addFrame(asset: PendingAsset, anchor: { range?: Range; element?: Element }): void {
    if (!settings.overlayEnabled) return;
    const frame = document.createElement('div');
    frame.className = 'prompttrace-frame';
    frame.style.setProperty('--role-color', colorFor(asset.role));
    container.appendChild(frame);
    const item: TrackedItem = { id: asset.id, assetType: asset.assetType, frame, ...anchor };
    tracked.set(asset.id, item);
    positionFrame(item);
  }

  function removeFrame(id: string): void {
    const item = tracked.get(id);
    if (item) {
      item.frame.remove();
      tracked.delete(id);
    }
  }

  function findMediaElement(srcUrl: string, assetType: 'image' | 'video'): Element | null {
    if (lastContextTarget) {
      const tag = assetType === 'image' ? 'IMG' : 'VIDEO';
      if (lastContextTarget.tagName === tag) return lastContextTarget;
      const inner = lastContextTarget.querySelector(tag.toLowerCase());
      if (inner) return inner;
    }
    const selector = assetType === 'image' ? 'img' : 'video';
    for (const el of document.querySelectorAll<HTMLImageElement | HTMLVideoElement>(selector)) {
      if (el.currentSrc === srcUrl || el.src === srcUrl) return el;
    }
    return null;
  }

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

  function flash(id: string): void {
    const item = tracked.get(id);
    if (item) {
      item.frame.classList.remove('prompttrace-frame--flash');
      void item.frame.offsetWidth; // restart animation
      item.frame.classList.add('prompttrace-frame--flash');
    }
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
    pendingAnchor = { element: el };
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
    getSettings: () => settings,
    captureMediaElement,
    addFrame,
    removeFrame,
    flash,
    clearAll: () => {
      for (const id of [...tracked.keys()]) removeFrame(id);
    },
    setRoleColor: (id: string, role: AssetRole | null) => {
      const item = tracked.get(id);
      if (item) item.frame.style.setProperty('--role-color', colorFor(role));
    },
    captureSelection,
    markMedia: (srcUrl: string, assetType: 'image' | 'video') => {
      const el = findMediaElement(srcUrl, assetType);
      pendingAnchor = el ? { element: el } : null;
    },
    consumePendingAnchor: () => {
      const a = pendingAnchor;
      pendingAnchor = null;
      return a;
    },
    anchorOf: (id: string) => {
      const item = tracked.get(id);
      return item ? { range: item.range, element: item.element } : null;
    },
  };
}
