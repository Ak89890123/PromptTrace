import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from 'react';
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
import type { GalleryAsset, GalleryRecord, ListRecordsResult } from '@/src/core/messages';

const send = (message: unknown) => chrome.runtime.sendMessage(message).catch(() => undefined);
const openExtensionPage = (page: 'library' | 'settings', hash?: string) =>
  send({ type: 'navigation/openExtensionPage', payload: { page, hash } });

export default function PanelApp({ overlay }: { overlay: OverlayManager }) {
  const [settings, setSettings] = useState<DisplaySettings>(DEFAULT_SETTINGS);
  const [session, setSession] = useState<CaptureSessionState>(emptySession());
  // Zoom lives at the root so the lightbox renders OUTSIDE .pt-glass — its
  // backdrop-filter would otherwise become the containing block for the
  // position:fixed overlay and trap it inside the narrow panel.
  const [zoom, setZoom] = useState<ZoomSrc | null>(null);

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
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);
  const language = resolveLanguage(settings.language);
  const t = UI_TEXT[language];

  return (
    <>
      {settings.selectionToolbarEnabled && <SelectionToolbar overlay={overlay} settings={settings} language={language} />}
      {settings.edgePanelEnabled && <CapturePanel session={session} settings={settings} t={t} />}
      {settings.edgePanelEnabled && <GalleryPanel settings={settings} onZoom={setZoom} t={t} language={language} />}
      {zoom && <Lightbox zoom={zoom} onClose={() => setZoom(null)} t={t} />}
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

  /** Media under the cursor, piercing overlay layers. ChatGPT stacks an action
   *  bar over generated images, so plain hover lands on a <div>, not the <img>;
   *  elementsFromPoint sees through to the image beneath. */
  const findMedia = useCallback((): HTMLImageElement | HTMLVideoElement | null => {
    const p = lastPointer.current;
    if (p) {
      for (const el of document.elementsFromPoint(p.x, p.y)) {
        if (el.tagName === 'IMG' || el.tagName === 'VIDEO') {
          return el as HTMLImageElement | HTMLVideoElement;
        }
      }
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
    const onMouseOver = (e: MouseEvent) => {
      lastPointer.current = { x: e.clientX, y: e.clientY };
      const el = e.target as Element | null;
      if (el && (el.tagName === 'IMG' || el.tagName === 'VIDEO')) {
        hoveredMedia.current = el as HTMLImageElement | HTMLVideoElement;
      }
    };
    const onMouseMove = (e: MouseEvent) => {
      lastPointer.current = { x: e.clientX, y: e.clientY };
    };
    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      const toolbar = toolbarRef.current;
      if (toolbar && e.composedPath().includes(toolbar)) return;
      window.getSelection()?.removeAllRanges();
      hide();
    };
    const onContextMenu = (e: MouseEvent) => {
      lastPointer.current = { x: e.clientX, y: e.clientY };
      lastContextMedia.current = null;
      for (const el of document.elementsFromPoint(e.clientX, e.clientY)) {
        if (el.tagName === 'IMG' || el.tagName === 'VIDEO') {
          lastContextMedia.current = el as HTMLImageElement | HTMLVideoElement;
          break;
        }
      }
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
      onMouseDown={(e) => e.preventDefault() /* keep the selection alive */}
    >
      {roles.map((role) => (
        <button key={role} style={{ ['--role-color' as string]: settings.roleColors[role] }} onClick={() => capture(role)}>
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

function CapturePanel({ session, settings, t }: { session: CaptureSessionState; settings: DisplaySettings; t: UiText }) {
  const [open, setOpen] = useState(false);
  const prevCount = useRef(0);
  const [wizard, setWizard] = useState<null | 'category'>(null);

  const count = session.assets.length;
  const active = count > 0 || session.conflicts.length > 0 || session.errors.length > 0;
  const justSaved = !active && !!session.lastCommittedRecordId;

  // Auto-peek when a new asset / conflict / error lands in the session.
  useEffect(() => {
    if (session.assets.length > prevCount.current || session.conflicts.length > 0 || session.errors.length > 0) {
      setOpen(true);
    }
    prevCount.current = session.assets.length;
  }, [session.assets.length, session.conflicts.length, session.errors.length]);

  // Nothing to show when idle — browsing saved prompts lives in GalleryPanel.
  if (!open || (!active && !justSaved)) return null;

  const leave = () => {
    // Never vanish mid-capture; once idle, collapse on leave.
    if (active || wizard) return;
    setOpen(false);
  };

  return (
    <div className="pt-capture-edge" onMouseEnter={() => setOpen(true)} onMouseLeave={leave}>
      <div className={`pt-glass pt-panel${wizard ? ' pt-panel--wizard' : ''}`}>
        <div className="pt-panel-head">
          <span className="pt-title">
            <img className="pt-logo-img" src={LOGO_DATA_URL} alt="" />
            PrompTrace
          </span>
          <span className="pt-links">
            <a onClick={() => openExtensionPage('library')}>{t.goLibrary}</a>
            <a onClick={() => openExtensionPage('settings')}>{t.settings}</a>
          </span>
        </div>
        <div className="pt-panel-body">
          <CaptureBody session={session} settings={settings} wizard={wizard} setWizard={setWizard} t={t} language={resolveLanguage(settings.language)} />
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
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Gallery panel: right-middle, hover-open with optional pin           */
/* ------------------------------------------------------------------ */

function GalleryPanel({
  settings,
  onZoom,
  t,
  language,
}: {
  settings: DisplaySettings;
  onZoom: (z: ZoomSrc | null) => void;
  t: UiText;
  language: ResolvedLanguage;
}) {
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [editing, setEditing] = useState<GalleryRecord | null>(null);
  const [refreshSignal, setRefreshSignal] = useState(0);
  const panelWidth = settings.cardLayout === 'split' ? 'min(440px, 94vw)' : 'min(267px, 94vw)';
  const edgeStyle = { '--pt-gallery-panel-width': panelWidth } as CSSProperties;
  // The tab sits where the user put it; the panel keeps its full height and only
  // shifts enough to stay on-screen while still covering the tab (so hover-open
  // holds). Tab high → panel pinned near the top (extends down); tab low → pinned
  // near the bottom (extends up). It never shrinks to a sliver.
  const PANEL_VH = 86;
  const edgeTop = Math.min(94, Math.max(6, settings.edgeTabTop ?? 50));
  const panelTopVh = Math.min(100 - PANEL_VH - 2, Math.max(2, edgeTop - PANEL_VH / 2));
  const openGallery = () => {
    setOpen(true);
  };
  const closeGallery = () => {
    // Stay open while editing (the editor flyout sits to the left). Otherwise
    // leaving the gallery closes it and dismisses the big preview.
    if (editing || pinned) return;
    setOpen(false);
    onZoom(null);
  };
  const dismissGallery = useCallback(() => {
    setPinned(false);
    setEditing(null);
    setOpen(false);
    onZoom(null);
  }, [onZoom]);
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
  return (
    <div className="pt-gallery-edge" style={edgeStyle}>
      {open ? (
        // The dock's padding-right keeps the visual gap to the screen edge part of
        // the hover zone, so sliding into it doesn't drop hover and flicker shut.
        <div
          className="pt-panel-dock"
          style={{ top: `${panelTopVh}vh` }}
          onMouseEnter={openGallery}
          onMouseLeave={closeGallery}
        >
          <div className="pt-glass pt-panel pt-gallery-panel" style={{ maxHeight: `${PANEL_VH}vh` }}>
            <div className="pt-panel-head">
              <span className="pt-title">
                <img className="pt-logo-img" src={LOGO_DATA_URL} alt="" />
                PrompTrace
              </span>
              <span className="pt-links">
                <a onClick={() => openExtensionPage('library')}>{t.goLibrary}</a>
                <a onClick={() => openExtensionPage('settings')}>{t.settings}</a>
              </span>
              <span className="pt-panel-actions">
                <button
                  className={`pt-icon-btn${pinned ? ' is-on' : ''}`}
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
                onZoom={onZoom}
                onEdit={setEditing}
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
}: {
  session: CaptureSessionState;
  settings: DisplaySettings;
  wizard: null | 'category';
  setWizard: (w: null | 'category') => void;
  t: UiText;
  language: ResolvedLanguage;
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
        session.lastCommittedRecordId && (
          <div className="pt-card">
            ✅ {t.saved}{' '}
            <a
              style={{ color: '#8ad7e8', cursor: 'pointer' }}
              onClick={() => openExtensionPage('library', `#record=${session.lastCommittedRecordId}`)}
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
            <PanelAssetCard key={a.id} asset={a} settings={settings} t={t} language={language} />
          ))}
        </div>
      ))}

    </>
  );
}

function PanelAssetCard({ asset, settings, t, language }: { asset: PendingAsset; settings: DisplaySettings; t: UiText; language: ResolvedLanguage }) {
  const allowed = allowedRolesFor(asset.assetType);
  return (
    <div className="pt-card">
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

/* ------------------------------------------------------------------ */
/*  Gallery: scrollable, copyable library of saved prompts             */
/* ------------------------------------------------------------------ */

/** Best-quality source first, durable fallback second (for the zoom view). */
type ZoomSrc = { primary?: string; fallback?: string };

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function galleryAssetRef(asset: GalleryAsset): string {
  return asset.previewRef ?? asset.originalUrl ?? '';
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
      const ref = galleryAssetRef(asset);
      return ref ? `[${asset.assetType}] ${ref}` : `[${asset.assetType}]`;
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

function galleryAssetsHtml(assets: GalleryAsset[]): string {
  const body = assets
    .map((asset) => {
      if (asset.assetType === 'text' && asset.textContent) {
        return `<p>${escapeHtml(asset.textContent.trim()).replaceAll('\n', '<br>')}</p>`;
      }
      const src = galleryAssetRef(asset);
      if (asset.assetType === 'image' && src) {
        return `<p><img src="${escapeHtml(src)}" alt="" style="max-width:100%;height:auto;"></p>`;
      }
      return src ? `<p><a href="${escapeHtml(src)}">${escapeHtml(src)}</a></p>` : '';
    })
    .filter(Boolean)
    .join('');
  return `<div>${body}</div>`;
}

async function copyGalleryAssets(assets: GalleryAsset[]): Promise<'rich' | 'text'> {
  const text = galleryAssetsPlainText(assets);
  const hasImage = assets.some((asset) => asset.assetType === 'image' && galleryAssetRef(asset));
  if (hasImage && 'ClipboardItem' in window && navigator.clipboard.write) {
    try {
      const [file] = await imageFilesFromAssets(assets);
      if (file) {
        await navigator.clipboard.write([
          new ClipboardItem({
            'image/png': file,
            'text/plain': new Blob([text], { type: 'text/plain' }),
            'text/html': new Blob([galleryAssetsHtml(assets)], { type: 'text/html' }),
          }),
        ]);
        return 'rich';
      }
    } catch {
      // Some sites/browsers reject mixed image + text clipboard items.
    }
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/plain': new Blob([text], { type: 'text/plain' }),
          'text/html': new Blob([galleryAssetsHtml(assets)], { type: 'text/html' }),
        }),
      ]);
      return 'rich';
    } catch {
      // Rich clipboard is best-effort; plain text still carries the media refs.
    }
  }
  await navigator.clipboard.writeText(text);
  return 'text';
}

type ComposerTarget = HTMLInputElement | HTMLTextAreaElement | HTMLElement;
type PromptInsertResult = 'uploaded' | 'pasted' | 'imageClipboard' | 'filled' | 'none';

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
  const insertion = target.value ? text : text;
  const next =
    start !== end || start < target.value.length
      ? `${target.value.slice(0, start)}${insertion}${target.value.slice(end)}`
      : appendWithSeparator(target.value, insertion);
  const proto = target instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(target, next);
  target.focus();
  const cursor = next.length;
  target.setSelectionRange(cursor, cursor);
  target.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: text }));
  target.dispatchEvent(new Event('change', { bubbles: true }));
}

function setContentEditableText(target: HTMLElement, text: string): void {
  target.focus();
  const current = target.innerText;
  const next = appendWithSeparator(current, text);
  target.textContent = next;
  const range = document.createRange();
  range.selectNodeContents(target);
  range.collapse(false);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  target.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: text }));
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
      // Try the next source. Original URLs can expire; previewRef is the fallback.
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

async function writeGalleryImageToClipboard(assets: GalleryAsset[], text: string): Promise<boolean> {
  const [file] = await imageFilesFromAssets(assets);
  if (!file || !('ClipboardItem' in window) || !navigator.clipboard.write) return false;
  const item: Record<string, Blob> = { 'image/png': file };
  if (text) item['text/plain'] = new Blob([text], { type: 'text/plain' });
  await navigator.clipboard.write([new ClipboardItem(item)]);
  return true;
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
    if (await writeGalleryImageToClipboard(assets, '')) {
      target.focus();
      insertTextIntoPromptTarget(target, text);
      return 'imageClipboard';
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
  onZoom,
  onEdit,
  refreshSignal,
}: {
  settings: DisplaySettings;
  t: UiText;
  language: ResolvedLanguage;
  onZoom: (z: ZoomSrc) => void;
  onEdit: (r: GalleryRecord) => void;
  refreshSignal: number;
}) {
  const [records, setRecords] = useState<GalleryRecord[] | null>(null);
  const refresh = useCallback(() => {
    send({ type: 'library/listRecords', payload: {} }).then((r) => {
      setRecords((r as ListRecordsResult | undefined)?.records ?? []);
    });
  }, []);
  // Re-fetch on mount and whenever an edit elsewhere bumps the signal.
  useEffect(() => {
    refresh();
  }, [refresh, refreshSignal]);

  if (records === null) return <div className="pt-empty">{t.loading}</div>;
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
  return (
    <div className="pt-gallery">
      {records.map((r) => (
        <GalleryCard
          key={r.id}
          record={r}
          settings={settings}
          t={t}
          language={language}
          onZoom={onZoom}
          onEdit={onEdit}
          onChanged={refresh}
        />
      ))}
    </div>
  );
}

/** Full-screen image preview. Click anywhere or press Esc to dismiss. */
function Lightbox({ zoom, onClose, t }: { zoom: ZoomSrc; onClose: () => void; t: UiText }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const src = zoom.primary ?? zoom.fallback;
  if (!src) return null;
  return (
    <div className="pt-lightbox" role="presentation">
      <img
        className="pt-lightbox-img"
        src={src}
        alt=""
        onClick={onClose}
        onError={(e) => {
          if (zoom.fallback && e.currentTarget.src !== zoom.fallback) {
            e.currentTarget.src = zoom.fallback;
          }
        }}
      />
      <button className="pt-lightbox-close" type="button" aria-label={t.close} onClick={onClose}>
        ✕
      </button>
    </div>
  );
}

function GalleryCard({
  record,
  settings,
  t,
  language,
  onZoom,
  onEdit,
  onChanged,
}: {
  record: GalleryRecord;
  settings: DisplaySettings;
  t: UiText;
  language: ResolvedLanguage;
  onZoom: (z: ZoomSrc) => void;
  onEdit: (r: GalleryRecord) => void;
  onChanged: () => void;
}) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);

  const closeMenu = () => {
    setMenu(null);
    setConfirmDel(false);
  };

  // Left column = prompt side (input / reference / negative); right = output.
  const left = record.assets.filter((a) => a.role !== 'output');
  const right = record.assets.filter((a) => a.role === 'output');
  const isOutputOnly = settings.cardLayout === 'output-only';
  const isInputOnly = settings.cardLayout === 'input-only';
  const visibleSingleColumnAssets = isInputOnly ? left : right;
  const singleColumnHasMedia = visibleSingleColumnAssets.some((a) => a.assetType !== 'text');

  const remove = async () => {
    closeMenu();
    await send({ type: 'library/deleteRecord', payload: { recordId: record.id } });
    onChanged();
  };

  return (
    <div
      className={`pt-gcard${isOutputOnly || isInputOnly ? ' pt-gcard--single-column' : ''}${singleColumnHasMedia ? ' pt-gcard--single-column-media' : ''}`}
      onContextMenu={(e) => {
        e.preventDefault();
        const rect = e.currentTarget.getBoundingClientRect();
        setMenu({ x: e.clientX - rect.left, y: e.clientY - rect.top });
      }}
    >
      {record.categoryName && (
        <div className="pt-gmeta">
          <span className="pt-gtag">{record.categoryName}</span>
        </div>
      )}
      <div className="pt-gcols">
        {isInputOnly ? (
          <GalleryColumn label={t.inputReference} assets={left} settings={settings} onZoom={onZoom} t={t} language={language} />
        ) : !isOutputOnly && (
          <GalleryColumn label={t.inputReference} assets={left} settings={settings} onZoom={onZoom} t={t} language={language} />
        )}
        {!isInputOnly && <GalleryColumn label={t.output} assets={right} settings={settings} onZoom={onZoom} t={t} language={language} />}
      </div>

      {menu && <div className="pt-menu-backdrop" onClick={closeMenu} role="presentation" />}
      {menu && (
        <div
          className="pt-gmenu"
          style={{ left: menu.x, top: menu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          {!confirmDel ? (
            <>
              <button
                className="pt-gmenu-item"
                onClick={() => {
                  closeMenu();
                  onEdit(record);
                }}
              >
                {language === 'en-US' ? 'Edit tags' : '編輯標籤'}
              </button>
              <button
                className="pt-gmenu-item pt-gmenu-item--danger"
                onClick={() => setConfirmDel(true)}
              >
                {t.delete}
              </button>
            </>
          ) : (
            <>
              <div className="pt-gmenu-confirm">{language === 'en-US' ? 'Delete this record? Local files will be removed too.' : '刪除這筆？本機檔案也會移除。'}</div>
              <button className="pt-gmenu-item pt-gmenu-item--danger" onClick={remove}>
                {language === 'en-US' ? 'Delete' : '確定刪除'}
              </button>
              <button className="pt-gmenu-item" onClick={() => setConfirmDel(false)}>
                {language === 'en-US' ? 'Cancel' : '取消'}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function GalleryColumn({
  label,
  assets,
  settings,
  onZoom,
  t,
  language,
}: {
  label: string;
  assets: GalleryAsset[];
  settings: DisplaySettings;
  onZoom: (z: ZoomSrc) => void;
  t: UiText;
  language: ResolvedLanguage;
}) {
  const [copyState, setCopyState] = useState<'idle' | 'uploaded' | 'pasted' | 'imageClipboard' | 'filled' | 'text' | 'rich'>('idle');

  const copy = async () => {
    if (assets.length === 0) return;
    try {
      const clipboardResult = await copyGalleryAssets(assets);
      const insertResult = await insertGalleryAssetsIntoPrompt(assets);
      if (insertResult !== 'none') {
        setCopyState(insertResult);
        window.setTimeout(() => setCopyState('idle'), 1400);
        return;
      }
      setCopyState(clipboardResult);
      window.setTimeout(() => setCopyState('idle'), 1400);
    } catch {
      setCopyState('idle');
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
        {assets.length > 0 && (
          <span className="pt-gcol-copy">
            {copyState === 'uploaded'
              ? t.copiedAndAttached
              : copyState === 'pasted'
              ? t.copiedAndPasted
              : copyState === 'imageClipboard'
              ? t.pressCtrlV
              : copyState === 'filled'
              ? t.copiedAndFilled
              : copyState === 'rich'
                ? t.richCopied
                : copyState === 'text'
                  ? t.copied
                  : t.copy}
          </span>
        )}
      </div>
      {assets.length === 0 ? (
        <div className="pt-gcol-empty">—</div>
      ) : (
        assets.map((a, i) => <GalleryAssetView key={i} asset={a} settings={settings} onZoom={onZoom} language={language} />)
      )}
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

function GalleryAssetView({
  asset,
  settings,
  onZoom,
  language,
}: {
  asset: GalleryAsset;
  settings: DisplaySettings;
  onZoom: (z: ZoomSrc) => void;
  language: ResolvedLanguage;
}) {
  if (asset.assetType === 'text' && asset.textContent) {
    return <GalleryPrompt role={asset.role} text={asset.textContent} color={settings.roleColors[asset.role]} language={language} />;
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
        title={language === 'en-US' ? 'Click to enlarge' : '點擊放大'}
        // Zoom prefers the full-res original; falls back to the durable thumbnail.
        onClick={(e) => {
          e.stopPropagation();
          onZoom({ primary: asset.originalUrl ?? asset.previewRef, fallback: asset.previewRef });
        }}
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

function GalleryPrompt({ role, text, color, language }: { role: AssetRole; text: string; color: string; language: ResolvedLanguage }) {
  return (
    <div className="pt-gprompt">
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
}: {
  setStage: (w: null | 'category') => void;
  outputTypes?: PendingAsset['assetType'][];
  t: UiText;
  language: ResolvedLanguage;
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
    await send({ type: 'capture/commitSession', payload: { categoryId: resolvedCategoryId } });
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
