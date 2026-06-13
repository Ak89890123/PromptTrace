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

const send = (message: unknown) => chrome.runtime.sendMessage(message).catch(() => undefined);

export default function PanelApp({ overlay }: { overlay: OverlayManager }) {
  const [settings, setSettings] = useState<DisplaySettings>(DEFAULT_SETTINGS);
  const [session, setSession] = useState<CaptureSessionState>(emptySession());

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
      {settings.edgePanelEnabled && <EdgePanel session={session} settings={settings} />}
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
    const media = hoveredMedia.current;
    if (media && media.isConnected) {
      const assetType = media.tagName === 'IMG' ? ('image' as const) : ('video' as const);
      targetRef.current = { kind: 'media', el: media, assetType };
      setTargetType(assetType);
      showAt(media.getBoundingClientRect());
      return;
    }
    hide();
  }, [showAt, hide]);

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
      const el = e.target as Element | null;
      if (el && (el.tagName === 'IMG' || el.tagName === 'VIDEO')) {
        hoveredMedia.current = el as HTMLImageElement | HTMLVideoElement;
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
      if (matchHotkey(e, settings.summonHotkey)) {
        e.preventDefault();
        e.stopPropagation();
        summon();
      }
    };
    const onScroll = () => hide();
    window.addEventListener('prompttrace:summon', onSummon);
    document.addEventListener('mouseover', onMouseOver, true);
    document.addEventListener('mouseup', onMouseUp);
    document.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('prompttrace:summon', onSummon);
      document.removeEventListener('mouseover', onMouseOver, true);
      document.removeEventListener('mouseup', onMouseUp);
      document.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('scroll', onScroll);
    };
  }, [settings, summon, hide]);

  if (!pos) return null;
  // Only roles valid for this target type ever appear (e.g. media → no Negative).
  const roles = settings.toolbarRoles.filter((r) => allowedRolesFor(targetType).includes(r));

  return (
    <div
      className="pt-glass pt-toolbar"
      style={{ left: pos.x, top: Math.max(pos.y - 46, 8), transform: 'translateX(-50%)' }}
      onMouseDown={(e) => e.preventDefault() /* keep the selection alive */}
    >
      {targetType !== 'text' && <span className="pt-target-tag">{targetType === 'image' ? '🖼' : '🎞'}</span>}
      {roles.map((role) => (
        <button key={role} style={{ ['--role-color' as string]: settings.roleColors[role] }} onClick={() => capture(role)}>
          {ROLE_LABELS[role]}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Edge panel: hover the right edge → glass panel slides out          */
/* ------------------------------------------------------------------ */

function EdgePanel({ session, settings }: { session: CaptureSessionState; settings: DisplaySettings }) {
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const closeTimer = useRef<number | null>(null);
  const prevCount = useRef(0);
  const [wizard, setWizard] = useState<null | 'category' | 'model'>(null);

  // Auto-peek when a new asset lands in the session.
  useEffect(() => {
    if (session.assets.length > prevCount.current || session.conflicts.length > 0 || session.errors.length > 0) {
      setOpen(true);
    }
    prevCount.current = session.assets.length;
  }, [session.assets.length, session.conflicts.length, session.errors.length]);

  const enter = () => {
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    setOpen(true);
  };
  const leave = () => {
    if (pinned || wizard) return;
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setOpen(false), 350);
  };

  const count = session.assets.length;

  return (
    <div className="pt-edge" onMouseEnter={enter} onMouseLeave={leave}>
      {/* Invisible full-height strip: hovering anywhere on the right edge expands the panel. */}
      {!open && <div className="pt-edge-hoverzone" onMouseEnter={enter} />}
      {open ? (
        <div className="pt-glass pt-panel">
          <div className="pt-panel-head">
            <span>✦ PromptTrace</span>
            <span className="pt-links">
              <a onClick={() => setPinned((p) => !p)} title={pinned ? '取消固定' : '固定面板'}>
                {pinned ? '📌' : '📍'}
              </a>
              <a onClick={() => window.open(chrome.runtime.getURL('library.html'))}>Library</a>
              <a onClick={() => window.open(chrome.runtime.getURL('settings.html'))}>Settings</a>
            </span>
          </div>
          <div className="pt-panel-body">
            <PanelBody
              session={session}
              settings={settings}
              wizard={wizard}
              setWizard={setWizard}
            />
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
      ) : (
        <div className="pt-glass pt-edge-tab" onClick={enter}>
          <span>✦</span>
          {count > 0 && <span className="pt-badge">{count}</span>}
        </div>
      )}
    </div>
  );
}

function PanelBody({
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
    return <Wizard stage={wizard} setStage={setWizard} />;
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

      {session.assets.length === 0 && session.conflicts.length === 0 && session.errors.length === 0 && (
        <div className="pt-empty">
          <span className="pt-logo">✦</span>
          反白文字（或游標移到圖片 / 影片上）
          <br />
          按 <kbd>{settings.summonHotkey}</kbd> 叫出角色選項。
          <br />
          <span className="pt-muted">也可用右鍵選單加入；快捷鍵可在 Settings 或 chrome://extensions/shortcuts 修改。</span>
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

      {session.lastCommittedRecordId && session.assets.length === 0 && (
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
/*  Two-step wizard inside the edge panel                              */
/* ------------------------------------------------------------------ */

function Wizard({ stage, setStage }: { stage: 'category' | 'model'; setStage: (w: null | 'category' | 'model') => void }) {
  const [categories, setCategories] = useState<RecordCategory[]>([]);
  const [presets, setPresets] = useState<ModelPreset[]>([]);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [choice, setChoice] = useState('');
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

  if (stage === 'category') {
    return (
      <div className="pt-card" style={{ borderColor: 'rgba(34,211,238,0.5)' }}>
        <strong>Step 1 / 2 · 分類（選填）</strong>
        <div style={{ marginTop: 8 }}>
          <select value={categoryId ?? ''} onChange={(e) => setCategoryId(e.target.value || null)}>
            <option value="">未分類</option>
            {tree.map(({ c, depth }) => (
              <option key={c.id} value={c.id}>
                {'　'.repeat(depth)}
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="pt-row" style={{ marginTop: 6 }}>
          <input
            type="text"
            placeholder="快速新增分類…"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            style={{ flex: 1, width: 'auto' }}
          />
          <button
            className="pt-small-btn"
            disabled={!newName.trim()}
            onClick={async () => {
              const r = (await send({ type: 'taxonomy/quickAddCategory', payload: { name: newName.trim() } })) as
                | { category: RecordCategory }
                | undefined;
              if (r?.category) {
                setNewName('');
                await loadTaxonomy();
                setCategoryId(r.category.id);
              }
            }}
          >
            新增
          </button>
        </div>
        <div className="pt-row" style={{ marginTop: 10 }}>
          <button className="pt-small-btn" style={{ background: '#22d3ee', color: '#08222a', fontWeight: 700 }} onClick={() => setStage('model')}>
            下一步
          </button>
          <button className="pt-small-btn" onClick={() => setStage(null)}>
            返回
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="pt-card" style={{ borderColor: 'rgba(34,211,238,0.5)' }}>
      <strong>Step 2 / 2 · Model（選填）</strong>
      <div style={{ marginTop: 8 }}>
        <select value={choice} onChange={(e) => setChoice(e.target.value)}>
          <option value="">不填</option>
          <option value="__unknown">Unknown</option>
          <option value="__na">Not applicable</option>
          <option value="__custom">Custom…</option>
          {presets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.alias || p.modelName}
              {p.provider ? `（${p.provider}）` : ''}
            </option>
          ))}
        </select>
      </div>
      {choice === '__custom' && (
        <input
          type="text"
          style={{ marginTop: 6 }}
          placeholder="自訂 model 名稱"
          value={customLabel}
          onChange={(e) => setCustomLabel(e.target.value)}
        />
      )}
      <div className="pt-row" style={{ marginTop: 10 }}>
        <button
          className="pt-small-btn"
          style={{ background: 'linear-gradient(135deg,#34d399,#22d3ee)', color: '#06231f', fontWeight: 700 }}
          onClick={() => {
            if (choice === '__unknown') commit({ modelLabel: 'Unknown' });
            else if (choice === '__na') commit({ modelLabel: 'Not applicable' });
            else if (choice === '__custom') commit({ modelLabel: customLabel.trim() || 'Custom' });
            else if (choice === '') commit({});
            else {
              const p = presets.find((x) => x.id === choice);
              commit({ modelPresetId: choice, modelName: p?.modelName, modelProvider: p?.provider });
            }
          }}
        >
          ✓ 保存到 Library
        </button>
        <button className="pt-small-btn" onClick={() => setStage('category')}>
          上一步
        </button>
      </div>
    </div>
  );
}
