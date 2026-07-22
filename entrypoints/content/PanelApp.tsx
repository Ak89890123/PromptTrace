import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent as ReactDragEvent, type KeyboardEvent as ReactKeyboardEvent, type SyntheticEvent as ReactSyntheticEvent } from 'react';
import type { CaptureSessionState } from '@/src/core/capture/session';
import { canCommit, emptySession } from '@/src/core/capture/session';
import type { PendingAsset, RecordCategory } from '@/src/core/domain/entities';
import { ROLE_LABELS, type AssetRole } from '@/src/core/domain/enums';
import { allowedRolesFor, ROLE_NOT_ALLOWED_MESSAGE } from '@/src/core/domain/validation';
import { matchHotkey } from '@/src/core/hotkeys';
import {
  DEFAULT_SETTINGS,
  loadSettings,
  onSettingsChanged,
  type DisplaySettings,
} from '@/src/ui/roleColors';
import { assetTypeLabel, categoryLabel, resolveLanguage, roleLabel, UI_TEXT, type ResolvedLanguage, type UiText } from '@/src/ui/i18n';
import type { OverlayManager } from './overlay';
import { LOGO_DATA_URL } from './logo';
import type { GalleryAsset, GalleryRecord, ListRecordsResult, MediaPreviewChangedMessage } from '@/src/core/messages';
import { PrompTraceWordmark } from '@/src/ui/PrompTraceWordmark';

const send = (message: unknown) => chrome.runtime.sendMessage(message).catch(() => undefined);
const openExtensionPage = (page: 'library' | 'settings', hash?: string) =>
  send({ type: 'navigation/openExtensionPage', payload: { page, hash } });
const ALL_GALLERY_CATEGORIES = '__all__';
const UNCATEGORIZED_GALLERY_CATEGORY = '__uncategorized__';
const HOVER_PREVIEW_OPEN_DELAY_MS = 260;
const HOVER_PREVIEW_CLOSE_DELAY_MS = 180;
const SAVED_TOAST_DISMISS_MS = 6000;

type GalleryMoveToast = {
  recordId: string;
  previousCategoryId: string | null;
  previousCategoryName?: string;
  message: string;
};

type QuickAddContent =
  | { kind: 'text'; text: string }
  | { kind: 'image'; dataUrl: string; name?: string };

type QuickAddRequest = {
  target: { kind: 'record'; record: GalleryRecord } | { kind: 'capture' };
  mode: 'compose' | 'pasted';
  content: QuickAddContent;
  anchorTopPx: number;
};

type CaptureMenuRequest = {
  x: number;
  y: number;
  anchorTopPx: number;
};

type GalleryMenuRequest = {
  x: number;
  y: number;
  record: GalleryRecord;
  anchorTopPx: number;
};

type HoverPreviewContent =
  | { kind: 'text'; label: string; text: string }
  | { kind: 'image'; label: string; src: string };

type HoverPreviewRequest = {
  content: HoverPreviewContent;
  anchorTopPx: number;
};

export default function PanelApp({ overlay }: { overlay: OverlayManager }) {
  const [settings, setSettings] = useState<DisplaySettings>(DEFAULT_SETTINGS);
  const [session, setSession] = useState<CaptureSessionState>(emptySession());
  const [previewRefreshSignal, setPreviewRefreshSignal] = useState(0);

  useEffect(() => {
    loadSettings().then(setSettings);
    onSettingsChanged(setSettings);
    send({ type: 'capture/getSession', payload: {} })?.then(
      (r) => (r as { state?: CaptureSessionState })?.state && setSession((r as { state: CaptureSessionState }).state),
    );
    const listener = (message: { type?: string; payload?: { state?: CaptureSessionState } }) => {
      if (message?.type === 'capture/sessionUpdated' && message.payload?.state) {
        setSession(message.payload.state);
      }
      if ((message as MediaPreviewChangedMessage)?.type === 'media/previewChanged') {
        setPreviewRefreshSignal((value) => value + 1);
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);
  const language = resolveLanguage(settings.language);
  const t = UI_TEXT[language];

  return (
    <>
      {settings.selectionToolbarEnabled && <SelectionToolbar overlay={overlay} settings={settings} language={language} />}
      {settings.edgePanelEnabled && <CapturePanel session={session} settings={settings} t={t} language={language} />}
      {settings.edgePanelEnabled && <GalleryPanel settings={settings} t={t} language={language} previewRefreshSignal={previewRefreshSignal} />}
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Selection toolbar: role buttons floating at the text selection     */
/* ------------------------------------------------------------------ */

type ToolbarTarget =
  | { kind: 'text'; range: Range }
  | { kind: 'media'; el: HTMLImageElement | HTMLVideoElement; assetType: 'image' | 'video' };

type ToolbarPlacement = 'above' | 'below';
type ToolbarPosition = { x: number; top: number; bottom: number; placement: ToolbarPlacement };
type ViewportPoint = { x: number; y: number };

function isMediaElement(el: Element | null): el is HTMLImageElement | HTMLVideoElement {
  return !!el && (el.tagName === 'IMG' || el.tagName === 'VIDEO');
}

function rectContainsPoint(rect: DOMRect, point: ViewportPoint): boolean {
  return rect.width > 0 && rect.height > 0 && point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom;
}

function mediaFromElementAtPoint(el: Element, point: ViewportPoint): HTMLImageElement | HTMLVideoElement | null {
  if (isMediaElement(el) && rectContainsPoint(el.getBoundingClientRect(), point)) return el;

  for (const media of el.querySelectorAll('img,video')) {
    if (isMediaElement(media) && rectContainsPoint(media.getBoundingClientRect(), point)) return media;
  }
  return null;
}

function mediaFromViewportPoint(point: ViewportPoint): HTMLImageElement | HTMLVideoElement | null {
  for (const el of document.elementsFromPoint(point.x, point.y)) {
    const media = mediaFromElementAtPoint(el, point);
    if (media) return media;
  }
  return null;
}

function blockToolbarPageEvent(e: ReactSyntheticEvent<HTMLElement>) {
  e.preventDefault();
  e.stopPropagation();
  e.nativeEvent.stopImmediatePropagation?.();
}

function SelectionToolbar({ overlay, settings, language }: { overlay: OverlayManager; settings: DisplaySettings; language: ResolvedLanguage }) {
  const [pos, setPos] = useState<ToolbarPosition | null>(null);
  const [toolbarTop, setToolbarTop] = useState<number | null>(null);
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const targetRef = useRef<ToolbarTarget | null>(null);
  const [targetType, setTargetType] = useState<'text' | 'image' | 'video'>('text');
  /** The <img>/<video> currently under the cursor (for keyboard media capture). */
  const hoveredMedia = useRef<HTMLImageElement | HTMLVideoElement | null>(null);
  /** Last pointer position. Lets us find the media under an overlay (e.g. the
   *  ChatGPT image action bar) that intercepts hover but sits above the <img>. */
  const lastPointer = useRef<{ x: number; y: number } | null>(null);
  /** Media under the last right-click. The native context menu swallows the
   *  summon key while open, so we remember the target and pick it up once the
   *  menu closes — even if the pointer has since moved. */
  const lastContextMedia = useRef<HTMLImageElement | HTMLVideoElement | null>(null);

  const hide = useCallback(() => {
    setPos(null);
    setToolbarTop(null);
    targetRef.current = null;
  }, []);

  const showAt = useCallback((rect: DOMRect, placement: ToolbarPlacement = 'above') => {
    setToolbarTop(null);
    setPos({
      x: Math.min(Math.max(rect.left + rect.width / 2, 150), window.innerWidth - 150),
      top: rect.top,
      bottom: rect.bottom,
      placement,
    });
  }, []);

  /** Media under the cursor, piercing overlay layers. Threads/Instagram often
   *  places an absolutely-positioned span above <picture><img>, so inspect
   *  elements at the pointer and their media descendants, not only the event target. */
  const findMedia = useCallback((): HTMLImageElement | HTMLVideoElement | null => {
    const p = lastPointer.current;
    if (p) {
      const media = mediaFromViewportPoint(p);
      if (media) return media;
    }
    const hov = hoveredMedia.current;
    if (hov && hov.isConnected) return hov;
    const ctx = lastContextMedia.current;
    return ctx && ctx.isConnected ? ctx : null;
  }, []);

  /** Summon flow: text selection first; otherwise the media under the cursor. */
  const summon = useCallback((): void => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && !sel.isCollapsed && sel.toString().trim()) {
      const range = sel.getRangeAt(0).cloneRange();
      const forward = isSelectionForward(sel);
      const rect = selectionEndpointRect(range, forward);
      if (rect.width || rect.height) {
        targetRef.current = { kind: 'text', range };
        setTargetType('text');
        showAt(rect, forward ? 'below' : 'above');
        return;
      }
    }
    const media = findMedia();
    if (media) {
      const assetType = media.tagName === 'IMG' ? ('image' as const) : ('video' as const);
      targetRef.current = { kind: 'media', el: media, assetType };
      setTargetType(assetType);
      showAt(media.getBoundingClientRect());
      return;
    }
    hide();
  }, [showAt, hide, findMedia]);

  const capture = useCallback(
    (role: AssetRole) => {
      const target = targetRef.current;
      if (!target) return;
      if (target.kind === 'text') {
        overlay.captureSelection(role, target.range);
        window.getSelection()?.removeAllRanges();
      } else {
        overlay.captureMediaElement(target.el, role);
      }
      hide();
    },
    [overlay, hide],
  );

  useEffect(() => {
    const onSummon = () => summon();
    const rememberPointerMedia = (point: ViewportPoint) => {
      lastPointer.current = point;
      const media = mediaFromViewportPoint(point);
      if (media) hoveredMedia.current = media;
    };
    const onMouseOver = (e: MouseEvent) => {
      rememberPointerMedia({ x: e.clientX, y: e.clientY });
    };
    const onMouseMove = (e: MouseEvent) => {
      rememberPointerMedia({ x: e.clientX, y: e.clientY });
    };
    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      const toolbar = toolbarRef.current;
      if (toolbar && e.composedPath().includes(toolbar)) return;
      window.getSelection()?.removeAllRanges();
      hide();
    };
    const onContextMenu = (e: MouseEvent) => {
      const point = { x: e.clientX, y: e.clientY };
      lastPointer.current = point;
      lastContextMedia.current = mediaFromViewportPoint(point);
    };
    const onMouseUp = (e: MouseEvent) => {
      if ((e.target as Element | null)?.tagName?.toLowerCase().includes('prompttrace')) return;
      if (settings.toolbarTrigger !== 'auto') return;
      setTimeout(() => summon(), 10); // wait a tick so the selection is final
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return hide();
      // In-page fallback summon key (the chrome.commands shortcut is primary
      // and arrives via the 'prompttrace:summon' event instead).
      if (!matchHotkey(e, settings.summonHotkey)) return;
      // The summon key may be a printable character (the Shift+Z default is),
      // so only hijack it when there is actually something to capture — a text
      // selection or media under the cursor. Otherwise let it type normally.
      const sel = window.getSelection();
      const hasSelection = !!(sel && !sel.isCollapsed && sel.toString().trim());
      if (!hasSelection && !findMedia()) return;
      e.preventDefault();
      e.stopPropagation();
      summon();
    };
    const onScroll = () => hide();
    window.addEventListener('prompttrace:summon', onSummon);
    document.addEventListener('mouseover', onMouseOver, true);
    document.addEventListener('mousemove', onMouseMove, { passive: true, capture: true });
    document.addEventListener('mousedown', onMouseDown, true);
    document.addEventListener('contextmenu', onContextMenu, true);
    document.addEventListener('mouseup', onMouseUp);
    window.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    // Capture phase so scrolling a nested overflow container (e.g. the ChatGPT
    // conversation pane) also dismisses the toolbar — those scrolls don't bubble.
    window.addEventListener('scroll', onScroll, { passive: true, capture: true });
    return () => {
      window.removeEventListener('prompttrace:summon', onSummon);
      document.removeEventListener('mouseover', onMouseOver, true);
      document.removeEventListener('mousemove', onMouseMove, true);
      document.removeEventListener('mousedown', onMouseDown, true);
      document.removeEventListener('contextmenu', onContextMenu, true);
      document.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [settings, summon, hide, findMedia]);

  // Switching trigger mode (e.g. from the popup) cancels any pending selection
  // toolbar, so a stale role picker from the previous mode doesn't linger.
  const prevTrigger = useRef(settings.toolbarTrigger);
  useEffect(() => {
    if (prevTrigger.current !== settings.toolbarTrigger) {
      prevTrigger.current = settings.toolbarTrigger;
      hide();
    }
  }, [settings.toolbarTrigger, hide]);

  // Only roles valid for this target type ever appear (e.g. media → no Negative).
  const roles = settings.toolbarRoles.filter((r) => allowedRolesFor(targetType).includes(r));

  useLayoutEffect(() => {
    if (!pos) return;
    let animationFrame = 0;
    let timeout = 0;
    const adjust = () => {
      const toolbar = toolbarRef.current;
      if (!toolbar) return;

      const width = toolbar.offsetWidth;
      const height = toolbar.offsetHeight;
      const left = pos.x - width / 2;
      const right = pos.x + width / 2;
      const minTop = 8;
      const maxTop = Math.max(minTop, window.innerHeight - height - 8);
      const desiredTop = Math.min(maxTop, Math.max(minTop, pos.top - height - 8));
      const belowTop = Math.min(maxTop, Math.max(minTop, pos.bottom + 8));
      const candidates = pos.placement === 'below' ? [belowTop, desiredTop, maxTop, minTop] : [desiredTop, belowTop, minTop, maxTop];
      const blockers = collectVisiblePopoverRects();
      const candidateTop =
        candidates.find((candidate) => !blockers.some((blocker) => rectsOverlap({ left, right, top: candidate, bottom: candidate + height }, blocker))) ??
        desiredTop;

      setToolbarTop((current) => (current === candidateTop ? current : candidateTop));
    };
    adjust();
    animationFrame = window.requestAnimationFrame(adjust);
    timeout = window.setTimeout(adjust, 80);
    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.clearTimeout(timeout);
    };
  }, [pos, roles.length]);

  if (!pos) return null;
  const top = toolbarTop ?? (pos.placement === 'below' ? Math.min(window.innerHeight - 8, pos.bottom + 8) : Math.max(pos.top - 46, 8));

  return (
    <div
      ref={toolbarRef}
      className="pt-glass pt-toolbar"
      style={{ left: pos.x, top, transform: 'translateX(-50%)' }}
      onPointerDownCapture={blockToolbarPageEvent}
      onMouseDownCapture={blockToolbarPageEvent}
      onMouseUpCapture={blockToolbarPageEvent}
      onTouchStartCapture={blockToolbarPageEvent}
      onClick={blockToolbarPageEvent}
    >
      {roles.map((role) => (
        <button
          key={role}
          type="button"
          style={{ ['--role-color' as string]: settings.roleColors[role] }}
          onClick={(e) => {
            blockToolbarPageEvent(e);
            capture(role);
          }}
        >
          {roleLabel(role, language)}
        </button>
      ))}
    </div>
  );
}

function collectVisiblePopoverRects(): DOMRect[] {
  const rects: DOMRect[] = [];
  for (const el of document.querySelectorAll('[popover]')) {
    if (!(el instanceof HTMLElement)) continue;
    if (!isOpenPopover(el)) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;
    if (rect.bottom < 0 || rect.top > window.innerHeight || rect.right < 0 || rect.left > window.innerWidth) continue;
    rects.push(rect);
  }
  return rects;
}

function isOpenPopover(el: HTMLElement): boolean {
  try {
    if (el.matches(':popover-open')) return true;
  } catch {
    // Older engines may not parse :popover-open; fall back to visibility checks.
  }
  const style = getComputedStyle(el);
  return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
}

function rectsOverlap(a: { left: number; right: number; top: number; bottom: number }, b: DOMRect): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

function useFixedMenuPosition(menu: { x: number; y: number } | null, revision = 0) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    if (!menu) {
      setPosition(null);
      return;
    }
    const rect = menuRef.current?.getBoundingClientRect();
    if (!rect) return;
    const margin = 8;
    setPosition({
      left: Math.min(Math.max(margin, menu.x), Math.max(margin, window.innerWidth - rect.width - margin)),
      top: Math.min(Math.max(margin, menu.y), Math.max(margin, window.innerHeight - rect.height - margin)),
    });
  }, [menu, revision]);

  return {
    ref: menuRef,
    style: position ?? (menu ? { left: menu.x, top: menu.y } : undefined),
  };
}

function isSelectionForward(selection: Selection): boolean {
  const { anchorNode, focusNode } = selection;
  if (!anchorNode || !focusNode) return true;
  if (anchorNode === focusNode) return selection.anchorOffset <= selection.focusOffset;

  const position = anchorNode.compareDocumentPosition(focusNode);
  if (position & Node.DOCUMENT_POSITION_FOLLOWING) return true;
  if (position & Node.DOCUMENT_POSITION_PRECEDING) return false;
  return true;
}

function selectionEndpointRect(range: Range, forward: boolean): DOMRect {
  const rects = Array.from(range.getClientRects()).filter((rect) => rect.width > 0 || rect.height > 0);
  if (rects.length === 0) return range.getBoundingClientRect();
  return forward ? rects[rects.length - 1] : rects[0];
}

/* ------------------------------------------------------------------ */
/*  Capture panel: top-right corner, shown only while capturing        */
/* ------------------------------------------------------------------ */

function CapturePanel({
  session,
  settings,
  t,
  language,
}: {
  session: CaptureSessionState;
  settings: DisplaySettings;
  t: UiText;
  language: ResolvedLanguage;
}) {
  const [open, setOpen] = useState(false);
  const prevCount = useRef(0);
  const [wizard, setWizard] = useState<null | 'category'>(null);
  const [quickTextEditor, setQuickTextEditor] = useState<QuickAddRequest | null>(null);
  const [menu, setMenu] = useState<CaptureMenuRequest | null>(null);
  const menuPosition = useFixedMenuPosition(menu);
  const [savedToastRecordId, setSavedToastRecordId] = useState<string | null>(null);

  const count = session.assets.length;
  const active = count > 0 || session.conflicts.length > 0 || session.errors.length > 0;
  const justSaved = !active && !!savedToastRecordId;

  // Auto-peek when a new asset / conflict / error lands in the session.
  useEffect(() => {
    if (session.assets.length > prevCount.current || session.conflicts.length > 0 || session.errors.length > 0) {
      setOpen(true);
    }
    prevCount.current = session.assets.length;
  }, [session.assets.length, session.conflicts.length, session.errors.length]);

  // Saved confirmation is local toast UI.
  useEffect(() => {
    if (!savedToastRecordId) return;
    setOpen(true);
    const timer = window.setTimeout(() => {
      setSavedToastRecordId(null);
      setOpen(false);
    }, SAVED_TOAST_DISMISS_MS);
    return () => window.clearTimeout(timer);
  }, [savedToastRecordId]);

  // Nothing to show when idle — browsing saved prompts lives in GalleryPanel.
  if (!open || (!active && !justSaved)) return null;

  const leave = () => {
    // Never vanish mid-capture; once idle, collapse on leave.
    if (active || wizard || quickTextEditor) return;
    setOpen(false);
  };

  return (
    <div className="pt-capture-edge" onMouseEnter={() => setOpen(true)} onMouseLeave={leave}>
      <div className={`pt-glass pt-panel${wizard ? ' pt-panel--wizard' : ''}`}>
        <div className="pt-panel-head">
          <span className="pt-title">
            <img className="pt-logo-img" src={LOGO_DATA_URL} alt="" />
            <PrompTraceWordmark className="pt-panel-wordmark" />
          </span>
          <span className="pt-links">
            <button type="button" className="pt-panel-link" onClick={() => openExtensionPage('library')}>{t.goLibrary}</button>
            <button type="button" className="pt-panel-link" onClick={() => openExtensionPage('settings')}>{t.settings}</button>
          </span>
        </div>
        <div className="pt-panel-body">
          <CaptureBody
            session={session}
            settings={settings}
            wizard={wizard}
            setWizard={setWizard}
            t={t}
            language={language}
            savedRecordId={savedToastRecordId}
            onCommitted={setSavedToastRecordId}
            onQuickAdd={setQuickTextEditor}
            onOpenMenu={setMenu}
          />
        </div>
        {count > 0 && !wizard && (
          <div className="pt-footer">
            <button
              className="pt-commit"
              disabled={!canCommit(session)}
              title={canCommit(session) ? '' : t.quickSaveHint}
              onClick={() => setWizard('category')}
            >
              ✓ {t.add}（{count}）
            </button>
            <button className="pt-cancel" onClick={() => send({ type: 'capture/clearSession', payload: {} })}>
              ✕ {t.close}
            </button>
          </div>
        )}
      </div>
      {menu && <div className="pt-menu-backdrop" onClick={() => setMenu(null)} role="presentation" />}
      {menu && (
        <div
          ref={menuPosition.ref}
          className="pt-gmenu"
          style={menuPosition.style}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="pt-gmenu-item"
            onClick={() => {
              setMenu(null);
              setQuickTextEditor({
                target: { kind: 'capture' },
                content: { kind: 'text', text: '' },
                mode: 'compose',
                anchorTopPx: menu.anchorTopPx,
              });
            }}
          >
            {language === 'en-US' ? 'Add text' : '新增文字'}
          </button>
        </div>
      )}
      {quickTextEditor && (
        <QuickTextEditor
          request={quickTextEditor}
          settings={settings}
          language={language}
          onClose={() => setQuickTextEditor(null)}
          onSaved={() => setQuickTextEditor(null)}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Gallery panel: right-middle, hover-open with optional pin           */
/* ------------------------------------------------------------------ */

function GalleryPanel({
  settings,
  t,
  language,
  previewRefreshSignal,
}: {
  settings: DisplaySettings;
  t: UiText;
  language: ResolvedLanguage;
  previewRefreshSignal: number;
}) {
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [editing, setEditing] = useState<GalleryRecord | null>(null);
  const [quickTextEditor, setQuickTextEditor] = useState<QuickAddRequest | null>(null);
  const [hoverPreview, setHoverPreview] = useState<HoverPreviewRequest | null>(null);
  const [menu, setMenu] = useState<GalleryMenuRequest | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);
  const menuPosition = useFixedMenuPosition(menu, confirmDel ? 1 : 0);
  const panelCloseTimerRef = useRef<number | null>(null);
  const hoverPreviewOpenTimerRef = useRef<number | null>(null);
  const hoverPreviewCloseTimerRef = useRef<number | null>(null);
  const panelDockRef = useRef<HTMLDivElement | null>(null);
  const panelPlacementLockedRef = useRef(false);
  const [panelTopPx, setPanelTopPx] = useState<number | null>(null);
  const [refreshSignal, setRefreshSignal] = useState(0);
  useEffect(() => {
    if (previewRefreshSignal > 0) setRefreshSignal((value) => value + 1);
  }, [previewRefreshSignal]);
  const panelWidth = settings.cardLayout === 'split' ? 'min(440px, 94vw)' : 'min(267px, 94vw)';
  const edgeStyle = { '--pt-gallery-panel-width': panelWidth } as CSSProperties;
  // The tab sits where the user put it; the panel keeps its natural content height
  // and shifts just enough to stay on-screen while still covering the tab (so hover-open
  // holds). Tab high → panel pinned near the top (extends down); tab low → pinned
  // near the bottom (extends up). It never shrinks to a sliver.
  const PANEL_VH = 86;
  const edgeTop = Math.min(94, Math.max(6, settings.edgeTabTop ?? 50));
  const fallbackPanelTopVh = Math.min(100 - PANEL_VH - 2, Math.max(2, edgeTop - PANEL_VH / 2));
  const resolvedPanelTopPx = panelTopPx ?? (window.innerHeight * fallbackPanelTopVh) / 100;
  const panelTopVh = (resolvedPanelTopPx / Math.max(1, window.innerHeight)) * 100;
  const closeMenu = useCallback(() => {
    setMenu(null);
    setConfirmDel(false);
  }, []);
  const openMenu = useCallback((request: GalleryMenuRequest) => {
    setConfirmDel(false);
    setMenu(request);
  }, []);
  const openGallery = () => {
    if (panelCloseTimerRef.current !== null) {
      window.clearTimeout(panelCloseTimerRef.current);
      panelCloseTimerRef.current = null;
    }
    setOpen(true);
  };
  const closeGalleryNow = useCallback(() => {
    if (panelCloseTimerRef.current !== null) {
      window.clearTimeout(panelCloseTimerRef.current);
      panelCloseTimerRef.current = null;
    }
    if (editing || quickTextEditor || pinned || menu) return;
    setOpen(false);
    panelPlacementLockedRef.current = false;
    setPanelTopPx(null);
  }, [editing, menu, pinned, quickTextEditor]);
  const cancelHoverPreviewOpen = useCallback(() => {
    if (hoverPreviewOpenTimerRef.current !== null) {
      window.clearTimeout(hoverPreviewOpenTimerRef.current);
      hoverPreviewOpenTimerRef.current = null;
    }
  }, []);
  const scheduleGalleryClose = useCallback(() => {
    cancelHoverPreviewOpen();
    if (panelCloseTimerRef.current !== null) {
      window.clearTimeout(panelCloseTimerRef.current);
    }
    panelCloseTimerRef.current = window.setTimeout(() => {
      panelCloseTimerRef.current = null;
      closeGalleryNow();
    }, HOVER_PREVIEW_CLOSE_DELAY_MS);
  }, [cancelHoverPreviewOpen, closeGalleryNow]);
  const dismissGallery = useCallback(() => {
    if (panelCloseTimerRef.current !== null) {
      window.clearTimeout(panelCloseTimerRef.current);
      panelCloseTimerRef.current = null;
    }
    cancelHoverPreviewOpen();
    setPinned(false);
    setEditing(null);
    setQuickTextEditor(null);
    setHoverPreview(null);
    closeMenu();
    setOpen(false);
    panelPlacementLockedRef.current = false;
    setPanelTopPx(null);
  }, [cancelHoverPreviewOpen, closeMenu]);
  const openQuickAdd = useCallback((request: QuickAddRequest) => {
    cancelHoverPreviewOpen();
    setHoverPreview(null);
    closeMenu();
    setQuickTextEditor(request);
  }, [cancelHoverPreviewOpen, closeMenu]);
  const keepHoverPreviewOpen = useCallback(() => {
    cancelHoverPreviewOpen();
    if (hoverPreviewCloseTimerRef.current !== null) {
      window.clearTimeout(hoverPreviewCloseTimerRef.current);
      hoverPreviewCloseTimerRef.current = null;
    }
  }, [cancelHoverPreviewOpen]);
  const closeHoverPreviewNow = useCallback(() => {
    keepHoverPreviewOpen();
    setHoverPreview(null);
  }, [keepHoverPreviewOpen]);
  const scheduleHoverPreviewClose = useCallback(() => {
    keepHoverPreviewOpen();
    hoverPreviewCloseTimerRef.current = window.setTimeout(() => {
      setHoverPreview(null);
      hoverPreviewCloseTimerRef.current = null;
    }, HOVER_PREVIEW_CLOSE_DELAY_MS);
  }, [keepHoverPreviewOpen]);
  const showHoverPreview = useCallback((request: HoverPreviewRequest) => {
    keepHoverPreviewOpen();
    hoverPreviewOpenTimerRef.current = window.setTimeout(() => {
      setHoverPreview(request);
      hoverPreviewOpenTimerRef.current = null;
    }, HOVER_PREVIEW_OPEN_DELAY_MS);
  }, [keepHoverPreviewOpen]);
  useEffect(
    () => () => {
      if (panelCloseTimerRef.current !== null) {
        window.clearTimeout(panelCloseTimerRef.current);
      }
      if (hoverPreviewOpenTimerRef.current !== null) {
        window.clearTimeout(hoverPreviewOpenTimerRef.current);
      }
      if (hoverPreviewCloseTimerRef.current !== null) {
        window.clearTimeout(hoverPreviewCloseTimerRef.current);
      }
    },
    [],
  );
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      dismissGallery();
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [open, dismissGallery]);
  useLayoutEffect(() => {
    if (!open) {
      panelPlacementLockedRef.current = false;
      return;
    }
    const dock = panelDockRef.current;
    if (!dock) return;
    panelPlacementLockedRef.current = false;

    const alignPanelToTab = (force = false) => {
      if (panelPlacementLockedRef.current && !force) return;
      const viewportHeight = window.innerHeight;
      const panelHeight = dock.getBoundingClientRect().height;
      const desiredTop = (viewportHeight * edgeTop) / 100 - panelHeight / 2;
      const maxTop = Math.max(8, viewportHeight - panelHeight - 8);
      const nextTop = Math.min(maxTop, Math.max(8, desiredTop));
      setPanelTopPx((current) => (current !== null && Math.abs(current - nextTop) < 0.5 ? current : nextTop));

      const loading = dock.querySelector('[data-gallery-loading="true"]');
      const contentReady = !loading && Boolean(dock.querySelector('.pt-gallery, .pt-empty'));
      if (contentReady) panelPlacementLockedRef.current = true;
    };

    alignPanelToTab();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => alignPanelToTab());
    observer?.observe(dock);
    const onResize = () => alignPanelToTab(true);
    window.addEventListener('resize', onResize);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', onResize);
    };
  }, [edgeTop, open]);
  const removeMenuRecord = async () => {
    if (!menu) return;
    const recordId = menu.record.id;
    closeMenu();
    await send({ type: 'library/trashRecord', payload: { recordId } });
    setRefreshSignal((value) => value + 1);
  };
  return (
    <div className="pt-gallery-edge" style={edgeStyle}>
      {open ? (
        // The dock's padding-right keeps the visual gap to the screen edge part of
        // the hover zone, so sliding into it doesn't drop hover and flicker shut.
        <div
          ref={panelDockRef}
          className="pt-panel-dock"
          style={{ top: `${resolvedPanelTopPx}px` }}
          onMouseEnter={openGallery}
          onMouseLeave={scheduleGalleryClose}
        >
          <div className="pt-glass pt-panel pt-gallery-panel">
            <div className="pt-panel-head">
              <span className="pt-title">
                <img className="pt-logo-img" src={LOGO_DATA_URL} alt="" />
                <PrompTraceWordmark className="pt-panel-wordmark" />
              </span>
              <span className="pt-links">
                <button type="button" className="pt-panel-link" onClick={() => openExtensionPage('library')}>{t.goLibrary}</button>
                <button type="button" className="pt-panel-link" onClick={() => openExtensionPage('settings')}>{t.settings}</button>
              </span>
              <span className="pt-panel-actions">
                <button
                  className={`pt-icon-btn${pinned ? ' is-on' : ''}`}
                  aria-label={pinned ? t.unpinTitle : t.pinTitle}
                  aria-pressed={pinned}
                  title={pinned ? t.unpinTitle : t.pinTitle}
                  onClick={(e) => {
                    e.stopPropagation();
                    setPinned((v) => !v);
                    setOpen(true);
                  }}
                >
                  {pinned ? t.pinned : t.pin}
                </button>
                <button
                  className="pt-icon-btn"
                  aria-label={t.close}
                  title={t.close}
                  onClick={(e) => {
                    e.stopPropagation();
                    dismissGallery();
                  }}
                >
                  {t.close}
                </button>
              </span>
            </div>
            <div className="pt-panel-body">
              <Gallery
                settings={settings}
                t={t}
                language={language}
                onQuickAdd={openQuickAdd}
                onOpenMenu={openMenu}
                onHoverPreview={showHoverPreview}
                onClearHoverPreview={scheduleHoverPreviewClose}
                onDismissHoverPreview={closeHoverPreviewNow}
                refreshSignal={refreshSignal}
              />
            </div>
          </div>
        </div>
      ) : (
        <div
          className="pt-glass pt-edge-tab"
          style={{ top: `${edgeTop}vh`, transform: 'translateY(-50%)' }}
          onMouseEnter={openGallery}
          onClick={() => {
            setPinned(true);
            setOpen(true);
          }}
        >
          <img className="pt-tab-img" src={LOGO_DATA_URL} alt="PrompTrace" />
        </div>
      )}
      {menu && <div className="pt-menu-backdrop" onClick={closeMenu} role="presentation" />}
      {menu && (
        <div
          ref={menuPosition.ref}
          className="pt-gmenu"
          style={menuPosition.style}
          onClick={(e) => e.stopPropagation()}
        >
          {!confirmDel ? (
            <>
              <button
                className="pt-gmenu-item"
                onClick={() => {
                  const record = menu.record;
                  closeMenu();
                  setEditing(record);
                }}
              >
                {language === 'en-US' ? 'Edit tags' : '編輯標籤'}
              </button>
              <button
                className="pt-gmenu-item"
                onClick={() => {
                  const request = menu;
                  openQuickAdd({
                    target: { kind: 'record', record: request.record },
                    content: { kind: 'text', text: '' },
                    mode: 'compose',
                    anchorTopPx: request.anchorTopPx,
                  });
                }}
              >
                {language === 'en-US' ? 'Add text' : '新增文字'}
              </button>
              <button className="pt-gmenu-item pt-gmenu-item--danger" onClick={() => setConfirmDel(true)}>
                {t.delete}
              </button>
            </>
          ) : (
            <>
              <div className="pt-gmenu-confirm">{language === 'en-US' ? 'Move this record to Trash? You can restore it before auto-delete.' : '移到垃圾桶？自動刪除前可以還原。'}</div>
              <button className="pt-gmenu-item pt-gmenu-item--danger" onClick={removeMenuRecord}>
                {language === 'en-US' ? 'Move to Trash' : '移到垃圾桶'}
              </button>
              <button className="pt-gmenu-item" onClick={() => setConfirmDel(false)}>
                {language === 'en-US' ? 'Cancel' : '取消'}
              </button>
            </>
          )}
        </div>
      )}
      {editing && (
        <CardEditor
          record={editing}
          topVh={panelTopVh}
          t={t}
          language={language}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            setRefreshSignal((n) => n + 1);
          }}
        />
      )}
      {hoverPreview && !quickTextEditor && !editing && (
        <HoverPreview
          request={hoverPreview}
          onKeepOpen={() => {
            openGallery();
            keepHoverPreviewOpen();
          }}
          onRequestClose={() => {
            scheduleHoverPreviewClose();
            scheduleGalleryClose();
          }}
        />
      )}
      {quickTextEditor && (
        <QuickTextEditor
          request={quickTextEditor}
          settings={settings}
          language={language}
          onClose={() => setQuickTextEditor(null)}
          onSaved={() => {
            setQuickTextEditor(null);
            setRefreshSignal((n) => n + 1);
          }}
        />
      )}
    </div>
  );
}

function CaptureBody({
  session,
  settings,
  wizard,
  setWizard,
  t,
  language,
  savedRecordId,
  onCommitted,
  onQuickAdd,
  onOpenMenu,
}: {
  session: CaptureSessionState;
  settings: DisplaySettings;
  wizard: null | 'category';
  setWizard: (w: null | 'category') => void;
  t: UiText;
  language: ResolvedLanguage;
  savedRecordId: string | null;
  onCommitted: (recordId: string) => void;
  onQuickAdd: (request: QuickAddRequest) => void;
  onOpenMenu: (request: CaptureMenuRequest) => void;
}) {
  const grouped = useMemo(() => {
    const order: (AssetRole | null)[] = [null, 'input', 'input_reference', 'negative', 'output'];
    return order
      .map((role) => ({
        role,
        label: role ? roleLabel(role, language) : t.uncategorized,
        items: session.assets.filter((a) => a.role === role),
      }))
      .filter((g) => g.items.length > 0);
  }, [session.assets]);

  if (wizard) {
    return (
      <Wizard
        setStage={setWizard}
        outputTypes={session.assets.filter((a) => a.role === 'output').map((a) => a.assetType)}
        t={t}
        language={language}
        onCommitted={onCommitted}
      />
    );
  }

  return (
    <>
      {session.conflicts.map((c) => (
        <div className="pt-card pt-conflict" key={c.id}>
          <strong>⚠ {c.conflictType}</strong>
          <div className="pt-muted">{c.suggestion}</div>
          {c.existingPreview && <div className="pt-preview">{language === 'en-US' ? 'Old' : '原'}：{c.existingPreview}</div>}
          {c.newPreview && <div className="pt-preview">{language === 'en-US' ? 'New' : '新'}：{c.newPreview}</div>}
          <div className="pt-row">
            {c.conflictType === 'OVERLAPPING_SELECTION' && (
              <button
                className="pt-small-btn"
                onClick={() => send({ type: 'capture/resolveConflict', payload: { conflictId: c.id, resolution: 'replace' } })}
              >
                {language === 'en-US' ? 'Replace with new range' : '用新範圍取代'}
              </button>
            )}
            <button
              className="pt-small-btn"
              onClick={() => send({ type: 'capture/resolveConflict', payload: { conflictId: c.id, resolution: 'cancel' } })}
            >
              {c.conflictType === 'OVERLAPPING_SELECTION' ? (language === 'en-US' ? 'Cancel new selection' : '取消新選取') : (language === 'en-US' ? 'Got it' : '知道了')}
            </button>
          </div>
        </div>
      ))}

      {session.errors.map((e) => (
        <div className="pt-card pt-error" key={e.id}>
          <strong>⛔ {e.errorType}</strong>
          <div>{e.message}</div>
          <div className="pt-muted">{e.probableCause}</div>
          <div className="pt-muted">{language === 'en-US' ? 'Suggestion' : '建議'}：{e.suggestedAction}</div>
          <div className="pt-row" style={{ marginTop: 6 }}>
            {e.canRetry && e.assetId && (
              <button className="pt-small-btn" onClick={() => send({ type: 'capture/dismissError', payload: { errorId: e.id, action: 'retry' } })}>
                {language === 'en-US' ? 'Retry' : '重試'}
              </button>
            )}
            {e.canSaveSourceOnly && (
              <button className="pt-small-btn" onClick={() => send({ type: 'capture/dismissError', payload: { errorId: e.id, action: 'save_source_only' } })}>
                {language === 'en-US' ? 'Save source only' : '只保存來源'}
              </button>
            )}
            <button className="pt-small-btn" onClick={() => send({ type: 'capture/dismissError', payload: { errorId: e.id, action: 'cancel' } })}>
              {t.close}
            </button>
          </div>
        </div>
      ))}

      {session.assets.length === 0 &&
        session.conflicts.length === 0 &&
        session.errors.length === 0 &&
        savedRecordId && (
          <div className="pt-card">
            ✅ {t.saved}{' '}
            <a
              style={{ color: '#8ad7e8', cursor: 'pointer' }}
              onClick={() => openExtensionPage('library', `#record=${savedRecordId}`)}
            >
              {t.openInLibrary}
            </a>
          </div>
        )}

      {grouped.map(({ role, label, items }) => (
        <div key={label}>
          <div className="pt-h2">
            <span
              className="pt-pill"
              style={{ background: role ? settings.roleColors[role] : settings.roleColors.pending }}
            >
              {label}
            </span>{' '}
            {items.length}
          </div>
          {items.map((a) => (
            <PanelAssetCard
              key={a.id}
              asset={a}
              settings={settings}
              language={language}
              onQuickAdd={onQuickAdd}
              onOpenMenu={onOpenMenu}
            />
          ))}
        </div>
      ))}

    </>
  );
}

function PanelAssetCard({
  asset,
  settings,
  language,
  onQuickAdd,
  onOpenMenu,
}: {
  asset: PendingAsset;
  settings: DisplaySettings;
  language: ResolvedLanguage;
  onQuickAdd: (request: QuickAddRequest) => void;
  onOpenMenu: (request: CaptureMenuRequest) => void;
}) {
  const allowed = allowedRolesFor(asset.assetType);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const editorAnchorTopForCard = () => {
    const rect = cardRef.current?.getBoundingClientRect();
    return rect?.top ?? 8;
  };
  const openQuickAdd = (content: QuickAddContent, mode: QuickAddRequest['mode']) => {
    onQuickAdd({ target: { kind: 'capture' }, content, mode, anchorTopPx: editorAnchorTopForCard() });
  };

  return (
    <div
      ref={cardRef}
      className="pt-card"
      tabIndex={0}
      onMouseEnter={() => cardRef.current?.focus({ preventScroll: true })}
      onPaste={(e) => {
        if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) return;
        const imageFile = [...e.clipboardData.files].find((file) => file.type.startsWith('image/'));
        if (imageFile) {
          e.preventDefault();
          e.stopPropagation();
          fileToDataUrl(imageFile).then((dataUrl) => openQuickAdd({ kind: 'image', dataUrl, name: imageFile.name }, 'pasted'));
          return;
        }
        const text = e.clipboardData.getData('text/plain').trim();
        if (!text) return;
        e.preventDefault();
        e.stopPropagation();
        openQuickAdd({ kind: 'text', text }, 'pasted');
      }}
      onContextMenu={(e) => {
        if ((e.target as HTMLElement).closest('textarea')) return;
        e.preventDefault();
        const rect = cardRef.current?.getBoundingClientRect();
        onOpenMenu({ x: e.clientX, y: e.clientY, anchorTopPx: rect?.top ?? 8 });
      }}
    >
      <div className="pt-spread">
        <strong style={{ fontSize: 11.5, textTransform: 'uppercase', opacity: 0.7 }}>{assetTypeLabel(asset.assetType, language)}</strong>
        <button className="pt-small-btn" onClick={() => send({ type: 'capture/removeAsset', payload: { pendingAssetId: asset.id } })}>
          {language === 'en-US' ? 'Remove' : '移除'}
        </button>
      </div>
      {asset.assetType === 'text' ? (
        <div className="pt-preview">{asset.textContent}</div>
      ) : asset.assetType === 'image' ? (
        <img className="pt-thumb" src={asset.originalUrl} alt="" />
      ) : (
        <div className="pt-preview">🎞 {asset.originalUrl ?? (language === 'en-US' ? '(No downloadable URL, source only)' : '（無可下載 URL，僅保存來源）')}</div>
      )}
      <div className="pt-rolerow">
        {(Object.keys(ROLE_LABELS) as AssetRole[]).map((role) => {
          const ok = allowed.includes(role);
          return (
            <button
              key={role}
              disabled={!ok}
              title={ok ? '' : ROLE_NOT_ALLOWED_MESSAGE}
              className={asset.role === role ? 'pt-active' : ''}
              style={{ ['--role-color' as string]: settings.roleColors[role] }}
              onClick={() => send({ type: 'capture/assignAssetRole', payload: { pendingAssetId: asset.id, role } })}
            >
              {roleLabel(role, language)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function galleryAssetComposerRef(asset: GalleryAsset): string {
  if (asset.originalUrl) return asset.originalUrl;
  if (asset.previewRef && !asset.previewRef.startsWith('data:')) return asset.previewRef;
  return '';
}

function galleryAssetsPlainText(assets: GalleryAsset[]): string {
  return assets
    .map((asset) => {
      if (asset.assetType === 'text' && asset.textContent) return asset.textContent.trim();
      return '';
    })
    .filter(Boolean)
    .join('\n\n');
}

function galleryAssetsComposerText(assets: GalleryAsset[]): string {
  return assets
    .map((asset) => {
      if (asset.assetType === 'text' && asset.textContent) return asset.textContent.trim();
      if (asset.assetType === 'image') return '';
      const ref = galleryAssetComposerRef(asset);
      return ref ? `[${asset.assetType}] ${ref}` : '';
    })
    .filter(Boolean)
    .join('\n\n');
}

async function copyGalleryAssetsText(assets: GalleryAsset[]): Promise<'text'> {
  const text = galleryAssetsPlainText(assets);
  await navigator.clipboard.writeText(text);
  return 'text';
}

type ComposerTarget = HTMLInputElement | HTMLTextAreaElement | HTMLElement;
type PromptInsertResult = 'uploaded' | 'pasted' | 'filled' | 'none';

function isVisibleComposerCandidate(el: Element | null): el is ComposerTarget {
  if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLElement)) return false;
  if (el instanceof HTMLInputElement && el.type !== 'text' && el.type !== 'search') return false;
  if ((el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) && el.disabled) return false;
  if (el instanceof HTMLElement && el.isContentEditable === false && !(el instanceof HTMLInputElement) && !(el instanceof HTMLTextAreaElement)) return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 120 && rect.height > 16 && rect.bottom > 0 && rect.top < window.innerHeight;
}

function findPromptComposer(): ComposerTarget | null {
  const strongSelectors = [
    'textarea#prompt-textarea',
    '#prompt-textarea[contenteditable="true"]',
    '[data-testid="prompt-textarea"]',
    'rich-textarea textarea',
    'rich-textarea [contenteditable="true"]',
    '[aria-label*="Message"][contenteditable="true"]',
    '[aria-label*="訊息"][contenteditable="true"]',
    '[role="textbox"][contenteditable="true"]',
  ];
  for (const selector of strongSelectors) {
    const target = document.querySelector(selector);
    if (isVisibleComposerCandidate(target)) return target;
  }

  const host = location.hostname.toLowerCase();
  if (!/(^|\.)chatgpt\.com$/.test(host) && !/(^|\.)gemini\.google\.com$/.test(host)) return null;

  return [...document.querySelectorAll('textarea, input[type="text"], input[type="search"], [contenteditable="true"]')]
    .filter(isVisibleComposerCandidate)
    .sort((a, b) => b.getBoundingClientRect().bottom - a.getBoundingClientRect().bottom)[0] ?? null;
}

function appendWithSeparator(current: string, text: string): string {
  return current.trim() ? `${current.trimEnd()}\n\n${text}` : text;
}

function setTextInputValue(target: HTMLInputElement | HTMLTextAreaElement, text: string): void {
  const start = target.selectionStart ?? target.value.length;
  const end = target.selectionEnd ?? target.value.length;
  const next =
    start !== end || start < target.value.length
      ? `${target.value.slice(0, start)}${text}${target.value.slice(end)}`
      : appendWithSeparator(target.value, text);
  const proto = target instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(target, next);
  target.focus();
  const cursor = next.length;
  target.setSelectionRange(cursor, cursor);
  target.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: text }));
  target.dispatchEvent(new Event('change', { bubbles: true }));
}

function appendPlainTextToContentEditable(target: HTMLElement, text: string): void {
  const normalized = text.replace(/\r\n?/g, '\n');
  const lines = normalized.split('\n');
  lines.forEach((line, index) => {
    if (index > 0) target.append(document.createElement('br'));
    if (line) target.append(document.createTextNode(line));
  });
}

function setContentEditableText(target: HTMLElement, text: string): void {
  target.focus();
  const next = appendWithSeparator(target.innerText, text).replace(/\r\n?/g, '\n');
  target.replaceChildren();
  appendPlainTextToContentEditable(target, next);
  const range = document.createRange();
  range.selectNodeContents(target);
  range.collapse(false);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  target.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: text }));
}

async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('FILE_READER_NO_RESULT'));
    };
    reader.onerror = () => reject(reader.error ?? new Error('FILE_READER_FAILED'));
    reader.readAsDataURL(file);
  });
}

async function imageFileFromAsset(asset: GalleryAsset, index: number): Promise<File | null> {
  if (asset.assetType !== 'image') return null;
  const sources = [asset.originalUrl, asset.previewRef].filter((src): src is string => Boolean(src));
  for (const src of sources) {
    try {
      const resp = await fetch(src, { credentials: 'include' });
      if (!resp.ok) continue;
      const png = await blobToPng(await resp.blob());
      return new File([png], `prompttrace-image-${index + 1}.png`, { type: 'image/png' });
    } catch {
    }
  }
  return null;
}

async function imageFilesFromAssets(assets: GalleryAsset[]): Promise<File[]> {
  const files = await Promise.all(assets.map((asset, index) => imageFileFromAsset(asset, index)));
  return files.filter((file): file is File => file !== null);
}

function pasteEventTargetForComposer(target: ComposerTarget): ComposerTarget {
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return target;
  return (
    target.querySelector('p') ??
    target.querySelector('[contenteditable="true"]') ??
    target
  ) as ComposerTarget;
}

function insertTextIntoPromptTarget(target: ComposerTarget, text: string): void {
  if (!text) return;
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    setTextInputValue(target, text);
  } else {
    setContentEditableText(target, text);
  }
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function fileListFromFiles(files: File[]): FileList {
  const transfer = new DataTransfer();
  for (const file of files) transfer.items.add(file);
  return transfer.files;
}

function isUsableImageFileInput(input: HTMLInputElement): boolean {
  if (input.disabled) return false;
  const accept = input.accept.toLowerCase();
  return (
    accept === '' ||
    accept.includes('image') ||
    accept.includes('*/*') ||
    accept.includes('.png') ||
    accept.includes('.jpg') ||
    accept.includes('.jpeg') ||
    accept.includes('.webp')
  );
}

function findComposerFileInput(target: ComposerTarget): HTMLInputElement | null {
  const scopes: ParentNode[] = [];
  if (target instanceof HTMLElement) {
    const form = target.closest('form');
    if (form) scopes.push(form);
    const dialog = target.closest('[role="dialog"]');
    if (dialog && dialog !== form) scopes.push(dialog);
  }
  scopes.push(document);

  for (const scope of scopes) {
    const input = [...scope.querySelectorAll<HTMLInputElement>('input[type="file"]')].find(isUsableImageFileInput);
    if (input) return input;
  }
  return null;
}

function uploadFilesThroughComposerInput(target: ComposerTarget, files: File[]): boolean {
  if (files.length === 0) return false;
  const input = findComposerFileInput(target);
  if (!input) return false;
  input.files = fileListFromFiles(files);
  input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
  return true;
}

function pasteGalleryFilesIntoPrompt(target: ComposerTarget, files: File[]): boolean {
  if (files.length === 0) return false;
  const transfer = new DataTransfer();
  for (const file of files) transfer.items.add(file);
  const pasteTarget = pasteEventTargetForComposer(target);
  target.focus();
  const event = new ClipboardEvent('paste', {
    bubbles: true,
    cancelable: true,
    composed: true,
    clipboardData: transfer,
  });
  const notCanceled = pasteTarget.dispatchEvent(event);
  return !notCanceled || event.defaultPrevented;
}

async function blobToPng(blob: Blob): Promise<Blob> {
  if (blob.type === 'image/png') return blob;
  const url = URL.createObjectURL(blob);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('IMAGE_DECODE_FAILED'));
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth || image.width;
    canvas.height = image.naturalHeight || image.height;
    const ctx = canvas.getContext('2d');
    if (!ctx || canvas.width === 0 || canvas.height === 0) throw new Error('CANVAS_FAILED');
    ctx.drawImage(image, 0, 0);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((out) => (out ? resolve(out) : reject(new Error('PNG_ENCODE_FAILED'))), 'image/png');
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function insertGalleryAssetsIntoPrompt(assets: GalleryAsset[]): Promise<PromptInsertResult> {
  const text = galleryAssetsComposerText(assets);
  const target = findPromptComposer();
  if (!target) return 'none';
  if (assets.some((asset) => asset.assetType === 'image')) {
    const files = await imageFilesFromAssets(assets);
    if (uploadFilesThroughComposerInput(target, files)) {
      await nextFrame();
      insertTextIntoPromptTarget(target, text);
      return 'uploaded';
    }
    if (pasteGalleryFilesIntoPrompt(target, files)) {
      await nextFrame();
      insertTextIntoPromptTarget(target, text);
      return 'pasted';
    }
    return 'none';
  }
  if (!text) return 'none';
  insertTextIntoPromptTarget(target, text);
  return 'filled';
}

function Gallery({
  settings,
  t,
  language,
  onQuickAdd,
  onOpenMenu,
  onHoverPreview,
  onClearHoverPreview,
  onDismissHoverPreview,
  refreshSignal,
}: {
  settings: DisplaySettings;
  t: UiText;
  language: ResolvedLanguage;
  onQuickAdd: (request: QuickAddRequest) => void;
  onOpenMenu: (request: GalleryMenuRequest) => void;
  onHoverPreview: (request: HoverPreviewRequest) => void;
  onClearHoverPreview: () => void;
  onDismissHoverPreview: () => void;
  refreshSignal: number;
}) {
  const [records, setRecords] = useState<GalleryRecord[] | null>(null);
  const [categories, setCategories] = useState<RecordCategory[]>([]);
  const [activeCategory, setActiveCategory] = useState(ALL_GALLERY_CATEGORIES);
  const [draggingRecord, setDraggingRecord] = useState<{ id: string; categoryId: string | null } | null>(null);
  const [dragOverCategory, setDragOverCategory] = useState<string | null>(null);
  const [moveToast, setMoveToast] = useState<GalleryMoveToast | null>(null);
  const moveToastTimerRef = useRef<number | null>(null);

  const refresh = useCallback(() => {
    send({ type: 'library/listRecords', payload: {} }).then((r) => {
      setRecords((r as ListRecordsResult | undefined)?.records ?? []);
    });
  }, []);

  useEffect(() => {
    send({ type: 'taxonomy/get', payload: {} }).then((r) => {
      const data = r as { categories?: RecordCategory[] } | undefined;
      setCategories(data?.categories ?? []);
    });
  }, []);

  // Re-fetch on mount and whenever an edit elsewhere bumps the signal.
  useEffect(() => {
    refresh();
  }, [refresh, refreshSignal]);

  const clearMoveToast = useCallback(() => {
    if (moveToastTimerRef.current !== null) {
      window.clearTimeout(moveToastTimerRef.current);
      moveToastTimerRef.current = null;
    }
    setMoveToast(null);
  }, []);

  useEffect(
    () => () => {
      if (moveToastTimerRef.current !== null) {
        window.clearTimeout(moveToastTimerRef.current);
      }
    },
    [],
  );

  const categoryFilters = useMemo(() => {
    if (!records) return [];
    const counts = new Map<string | null, number>();
    for (const record of records) {
      const categoryId = record.categoryId ?? null;
      counts.set(categoryId, (counts.get(categoryId) ?? 0) + 1);
    }

    const filters = new Map<string, GalleryCategoryFilter>();

    for (const category of categories) {
      if (category.isActive === false) continue;
      filters.set(category.id, {
        key: category.id,
        categoryId: category.id,
        label: categoryLabel(category, language),
        count: counts.get(category.id) ?? 0,
      });
    }

    for (const record of records) {
      if (!record.categoryId || filters.has(record.categoryId)) continue;
      filters.set(record.categoryId, {
        key: record.categoryId,
        categoryId: record.categoryId,
        label: record.categoryName ?? record.categoryId,
        count: counts.get(record.categoryId) ?? 0,
      });
    }

    return Array.from(filters.values());
  }, [categories, language, records]);

  const showMoveToast = useCallback((toast: GalleryMoveToast) => {
    if (moveToastTimerRef.current !== null) {
      window.clearTimeout(moveToastTimerRef.current);
    }
    setMoveToast(toast);
    moveToastTimerRef.current = window.setTimeout(() => {
      setMoveToast(null);
      moveToastTimerRef.current = null;
    }, 3200);
  }, []);

  const moveRecordToCategory = useCallback(
    async (record: GalleryRecord, category: GalleryCategoryFilter) => {
      const previousCategoryId = record.categoryId ?? null;
      if (previousCategoryId === category.categoryId) return;

      const result = await send({
        type: 'library/updateRecordMeta',
        payload: { recordId: record.id, categoryId: category.categoryId },
      });
      if ((result as { ok?: boolean } | undefined)?.ok === false) return;

      setRecords((current) =>
        current?.map((item) =>
          item.id === record.id
            ? {
                ...item,
                categoryId: category.categoryId,
                categoryName: category.categoryId ? category.label : undefined,
              }
            : item,
        ) ?? current,
      );
      showMoveToast({
        recordId: record.id,
        previousCategoryId,
        previousCategoryName: record.categoryName,
        message: language === 'en-US' ? `Moved to ${category.label}` : `已移到 ${category.label}`,
      });
    },
    [language, showMoveToast],
  );

  const undoMove = useCallback(async () => {
    if (!moveToast) return;
    const result = await send({
      type: 'library/updateRecordMeta',
      payload: { recordId: moveToast.recordId, categoryId: moveToast.previousCategoryId },
    });
    if ((result as { ok?: boolean } | undefined)?.ok === false) return;

    setRecords((current) =>
      current?.map((item) =>
        item.id === moveToast.recordId
          ? {
              ...item,
              categoryId: moveToast.previousCategoryId,
              categoryName: moveToast.previousCategoryName,
            }
          : item,
      ) ?? current,
    );
    clearMoveToast();
  }, [clearMoveToast, moveToast]);

  const onCategoryDrop = (e: ReactDragEvent<HTMLButtonElement>, category: GalleryCategoryFilter) => {
    if (!draggingRecord || !records) return;
    e.preventDefault();
    const record = records.find((item) => item.id === draggingRecord.id);
    setDragOverCategory(null);
    setDraggingRecord(null);
    if (!record) return;
    void moveRecordToCategory(record, category);
  };

  const onCategoryDragLeave = (e: ReactDragEvent<HTMLButtonElement>, category: GalleryCategoryFilter) => {
    const next = e.relatedTarget;
    if (next instanceof Node && e.currentTarget.contains(next)) return;
    if (dragOverCategory === category.key) setDragOverCategory(null);
  };

  const allowCategoryDrop = (e: ReactDragEvent<HTMLButtonElement>, category: GalleryCategoryFilter) => {
    if (!draggingRecord || draggingRecord.categoryId === category.categoryId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverCategory(category.key);
  };

  const onRecordDragStart = (record: GalleryRecord, e: ReactDragEvent<HTMLButtonElement>) => {
    setDraggingRecord({ id: record.id, categoryId: record.categoryId ?? null });
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', record.id);
    const dragImage = createCategoryDragImage(record.categoryName ?? t.uncategorized);
    document.body.appendChild(dragImage);
    e.dataTransfer.setDragImage(dragImage, 16, 14);
    window.setTimeout(() => dragImage.remove(), 0);
  };

  const onRecordDragEnd = () => {
    setDraggingRecord(null);
    setDragOverCategory(null);
  };

  const filteredRecords =
    activeCategory === ALL_GALLERY_CATEGORIES
      ? records
      : records?.filter((record) => galleryCategoryKey(record) === activeCategory);

  useEffect(() => {
    if (activeCategory === ALL_GALLERY_CATEGORIES) return;
    if (!categoryFilters.some((category) => category.key === activeCategory)) {
      setActiveCategory(ALL_GALLERY_CATEGORIES);
    }
  }, [activeCategory, categoryFilters]);

  if (records === null) return <div className="pt-empty" data-gallery-loading="true">{t.loading}</div>;
  if (records.length === 0) {
    return (
      <div className="pt-empty">
        <img className="pt-logo" src={LOGO_DATA_URL} alt="" />
        {t.emptyPrompt}
        <br />
        {language === 'en-US' ? 'Select text' : '選取文字'} → <kbd>{settings.summonHotkey}</kbd> → {language === 'en-US' ? 'choose a save button.' : '選按鈕保存。'}
      </div>
    );
  }
  const allLabel = language === 'en-US' ? 'All' : language === 'zh-CN' ? '全部' : '全部';
  return (
    <>
      {categoryFilters.length > 0 && (
        <div
          className="pt-gallery-filter"
          aria-label={language === 'en-US' ? 'Filter saved records' : '篩選保存紀錄'}
          data-dragging={draggingRecord ? 'true' : 'false'}
        >
          <div className="pt-gallery-filter-scroll">
            <button
              className="pt-filter-chip"
              type="button"
              aria-pressed={activeCategory === ALL_GALLERY_CATEGORIES}
              data-active={activeCategory === ALL_GALLERY_CATEGORIES}
              onClick={() => setActiveCategory(ALL_GALLERY_CATEGORIES)}
            >
              <span>{allLabel}</span>
              <span className="pt-filter-count">{records.length}</span>
            </button>
            {categoryFilters.map((category) => (
              <button
                key={category.key}
                className="pt-filter-chip"
                type="button"
                aria-pressed={activeCategory === category.key}
                data-active={activeCategory === category.key}
                data-drop-target={draggingRecord ? 'true' : 'false'}
                data-drop-over={dragOverCategory === category.key}
                data-drop-disabled={draggingRecord?.categoryId === category.categoryId}
                onClick={() => setActiveCategory(category.key)}
                onDragEnter={(e) => allowCategoryDrop(e, category)}
                onDragOver={(e) => allowCategoryDrop(e, category)}
                onDragLeave={(e) => onCategoryDragLeave(e, category)}
                onDrop={(e) => onCategoryDrop(e, category)}
              >
                <span>{category.label}</span>
                <span className="pt-filter-count">{category.count}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="pt-gallery">
        {(filteredRecords ?? []).map((r) => (
          <GalleryCard
            key={r.id}
            record={r}
            settings={settings}
            t={t}
            language={language}
            onQuickAdd={onQuickAdd}
            onOpenMenu={onOpenMenu}
            onHoverPreview={onHoverPreview}
            onClearHoverPreview={onClearHoverPreview}
            onDismissHoverPreview={onDismissHoverPreview}
            onCategoryDragStart={onRecordDragStart}
            onCategoryDragEnd={onRecordDragEnd}
            isDragging={draggingRecord?.id === r.id}
          />
        ))}
      </div>
      {moveToast && (
        <div className="pt-gallery-toast" role="status">
          <span>{moveToast.message}</span>
          <button type="button" onClick={undoMove}>
            {language === 'en-US' ? 'Undo' : '復原'}
          </button>
        </div>
      )}
    </>
  );
}

type GalleryCategoryFilter = {
  key: string;
  categoryId: string | null;
  label: string;
  count: number;
};

function createCategoryDragImage(label: string): HTMLDivElement {
  const dragImage = document.createElement('div');
  dragImage.className = 'pt-category-drag-image';
  dragImage.textContent = `⋮⋮ ${label}`;
  dragImage.setAttribute('aria-hidden', 'true');
  return dragImage;
}

function galleryCategoryKey(record: GalleryRecord): string {
  return record.categoryId ?? UNCATEGORIZED_GALLERY_CATEGORY;
}

function GalleryCard({
  record,
  settings,
  t,
  language,
  onQuickAdd,
  onOpenMenu,
  onHoverPreview,
  onClearHoverPreview,
  onDismissHoverPreview,
  onCategoryDragStart,
  onCategoryDragEnd,
  isDragging,
}: {
  record: GalleryRecord;
  settings: DisplaySettings;
  t: UiText;
  language: ResolvedLanguage;
  onQuickAdd: (request: QuickAddRequest) => void;
  onOpenMenu: (request: GalleryMenuRequest) => void;
  onHoverPreview: (request: HoverPreviewRequest) => void;
  onClearHoverPreview: () => void;
  onDismissHoverPreview: () => void;
  onCategoryDragStart: (record: GalleryRecord, e: ReactDragEvent<HTMLButtonElement>) => void;
  onCategoryDragEnd: () => void;
  isDragging: boolean;
}) {
  const cardRef = useRef<HTMLDivElement | null>(null);

  // Left column = prompt side (input / reference / negative); right = output.
  const left = record.assets.filter((a) => a.role !== 'output');
  const right = record.assets.filter((a) => a.role === 'output');
  const isOutputOnly = settings.cardLayout === 'output-only';
  const isInputOnly = settings.cardLayout === 'input-only';
  const visibleSingleColumnAssets = isInputOnly ? left : right;
  const singleColumnHasMedia = visibleSingleColumnAssets.some((a) => a.assetType !== 'text');
  const categoryText = record.categoryName ?? t.uncategorized;

  const editorAnchorTopForCard = () => {
    const rect = cardRef.current?.getBoundingClientRect();
    return rect?.top ?? 8;
  };

  const openQuickAdd = (content: QuickAddContent, mode: QuickAddRequest['mode']) => {
    onQuickAdd({ target: { kind: 'record', record }, content, mode, anchorTopPx: editorAnchorTopForCard() });
  };
  const showTextPreview = (label: string, text: string, el: HTMLElement) => {
    onHoverPreview({ content: { kind: 'text', label, text }, anchorTopPx: el.getBoundingClientRect().top });
  };

  return (
    <div
      ref={cardRef}
      className={`pt-gcard${isOutputOnly || isInputOnly ? ' pt-gcard--single-column' : ''}${singleColumnHasMedia ? ' pt-gcard--single-column-media' : ''}${isDragging ? ' pt-gcard--dragging' : ''}`}
      tabIndex={0}
      onMouseEnter={() => cardRef.current?.focus({ preventScroll: true })}
      onPaste={(e) => {
        if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) return;
        onDismissHoverPreview();
        const imageFile = [...e.clipboardData.files].find((file) => file.type.startsWith('image/'));
        if (imageFile) {
          e.preventDefault();
          e.stopPropagation();
          fileToDataUrl(imageFile).then((dataUrl) => openQuickAdd({ kind: 'image', dataUrl, name: imageFile.name }, 'pasted'));
          return;
        }
        const text = e.clipboardData.getData('text/plain').trim();
        if (!text) return;
        e.preventDefault();
        e.stopPropagation();
        openQuickAdd({ kind: 'text', text }, 'pasted');
      }}
      onContextMenu={(e) => {
        if ((e.target as HTMLElement).closest('textarea')) return;
        onDismissHoverPreview();
        e.preventDefault();
        const rect = cardRef.current?.getBoundingClientRect();
        onOpenMenu({ record, x: e.clientX, y: e.clientY, anchorTopPx: rect?.top ?? 8 });
      }}
    >
      <div className="pt-gmeta">
        <button
          className="pt-category-drag"
          type="button"
          draggable
          aria-label={language === 'en-US' ? `Move category: ${categoryText}` : `移動分類：${categoryText}`}
          title={language === 'en-US' ? 'Drag to a category chip' : '拖到上方分類'}
          onDragStart={(e) => onCategoryDragStart(record, e)}
          onDragEnd={onCategoryDragEnd}
          onClick={(e) => e.currentTarget.blur()}
        >
          <span className="pt-category-drag-grip" aria-hidden="true">⋮⋮</span>
          <span className="pt-gtag">{categoryText}</span>
        </button>
      </div>
      {record.summary?.trim() && (
        <div
          className="pt-gsummary"
          onMouseEnter={(e) => showTextPreview(language === 'en-US' ? 'Summary' : '摘要', record.summary?.trim() ?? '', e.currentTarget)}
          onMouseLeave={onClearHoverPreview}
        >
          {record.summary.trim()}
        </div>
      )}
      <div className="pt-gcols">
        {isInputOnly ? (
          <GalleryColumn
            label={t.inputReference}
            assets={left}
            settings={settings}
            t={t}
            language={language}
            onHoverPreview={onHoverPreview}
            onClearHoverPreview={onClearHoverPreview}
          />
        ) : !isOutputOnly && (
          <GalleryColumn
            label={t.inputReference}
            assets={left}
            settings={settings}
            t={t}
            language={language}
            onHoverPreview={onHoverPreview}
            onClearHoverPreview={onClearHoverPreview}
          />
        )}
        {!isInputOnly && (
          <GalleryColumn
            label={t.output}
            assets={right}
            settings={settings}
            t={t}
            language={language}
            onHoverPreview={onHoverPreview}
            onClearHoverPreview={onClearHoverPreview}
          />
        )}
      </div>

    </div>
  );
}

type GalleryColumnItem =
  | { kind: 'text'; role: AssetRole; text: string }
  | { kind: 'asset'; asset: GalleryAsset };

function galleryColumnItems(assets: GalleryAsset[]): GalleryColumnItem[] {
  const groupedText = new Map<AssetRole, string>();
  const items: GalleryColumnItem[] = [];

  for (const asset of assets) {
    if (asset.assetType !== 'text' || !asset.textContent?.trim()) {
      items.push({ kind: 'asset', asset });
      continue;
    }

    const previous = groupedText.get(asset.role);
    if (previous != null) {
      groupedText.set(asset.role, `${previous}\n\n${asset.textContent.trim()}`);
      continue;
    }

    groupedText.set(asset.role, asset.textContent.trim());
    items.push({ kind: 'text', role: asset.role, text: asset.textContent.trim() });
  }

  return items.map((item) => (
    item.kind === 'text'
      ? { ...item, text: groupedText.get(item.role) ?? item.text }
      : item
  ));
}

function GalleryColumn({
  label,
  assets,
  settings,
  t,
  language,
  onHoverPreview,
  onClearHoverPreview,
}: {
  label: string;
  assets: GalleryAsset[];
  settings: DisplaySettings;
  t: UiText;
  language: ResolvedLanguage;
  onHoverPreview: (request: HoverPreviewRequest) => void;
  onClearHoverPreview: () => void;
}) {
  const items = galleryColumnItems(assets);

  const copy = async () => {
    if (assets.length === 0) return;
    try {
      const clipboardResult = await copyGalleryAssetsText(assets);
      const insertResult = await insertGalleryAssetsIntoPrompt(assets);
      void clipboardResult;
      void insertResult;
    } catch {
    }
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    copy();
  };

  return (
    <div
      className={assets.length > 0 ? 'pt-gcol pt-gcol--copyable' : 'pt-gcol'}
      onClick={copy}
      onKeyDown={onKeyDown}
      role={assets.length > 0 ? 'button' : undefined}
      tabIndex={assets.length > 0 ? 0 : undefined}
      title={assets.length > 0 ? t.clickCopyColumn : undefined}
    >
      <div className="pt-gcol-label">
        <span>{label}</span>
      </div>
      <div className="pt-gcol-content">
        {assets.length === 0 ? (
          <div className="pt-gcol-empty">—</div>
        ) : (
          items.map((item, i) => (
            item.kind === 'text' ? (
              <GalleryPrompt
                key={`${item.role}-${i}`}
                role={item.role}
                text={item.text}
                color={settings.roleColors[item.role]}
                language={language}
                onHoverPreview={onHoverPreview}
                onClearHoverPreview={onClearHoverPreview}
              />
            ) : (
              <GalleryAssetView
                key={i}
                asset={item.asset}
                settings={settings}
                language={language}
                onHoverPreview={onHoverPreview}
                onClearHoverPreview={onClearHoverPreview}
              />
            )
          ))
        )}
      </div>
    </div>
  );
}

/** Re-tag a saved record's category + model. Flies out to the left of the panel
 *  so every option is visible without an internal scroll fight. */
function CardEditor({
  record,
  topVh,
  t,
  language,
  onClose,
  onSaved,
}: {
  record: GalleryRecord;
  topVh: number;
  t: UiText;
  language: ResolvedLanguage;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [categories, setCategories] = useState<RecordCategory[]>([]);
  const [categoryId, setCategoryId] = useState<string | null>(record.categoryId ?? null);
  // Don't touch the model unless the user picks one — otherwise editing the
  // category alone would wipe a custom / auto-detected model label.

  useEffect(() => {
    send({ type: 'taxonomy/get', payload: {} }).then((r) => {
      const data = r as { categories: RecordCategory[] } | undefined;
      if (data) {
        setCategories(data.categories);
      }
    });
  }, []);

  const save = async () => {
    await send({
      type: 'library/updateRecordMeta',
      payload: {
        recordId: record.id,
        categoryId,
      },
    });
    onSaved();
  };

  return (
    <div
      className="pt-glass pt-geditor"
      style={{ top: `${topVh}vh` }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="pt-geditor-title">{language === 'en-US' ? 'Edit labels' : '編輯標籤'}</div>
      <div className="pt-geditor-label">{t.category}</div>
      <div className="pt-choices">
        <button
          className={categoryId === null ? 'pt-choice pt-choice--on' : 'pt-choice'}
          onClick={() => setCategoryId(null)}
        >
          {t.uncategorized}
        </button>
        {categories
          .filter((c) => c.isActive)
          .map((c) => (
            <button
              key={c.id}
              className={categoryId === c.id ? 'pt-choice pt-choice--on' : 'pt-choice'}
              onClick={() => setCategoryId(c.id)}
            >
              {categoryLabel(c, language)}
            </button>
          ))}
      </div>
      <div className="pt-geditor-actions">
        <button className="pt-choice pt-choice--sub" onClick={onClose}>
          {language === 'en-US' ? 'Cancel' : '取消'}
        </button>
        <button className="pt-choice pt-choice--detected" onClick={save}>
          {language === 'en-US' ? 'Save' : '儲存'}
        </button>
      </div>
    </div>
  );
}

function QuickTextEditor({
  request,
  settings,
  language,
  onClose,
  onSaved,
}: {
  request: QuickAddRequest;
  settings: DisplaySettings;
  language: ResolvedLanguage;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [text, setText] = useState(request.content.kind === 'text' ? request.content.text : '');
  const [status, setStatus] = useState('');
  const [topPx, setTopPx] = useState(request.anchorTopPx);
  const editorRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const assetType = request.content.kind === 'image' ? 'image' : 'text';
  const roles = allowedRolesFor(assetType);

  const updatePosition = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const margin = 8;
    const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
    const maxTop = Math.max(margin, viewportHeight - editor.offsetHeight - margin);
    setTopPx(Math.min(maxTop, Math.max(margin, request.anchorTopPx)));
  }, [request.anchorTopPx]);

  useEffect(() => {
    if (request.mode === 'compose') {
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
  }, [request.mode]);

  useLayoutEffect(() => {
    updatePosition();
  }, [updatePosition, request.content.kind, request.mode, text]);

  useEffect(() => {
    window.addEventListener('resize', updatePosition, { passive: true });
    window.visualViewport?.addEventListener('resize', updatePosition, { passive: true });
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.visualViewport?.removeEventListener('resize', updatePosition);
    };
  }, [updatePosition]);

  const save = async (role: AssetRole) => {
    if (!allowedRolesFor(assetType).includes(role)) return;
    setStatus(language === 'en-US' ? 'Saving...' : '儲存中...');
    const result = request.target.kind === 'capture'
      ? ((await send({
          type: 'capture/addManualAsset',
          payload: request.content.kind === 'image'
            ? {
                assetType: 'image',
                originalUrl: request.content.dataUrl,
                role,
                pageUrl: window.location.href,
                pageTitle: document.title,
                capturedAt: new Date().toISOString(),
              }
            : {
                assetType: 'text',
                textContent: text.trim(),
                role,
                pageUrl: window.location.href,
                pageTitle: document.title,
                capturedAt: new Date().toISOString(),
              },
        })) as { ok?: boolean } | undefined)
      : request.content.kind === 'image'
        ? ((await send({
            type: 'library/addRecordMediaAsset',
            payload: {
              recordId: request.target.record.id,
              assetType: 'image',
              originalUrl: request.content.dataUrl,
              previewRef: request.content.dataUrl,
              role,
            },
          })) as { ok?: boolean } | undefined)
        : ((await send({
            type: 'library/addRecordTextAsset',
            payload: { recordId: request.target.record.id, textContent: text.trim(), role },
          })) as { ok?: boolean } | undefined);
    if (!result?.ok) {
      setStatus(language === 'en-US' ? 'Save failed. Try again.' : '儲存失敗，請重試。');
      return;
    }
    onSaved();
  };

  const canSave = request.content.kind === 'image' || text.trim().length > 0;

  return (
    <div
      ref={editorRef}
      className="pt-glass pt-geditor pt-quick-editor"
      style={{ top: topPx }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="pt-geditor-title">
        {request.content.kind === 'image'
          ? language === 'en-US'
            ? 'Add image'
            : '新增圖片'
          : language === 'en-US'
            ? 'Add text'
            : '新增文字'}
      </div>
      {request.mode === 'compose' && (
        <>
          <div className="pt-geditor-label">{language === 'en-US' ? 'Text' : '文字'}</div>
          <textarea
            ref={textareaRef}
            value={text}
            placeholder={language === 'en-US' ? 'Type or paste text, then choose a role.' : '輸入或貼上文字，再選角色。'}
            onChange={(e) => {
              setText(e.target.value);
              setStatus('');
            }}
            onPaste={() => setStatus('')}
          />
        </>
      )}
      {request.mode === 'pasted' && request.content.kind === 'text' && (
        <>
          <div className="pt-geditor-label">{language === 'en-US' ? 'Pasted text' : '貼上的文字'}</div>
          <div className="pt-quick-preview pt-quick-preview--text">{text}</div>
        </>
      )}
      {request.mode === 'pasted' && request.content.kind === 'image' && (
        <>
          <div className="pt-geditor-label">{language === 'en-US' ? 'Pasted image' : '貼上的圖片'}</div>
          <div className="pt-quick-preview pt-quick-preview--image">
            <img src={request.content.dataUrl} alt="" onLoad={updatePosition} />
            {request.content.name && <span>{request.content.name}</span>}
          </div>
        </>
      )}
      <div className="pt-geditor-label">{language === 'en-US' ? 'Role' : '角色'}</div>
      <div className="pt-choices">
        {roles.map((role) => (
          <button
            key={role}
            className="pt-choice"
            type="button"
            disabled={!canSave}
            style={{ ['--role-color' as string]: settings.roleColors[role] }}
            onClick={() => save(role)}
          >
            {roleLabel(role, language)}
          </button>
        ))}
      </div>
      <div className="pt-geditor-actions">
        <button className="pt-choice pt-choice--sub" onClick={onClose}>
          {language === 'en-US' ? 'Cancel' : '取消'}
        </button>
      </div>
      {status && <div className="pt-quick-status">{status}</div>}
    </div>
  );
}

function HoverPreview({
  request,
  onKeepOpen,
  onRequestClose,
}: {
  request: HoverPreviewRequest;
  onKeepOpen: () => void;
  onRequestClose: () => void;
}) {
  const [topPx, setTopPx] = useState(request.anchorTopPx);
  const previewRef = useRef<HTMLDivElement | null>(null);

  const updatePosition = useCallback(() => {
    const preview = previewRef.current;
    if (!preview) return;
    const margin = 8;
    const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
    const maxTop = Math.max(margin, viewportHeight - preview.offsetHeight - margin);
    setTopPx(Math.min(maxTop, Math.max(margin, request.anchorTopPx)));
  }, [request.anchorTopPx]);

  useLayoutEffect(() => {
    updatePosition();
  }, [updatePosition, request.content]);

  useEffect(() => {
    window.addEventListener('resize', updatePosition, { passive: true });
    window.visualViewport?.addEventListener('resize', updatePosition, { passive: true });
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.visualViewport?.removeEventListener('resize', updatePosition);
    };
  }, [updatePosition]);

  return (
    <div
      ref={previewRef}
      className={`pt-glass pt-geditor pt-hover-preview pt-hover-preview--${request.content.kind}`}
      style={{ top: topPx }}
      onMouseEnter={onKeepOpen}
      onMouseLeave={onRequestClose}
    >
      <div className="pt-geditor-label">{request.content.label}</div>
      {request.content.kind === 'image' ? (
        <img src={request.content.src} alt="" onLoad={updatePosition} />
      ) : (
        <div className="pt-hover-preview-text">{request.content.text}</div>
      )}
    </div>
  );
}

function GalleryAssetView({
  asset,
  settings,
  language,
  onHoverPreview,
  onClearHoverPreview,
}: {
  asset: GalleryAsset;
  settings: DisplaySettings;
  language: ResolvedLanguage;
  onHoverPreview: (request: HoverPreviewRequest) => void;
  onClearHoverPreview: () => void;
}) {
  if (asset.assetType === 'text' && asset.textContent) {
    return (
      <GalleryPrompt
        role={asset.role}
        text={asset.textContent}
        color={settings.roleColors[asset.role]}
        language={language}
        onHoverPreview={onHoverPreview}
        onClearHoverPreview={onClearHoverPreview}
      />
    );
  }
  // Prefer the durable local thumbnail; the remote originalUrl (e.g. ChatGPT's
  // signed URL) can expire or be blocked by the page CSP, leaving OUTPUT blank.
  const src = asset.previewRef ?? asset.originalUrl;
  if (src) {
    return (
      <img
        className="pt-gthumb"
        src={src}
        alt=""
        loading="lazy"
        onMouseEnter={(e) => {
          onHoverPreview({
            content: { kind: 'image', label: roleLabel(asset.role, language), src },
            anchorTopPx: e.currentTarget.getBoundingClientRect().top,
          });
        }}
        onMouseLeave={onClearHoverPreview}
        onError={(e) => {
          if (asset.previewRef && e.currentTarget.src !== asset.previewRef) {
            e.currentTarget.src = asset.previewRef;
            return;
          }
          e.currentTarget.style.display = 'none';
        }}
      />
    );
  }
  return null;
}

function GalleryPrompt({
  role,
  text,
  color,
  language,
  onHoverPreview,
  onClearHoverPreview,
}: {
  role: AssetRole;
  text: string;
  color: string;
  language: ResolvedLanguage;
  onHoverPreview: (request: HoverPreviewRequest) => void;
  onClearHoverPreview: () => void;
}) {
  return (
    <div
      className="pt-gprompt"
      onMouseEnter={(e) => {
        onHoverPreview({
          content: { kind: 'text', label: roleLabel(role, language), text },
          anchorTopPx: e.currentTarget.getBoundingClientRect().top,
        });
      }}
      onMouseLeave={onClearHoverPreview}
    >
      <div className="pt-gprompt-head">
        <span className="pt-pill" style={{ background: color }}>
          {roleLabel(role, language)}
        </span>
      </div>
      <div className="pt-gtext">{text}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Save wizard inside the edge panel                                  */
/* ------------------------------------------------------------------ */

/** Built-in category ids, keyed by asset type (mirrors storage/seed.ts). */
const BUILTIN_CATEGORY_BY_TYPE: Record<PendingAsset['assetType'], string> = {
  text: 'builtin-text-gen',
  image: 'builtin-image-gen',
  video: 'builtin-video-gen',
};

function Wizard({
  setStage,
  outputTypes,
  t,
  language,
  onCommitted,
}: {
  setStage: (w: null | 'category') => void;
  outputTypes?: PendingAsset['assetType'][];
  t: UiText;
  language: ResolvedLanguage;
  onCommitted: (recordId: string) => void;
}) {
  const [categories, setCategories] = useState<RecordCategory[]>([]);

  // Suggest a category from the OUTPUT type (image→生圖, video→生影, text→生文).
  // Only when the outputs are a single type; mixed/none stays unsuggested.
  const suggestedCategoryId = useMemo(() => {
    const types = new Set(outputTypes ?? []);
    if (types.size !== 1) return null;
    return BUILTIN_CATEGORY_BY_TYPE[[...types][0]] ?? null;
  }, [outputTypes]);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [newName, setNewName] = useState('');

  const loadTaxonomy = useCallback(async () => {
    const r = (await send({ type: 'taxonomy/get', payload: {} })) as
      | { categories: RecordCategory[] }
      | undefined;
    if (r) {
      setCategories(r.categories.filter((c) => c.isActive));
    }
  }, []);
  useEffect(() => {
    loadTaxonomy();
  }, [loadTaxonomy]);

  const tree = useMemo(() => {
    const byParent = new Map<string | null, RecordCategory[]>();
    for (const c of categories) {
      const k = c.parentId ?? null;
      if (!byParent.has(k)) byParent.set(k, []);
      byParent.get(k)!.push(c);
    }
    const out: { c: RecordCategory; depth: number }[] = [];
    const walk = (parent: string | null, depth: number) => {
      for (const c of (byParent.get(parent) ?? []).sort((a, b) => a.sortOrder - b.sortOrder)) {
        out.push({ c, depth });
        walk(c.id, depth + 1);
      }
    };
    walk(null, 0);
    return out;
  }, [categories]);

  const commit = async (nextCategoryId: unknown = categoryId) => {
    const resolvedCategoryId = typeof nextCategoryId === 'string' || nextCategoryId === null ? nextCategoryId : categoryId;
    const result = (await send({ type: 'capture/commitSession', payload: { categoryId: resolvedCategoryId } })) as
      | { ok?: boolean; recordId?: string }
      | undefined;
    if (result?.ok && result.recordId) onCommitted(result.recordId);
    setStage(null);
  };

  const pickCategory = (id: string | null) => {
    setCategoryId(id);
    commit(id);
  };

  const quickAdd = async () => {
    const name = newName.trim();
    if (!name) return;
    const r = (await send({ type: 'taxonomy/quickAddCategory', payload: { name } })) as
      | { category: RecordCategory }
      | undefined;
    if (r?.category) {
      setNewName('');
      pickCategory(r.category.id);
    }
  };

  return (
    <div className="pt-card pt-wizard">
      <strong>{t.category}（{language === 'en-US' ? 'optional' : '選填'}）</strong>
      <div className="pt-choices">
        <button className="pt-choice" onClick={() => pickCategory(null)}>
          {t.uncategorized}
        </button>
        {tree.map(({ c, depth }) => {
          const suggested = c.id === suggestedCategoryId;
          return (
            <button
              key={c.id}
              className={suggested ? 'pt-choice pt-choice--detected' : 'pt-choice'}
              style={{ paddingLeft: 12 + depth * 14 }}
              onClick={() => pickCategory(c.id)}
            >
              {suggested ? '✨ ' : ''}
              {categoryLabel(c, language)}
              {suggested ? (language === 'en-US' ? ' · suggested' : ' · 依產出建議') : ''}
            </button>
          );
        })}
      </div>
      <div className="pt-row" style={{ marginTop: 8 }}>
        <input
          type="text"
          placeholder={language === 'en-US' ? 'Quick add category…' : '快速新增分類…'}
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') quickAdd();
          }}
          style={{ flex: 1, width: 'auto' }}
        />
        <button className="pt-small-btn" disabled={!newName.trim()} onClick={quickAdd}>
          {t.add}
        </button>
      </div>
      <div className="pt-wizard-foot">
        <button className="pt-link-btn" onClick={() => setStage(null)}>
          ← {language === 'en-US' ? 'Back' : '返回'}
        </button>
        <button className="pt-link-btn pt-wizard-x" onClick={() => setStage(null)} title={language === 'en-US' ? 'Cancel save' : '取消保存'}>
          ✕ {language === 'en-US' ? 'Cancel' : '取消'}
        </button>
      </div>
    </div>
  );
}
