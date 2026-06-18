import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CaptureSessionState } from '@/src/core/capture/session';
import { canCommit, emptySession } from '@/src/core/capture/session';
import type { ModelPreset, PendingAsset, RecordCategory } from '@/src/core/domain/entities';
import { ROLE_LABELS, type AssetRole } from '@/src/core/domain/enums';
import { allowedRolesFor, ROLE_NOT_ALLOWED_MESSAGE } from '@/src/core/domain/validation';
import { matchHotkey } from '@/src/core/hotkeys';
import {
  DEFAULT_SETTINGS,
  loadSettings,
  onSettingsChanged,
  type DisplaySettings,
} from '@/src/ui/roleColors';
import type { OverlayManager } from './overlay';
import { LOGO_DATA_URL } from './logo';
import type { GalleryAsset, GalleryRecord, ListRecordsResult } from '@/src/core/messages';
import { detectProvider } from '@/src/core/capture/detectProvider';

const send = (message: unknown) => chrome.runtime.sendMessage(message).catch(() => undefined);

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

  return (
    <>
      {settings.selectionToolbarEnabled && <SelectionToolbar overlay={overlay} settings={settings} />}
      {settings.edgePanelEnabled && <CapturePanel session={session} settings={settings} />}
      {settings.edgePanelEnabled && <GalleryPanel settings={settings} onZoom={setZoom} />}
      {zoom && <Lightbox zoom={zoom} onClose={() => setZoom(null)} />}
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Selection toolbar: role buttons floating at the text selection     */
/* ------------------------------------------------------------------ */

type ToolbarTarget =
  | { kind: 'text'; range: Range }
  | { kind: 'media'; el: HTMLImageElement | HTMLVideoElement; assetType: 'image' | 'video' };

function SelectionToolbar({ overlay, settings }: { overlay: OverlayManager; settings: DisplaySettings }) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
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
    targetRef.current = null;
  }, []);

  const showAt = useCallback((rect: DOMRect) => {
    setPos({
      x: Math.min(Math.max(rect.left + rect.width / 2, 150), window.innerWidth - 150),
      y: rect.top,
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
      const rect = range.getBoundingClientRect();
      if (rect.width || rect.height) {
        targetRef.current = { kind: 'text', range };
        setTargetType('text');
        showAt(rect);
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

  if (!pos) return null;
  // Only roles valid for this target type ever appear (e.g. media → no Negative).
  const roles = settings.toolbarRoles.filter((r) => allowedRolesFor(targetType).includes(r));

  return (
    <div
      className="pt-glass pt-toolbar"
      style={{ left: pos.x, top: Math.max(pos.y - 46, 8), transform: 'translateX(-50%)' }}
      onMouseDown={(e) => e.preventDefault() /* keep the selection alive */}
    >
      {roles.map((role) => (
        <button key={role} style={{ ['--role-color' as string]: settings.roleColors[role] }} onClick={() => capture(role)}>
          {ROLE_LABELS[role]}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Capture panel: top-right corner, shown only while capturing        */
/* ------------------------------------------------------------------ */

function CapturePanel({ session, settings }: { session: CaptureSessionState; settings: DisplaySettings }) {
  const [open, setOpen] = useState(false);
  const prevCount = useRef(0);
  const [wizard, setWizard] = useState<null | 'category' | 'model'>(null);

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
            PromptTrace
          </span>
          <span className="pt-links">
            <a onClick={() => window.open(chrome.runtime.getURL('library.html'))}>Library</a>
            <a onClick={() => window.open(chrome.runtime.getURL('settings.html'))}>Settings</a>
          </span>
        </div>
        <div className="pt-panel-body">
          <CaptureBody session={session} settings={settings} wizard={wizard} setWizard={setWizard} />
        </div>
        {count > 0 && !wizard && (
          <div className="pt-footer">
            <button
              className="pt-commit"
              disabled={!canCommit(session)}
              title={canCommit(session) ? '' : '所有項目都需要先指定角色'}
              onClick={() => setWizard('category')}
            >
              ✓ 保存（{count}）
            </button>
            <button className="pt-cancel" onClick={() => send({ type: 'capture/clearSession', payload: {} })}>
              ✕ 取消
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Gallery panel: right-middle, pure hover (collapses on mouse-leave) */
/* ------------------------------------------------------------------ */

function GalleryPanel({
  settings,
  onZoom,
}: {
  settings: DisplaySettings;
  onZoom: (z: ZoomSrc | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<GalleryRecord | null>(null);
  const [refreshSignal, setRefreshSignal] = useState(0);
  // The tab sits where the user put it; the panel keeps its full height and only
  // shifts enough to stay on-screen while still covering the tab (so hover-open
  // holds). Tab high → panel pinned near the top (extends down); tab low → pinned
  // near the bottom (extends up). It never shrinks to a sliver.
  const PANEL_VH = 86;
  const edgeTop = Math.min(94, Math.max(6, settings.edgeTabTop ?? 50));
  const panelTopVh = Math.min(100 - PANEL_VH - 2, Math.max(2, edgeTop - PANEL_VH / 2));
  return (
    <div
      className="pt-gallery-edge"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => {
        // Stay open while editing (the editor flyout sits to the left). Otherwise
        // leaving the gallery closes it and dismisses the big preview.
        if (editing) return;
        setOpen(false);
        onZoom(null);
      }}
    >
      {open ? (
        // The dock's padding-right keeps the visual gap to the screen edge part of
        // the hover zone, so sliding into it doesn't drop hover and flicker shut.
        <div className="pt-panel-dock" style={{ top: `${panelTopVh}vh` }}>
          <div className="pt-glass pt-panel pt-gallery-panel" style={{ maxHeight: `${PANEL_VH}vh` }}>
            <div className="pt-panel-head">
              <span className="pt-title">
                <img className="pt-logo-img" src={LOGO_DATA_URL} alt="" />
                PromptTrace
              </span>
              <span className="pt-links">
                <a onClick={() => window.open(chrome.runtime.getURL('library.html'))}>Library</a>
                <a onClick={() => window.open(chrome.runtime.getURL('settings.html'))}>Settings</a>
              </span>
            </div>
            <div className="pt-panel-body">
              <Gallery
                settings={settings}
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
          style={{ position: 'absolute', right: 0, top: `${edgeTop}%`, transform: 'translateY(-50%)' }}
        >
          <img className="pt-tab-img" src={LOGO_DATA_URL} alt="PromptTrace" />
        </div>
      )}
      {editing && (
        <CardEditor
          record={editing}
          topVh={panelTopVh}
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
}: {
  session: CaptureSessionState;
  settings: DisplaySettings;
  wizard: null | 'category' | 'model';
  setWizard: (w: null | 'category' | 'model') => void;
}) {
  const grouped = useMemo(() => {
    const order: (AssetRole | null)[] = [null, 'input', 'input_reference', 'negative', 'output'];
    return order
      .map((role) => ({
        role,
        label: role ? ROLE_LABELS[role] : 'Pending',
        items: session.assets.filter((a) => a.role === role),
      }))
      .filter((g) => g.items.length > 0);
  }, [session.assets]);

  if (wizard) {
    return (
      <Wizard
        stage={wizard}
        setStage={setWizard}
        sourceUrl={session.assets[0]?.pageUrl}
        outputTypes={session.assets.filter((a) => a.role === 'output').map((a) => a.assetType)}
      />
    );
  }

  return (
    <>
      {session.conflicts.map((c) => (
        <div className="pt-card pt-conflict" key={c.id}>
          <strong>⚠ {c.conflictType}</strong>
          <div className="pt-muted">{c.suggestion}</div>
          {c.existingPreview && <div className="pt-preview">原：{c.existingPreview}</div>}
          {c.newPreview && <div className="pt-preview">新：{c.newPreview}</div>}
          <div className="pt-row">
            {c.conflictType === 'OVERLAPPING_SELECTION' && (
              <button
                className="pt-small-btn"
                onClick={() => send({ type: 'capture/resolveConflict', payload: { conflictId: c.id, resolution: 'replace' } })}
              >
                用新範圍取代
              </button>
            )}
            <button
              className="pt-small-btn"
              onClick={() => send({ type: 'capture/resolveConflict', payload: { conflictId: c.id, resolution: 'cancel' } })}
            >
              {c.conflictType === 'OVERLAPPING_SELECTION' ? '取消新選取' : '知道了'}
            </button>
          </div>
        </div>
      ))}

      {session.errors.map((e) => (
        <div className="pt-card pt-error" key={e.id}>
          <strong>⛔ {e.errorType}</strong>
          <div>{e.message}</div>
          <div className="pt-muted">{e.probableCause}</div>
          <div className="pt-muted">建議：{e.suggestedAction}</div>
          <div className="pt-row" style={{ marginTop: 6 }}>
            {e.canRetry && e.assetId && (
              <button className="pt-small-btn" onClick={() => send({ type: 'capture/dismissError', payload: { errorId: e.id, action: 'retry' } })}>
                重試
              </button>
            )}
            {e.canSaveSourceOnly && (
              <button className="pt-small-btn" onClick={() => send({ type: 'capture/dismissError', payload: { errorId: e.id, action: 'save_source_only' } })}>
                只保存來源
              </button>
            )}
            <button className="pt-small-btn" onClick={() => send({ type: 'capture/dismissError', payload: { errorId: e.id, action: 'cancel' } })}>
              關閉
            </button>
          </div>
        </div>
      ))}

      {session.assets.length === 0 &&
        session.conflicts.length === 0 &&
        session.errors.length === 0 &&
        session.lastCommittedRecordId && (
          <div className="pt-card">
            ✅ 已保存。{' '}
            <a
              style={{ color: '#8ad7e8', cursor: 'pointer' }}
              onClick={() => window.open(chrome.runtime.getURL(`library.html#record=${session.lastCommittedRecordId}`))}
            >
              在 Library 查看
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
            <PanelAssetCard key={a.id} asset={a} settings={settings} />
          ))}
        </div>
      ))}

    </>
  );
}

function PanelAssetCard({ asset, settings }: { asset: PendingAsset; settings: DisplaySettings }) {
  const allowed = allowedRolesFor(asset.assetType);
  return (
    <div className="pt-card">
      <div className="pt-spread">
        <strong style={{ fontSize: 11.5, textTransform: 'uppercase', opacity: 0.7 }}>{asset.assetType}</strong>
        <button className="pt-small-btn" onClick={() => send({ type: 'capture/removeAsset', payload: { pendingAssetId: asset.id } })}>
          移除
        </button>
      </div>
      {asset.assetType === 'text' ? (
        <div className="pt-preview">{asset.textContent}</div>
      ) : asset.assetType === 'image' ? (
        <img className="pt-thumb" src={asset.originalUrl} alt="" />
      ) : (
        <div className="pt-preview">🎞 {asset.originalUrl ?? '（無可下載 URL，僅保存來源）'}</div>
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
              {ROLE_LABELS[role]}
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

function Gallery({
  settings,
  onZoom,
  onEdit,
  refreshSignal,
}: {
  settings: DisplaySettings;
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

  if (records === null) return <div className="pt-empty">載入中…</div>;
  if (records.length === 0) {
    return (
      <div className="pt-empty">
        <img className="pt-logo" src={LOGO_DATA_URL} alt="" />
        還沒有保存任何 prompt。
        <br />
        反白文字 → <kbd>{settings.summonHotkey}</kbd> → 選角色保存。
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
          onZoom={onZoom}
          onEdit={onEdit}
          onChanged={refresh}
        />
      ))}
    </div>
  );
}

/** Full-screen image preview. Click anywhere or press Esc to dismiss. */
function Lightbox({ zoom, onClose }: { zoom: ZoomSrc; onClose: () => void }) {
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
      <button className="pt-lightbox-close" type="button" aria-label="關閉" onClick={onClose}>
        ✕
      </button>
    </div>
  );
}

function GalleryCard({
  record,
  settings,
  onZoom,
  onEdit,
  onChanged,
}: {
  record: GalleryRecord;
  settings: DisplaySettings;
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

  const remove = async () => {
    closeMenu();
    await send({ type: 'library/deleteRecord', payload: { recordId: record.id } });
    onChanged();
  };

  return (
    <div
      className="pt-gcard"
      onContextMenu={(e) => {
        e.preventDefault();
        const rect = e.currentTarget.getBoundingClientRect();
        setMenu({ x: e.clientX - rect.left, y: e.clientY - rect.top });
      }}
    >
      {(record.categoryName || record.modelLabel) && (
        <div className="pt-gmeta">
          {record.categoryName && <span className="pt-gtag">{record.categoryName}</span>}
          {record.modelLabel && <span className="pt-gtag pt-gtag--model">{record.modelLabel}</span>}
        </div>
      )}
      <div className="pt-gcols">
        {settings.cardLayout !== 'output-only' && (
          <div className="pt-gcol">
            <div className="pt-gcol-label">Input · Reference</div>
            {left.length === 0 ? (
              <div className="pt-gcol-empty">—</div>
            ) : (
              left.map((a, i) => (
                <GalleryAssetView key={i} asset={a} settings={settings} onZoom={onZoom} />
              ))
            )}
          </div>
        )}
        <div className="pt-gcol">
          <div className="pt-gcol-label">Output</div>
          {right.length === 0 ? (
            <div className="pt-gcol-empty">—</div>
          ) : (
            right.map((a, i) => (
              <GalleryAssetView key={i} asset={a} settings={settings} onZoom={onZoom} />
            ))
          )}
        </div>
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
                ✏️ 編輯標籤
              </button>
              <button
                className="pt-gmenu-item pt-gmenu-item--danger"
                onClick={() => setConfirmDel(true)}
              >
                🗑 刪除
              </button>
            </>
          ) : (
            <>
              <div className="pt-gmenu-confirm">刪除這筆？本機檔案也會移除。</div>
              <button className="pt-gmenu-item pt-gmenu-item--danger" onClick={remove}>
                確定刪除
              </button>
              <button className="pt-gmenu-item" onClick={() => setConfirmDel(false)}>
                取消
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** Re-tag a saved record's category + model. Flies out to the left of the panel
 *  so every option is visible without an internal scroll fight. */
function CardEditor({
  record,
  topVh,
  onClose,
  onSaved,
}: {
  record: GalleryRecord;
  topVh: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [categories, setCategories] = useState<RecordCategory[]>([]);
  const [presets, setPresets] = useState<ModelPreset[]>([]);
  const [categoryId, setCategoryId] = useState<string | null>(record.categoryId ?? null);
  const [presetId, setPresetId] = useState<string | null>(record.modelPresetId ?? null);
  // Don't touch the model unless the user picks one — otherwise editing the
  // category alone would wipe a custom / auto-detected model label.
  const [modelTouched, setModelTouched] = useState(false);

  useEffect(() => {
    send({ type: 'taxonomy/get', payload: {} }).then((r) => {
      const data = r as { categories: RecordCategory[]; presets: ModelPreset[] } | undefined;
      if (data) {
        setCategories(data.categories);
        setPresets(data.presets);
      }
    });
  }, []);

  const pickModel = (id: string | null) => {
    setPresetId(id);
    setModelTouched(true);
  };

  const save = async () => {
    const preset = presets.find((p) => p.id === presetId);
    await send({
      type: 'library/updateRecordMeta',
      payload: {
        recordId: record.id,
        categoryId,
        ...(modelTouched
          ? {
              modelPresetId: presetId,
              modelName: preset?.modelName,
              modelProvider: preset?.provider,
              modelVersion: preset?.modelVersion,
              modelLabel: preset?.modelName,
            }
          : {}),
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
      <div className="pt-geditor-title">編輯標籤</div>
      <div className="pt-geditor-label">分類</div>
      <div className="pt-choices">
        <button
          className={categoryId === null ? 'pt-choice pt-choice--on' : 'pt-choice'}
          onClick={() => setCategoryId(null)}
        >
          未分類
        </button>
        {categories
          .filter((c) => c.isActive)
          .map((c) => (
            <button
              key={c.id}
              className={categoryId === c.id ? 'pt-choice pt-choice--on' : 'pt-choice'}
              onClick={() => setCategoryId(c.id)}
            >
              {c.name}
            </button>
          ))}
      </div>
      <div className="pt-geditor-label">Model</div>
      <div className="pt-choices">
        <button
          className={modelTouched && presetId === null ? 'pt-choice pt-choice--on' : 'pt-choice'}
          onClick={() => pickModel(null)}
        >
          未指定
        </button>
        {presets
          .filter((p) => p.isActive)
          .map((p) => (
            <button
              key={p.id}
              className={
                modelTouched && presetId === p.id ? 'pt-choice pt-choice--on' : 'pt-choice'
              }
              onClick={() => pickModel(p.id)}
            >
              {p.modelName}
              {p.provider ? `（${p.provider}）` : ''}
            </button>
          ))}
      </div>
      <div className="pt-geditor-actions">
        <button className="pt-choice pt-choice--sub" onClick={onClose}>
          取消
        </button>
        <button className="pt-choice pt-choice--detected" onClick={save}>
          儲存
        </button>
      </div>
    </div>
  );
}

function GalleryAssetView({
  asset,
  settings,
  onZoom,
}: {
  asset: GalleryAsset;
  settings: DisplaySettings;
  onZoom: (z: ZoomSrc) => void;
}) {
  if (asset.assetType === 'text' && asset.textContent) {
    return <GalleryPrompt role={asset.role} text={asset.textContent} color={settings.roleColors[asset.role]} />;
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
        title="點擊放大"
        // Zoom prefers the full-res original; falls back to the durable thumbnail.
        onClick={() => onZoom({ primary: asset.originalUrl ?? asset.previewRef, fallback: asset.previewRef })}
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

function GalleryPrompt({ role, text, color }: { role: AssetRole; text: string; color: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard blocked on this page */
    }
  };
  return (
    <div className="pt-gprompt" onClick={copy} title="點擊複製">
      <div className="pt-gprompt-head">
        <span className="pt-pill" style={{ background: color }}>
          {ROLE_LABELS[role]}
        </span>
        <span className="pt-gcopy">{copied ? '已複製 ✓' : '複製'}</span>
      </div>
      <div className="pt-gtext">{text}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Two-step wizard inside the edge panel                              */
/* ------------------------------------------------------------------ */

/** Built-in category ids, keyed by asset type (mirrors storage/seed.ts). */
const BUILTIN_CATEGORY_BY_TYPE: Record<PendingAsset['assetType'], string> = {
  text: 'builtin-text-gen',
  image: 'builtin-image-gen',
  video: 'builtin-video-gen',
};

function Wizard({
  stage,
  setStage,
  sourceUrl,
  outputTypes,
}: {
  stage: 'category' | 'model';
  setStage: (w: null | 'category' | 'model') => void;
  sourceUrl?: string;
  outputTypes?: PendingAsset['assetType'][];
}) {
  const [categories, setCategories] = useState<RecordCategory[]>([]);
  const [presets, setPresets] = useState<ModelPreset[]>([]);

  // Suggest a category from the OUTPUT type (image→生圖, video→生影, text→生文).
  // Only when the outputs are a single type; mixed/none stays unsuggested.
  const suggestedCategoryId = useMemo(() => {
    const types = new Set(outputTypes ?? []);
    if (types.size !== 1) return null;
    return BUILTIN_CATEGORY_BY_TYPE[[...types][0]] ?? null;
  }, [outputTypes]);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [customOpen, setCustomOpen] = useState(false);
  const [customLabel, setCustomLabel] = useState('');

  const loadTaxonomy = useCallback(async () => {
    const r = (await send({ type: 'taxonomy/get', payload: {} })) as
      | { categories: RecordCategory[]; presets: ModelPreset[] }
      | undefined;
    if (r) {
      setCategories(r.categories.filter((c) => c.isActive));
      setPresets(r.presets.filter((p) => p.isActive));
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

  const commit = async (model: Record<string, unknown>) => {
    await send({ type: 'capture/commitSession', payload: { categoryId, ...model } });
    setStage(null);
  };

  // Provider guessed from the captured page, surfaced as a one-click option.
  const detected = useMemo(() => detectProvider(sourceUrl), [sourceUrl]);
  const detectedPreset = detected
    ? presets.find((p) => p.provider === detected.provider && p.modelName === detected.modelName)
    : undefined;

  // Pick a category → jump straight to the model step (no "next" button).
  const pickCategory = (id: string | null) => {
    setCategoryId(id);
    setStage('model');
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

  if (stage === 'category') {
    return (
      <div className="pt-card pt-wizard">
        <strong>分類（選填）</strong>
        <div className="pt-choices">
          <button className="pt-choice" onClick={() => pickCategory(null)}>
            未分類
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
                {c.name}
                {suggested ? ' · 依產出建議' : ''}
              </button>
            );
          })}
        </div>
        <div className="pt-row" style={{ marginTop: 8 }}>
          <input
            type="text"
            placeholder="快速新增分類…"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') quickAdd();
            }}
            style={{ flex: 1, width: 'auto' }}
          />
          <button className="pt-small-btn" disabled={!newName.trim()} onClick={quickAdd}>
            新增
          </button>
        </div>
        <div className="pt-wizard-foot">
          <button className="pt-link-btn" onClick={() => setStage(null)}>
            ← 返回
          </button>
          <button className="pt-link-btn pt-wizard-x" onClick={() => setStage(null)} title="取消保存">
            ✕ 取消
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="pt-card pt-wizard">
      <strong>Model（選填）</strong>
      <div className="pt-choices">
        <button className="pt-choice" onClick={() => commit({})}>
          不填（直接保存）
        </button>
        {detected && (
          <button
            className="pt-choice pt-choice--detected"
            onClick={() =>
              detectedPreset
                ? commit({
                    modelPresetId: detectedPreset.id,
                    modelName: detectedPreset.modelName,
                    modelProvider: detectedPreset.provider,
                  })
                : commit({ modelName: detected.modelName, modelProvider: detected.provider })
            }
          >
            ✨ {detected.modelName}（{detected.provider}）· 偵測自頁面
          </button>
        )}
        {presets
          .filter((p) => p.id !== detectedPreset?.id)
          .map((p) => (
          <button
            key={p.id}
            className="pt-choice"
            onClick={() => commit({ modelPresetId: p.id, modelName: p.modelName, modelProvider: p.provider })}
          >
            {p.alias || p.modelName}
            {p.provider ? `（${p.provider}）` : ''}
          </button>
        ))}
        <button className="pt-choice pt-choice--sub" onClick={() => commit({ modelLabel: 'Unknown' })}>
          Unknown
        </button>
        <button className="pt-choice pt-choice--sub" onClick={() => commit({ modelLabel: 'Not applicable' })}>
          Not applicable
        </button>
        {!customOpen ? (
          <button className="pt-choice pt-choice--sub" onClick={() => setCustomOpen(true)}>
            自訂…
          </button>
        ) : (
          <div className="pt-row">
            <input
              type="text"
              placeholder="自訂 model 名稱"
              value={customLabel}
              autoFocus
              onChange={(e) => setCustomLabel(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && customLabel.trim()) commit({ modelLabel: customLabel.trim() });
              }}
              style={{ flex: 1, width: 'auto' }}
            />
            <button className="pt-small-btn" disabled={!customLabel.trim()} onClick={() => commit({ modelLabel: customLabel.trim() })}>
              保存
            </button>
          </div>
        )}
      </div>
      <div className="pt-wizard-foot">
        <button className="pt-link-btn" onClick={() => setStage('category')}>
          ← 上一步
        </button>
        <button className="pt-link-btn pt-wizard-x" onClick={() => setStage(null)} title="取消保存">
          ✕ 取消
        </button>
      </div>
    </div>
  );
}
