import { useEffect, useMemo, useState } from 'react';
import type { CaptureSessionState } from '@/src/core/capture/session';
import { canCommit, emptySession } from '@/src/core/capture/session';
import type { PendingAsset } from '@/src/core/domain/entities';
import { ASSET_TYPE_LABELS, ROLE_LABELS, type AssetRole } from '@/src/core/domain/enums';
import { allowedRolesFor, ROLE_NOT_ALLOWED_MESSAGE } from '@/src/core/domain/validation';
import { sendMessage } from '@/src/core/messages';
import { DEFAULT_ROLE_COLORS } from '@/src/ui/roleColors';
import { flattenTree, useTaxonomy } from '@/src/ui/hooks';
import { categoryRepository } from '@/src/storage/repositories';

const SECTIONS: { role: AssetRole | null; label: string }[] = [
  { role: null, label: 'Pending' },
  { role: 'input', label: 'Input' },
  { role: 'input_reference', label: 'Input Reference' },
  { role: 'negative', label: 'Negative' },
  { role: 'output', label: 'Output' },
];

export default function App() {
  const [session, setSession] = useState<CaptureSessionState>(emptySession());
  const [wizard, setWizard] = useState<null | 'category' | 'model'>(null);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const { categories, presets } = useTaxonomy(refreshKey);

  useEffect(() => {
    sendMessage<{ state: CaptureSessionState }>({ type: 'capture/getSession', payload: {} })
      .then((r) => r?.state && setSession(r.state))
      .catch(() => {});
    const listener = (message: { type?: string; payload?: { state?: CaptureSessionState } }) => {
      if (message?.type === 'capture/sessionUpdated' && message.payload?.state) {
        setSession(message.payload.state);
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  const grouped = useMemo(() => {
    const map = new Map<AssetRole | null, PendingAsset[]>();
    for (const { role } of SECTIONS) map.set(role, []);
    for (const a of session.assets) map.get(a.role)?.push(a);
    return map;
  }, [session.assets]);

  const commit = async (model: {
    modelPresetId?: string | null;
    modelProvider?: string;
    modelName?: string;
    modelVersion?: string;
    modelLabel?: string;
  }) => {
    await sendMessage({
      type: 'capture/commitSession',
      payload: { categoryId, ...model },
    });
    setWizard(null);
    setCategoryId(null);
  };

  return (
    <div style={{ padding: 12 }}>
      <div className="spread">
        <h1>PromptTrace</h1>
        <div className="row">
          <a href={chrome.runtime.getURL('library.html')} target="_blank" rel="noreferrer">
            Library
          </a>
          <a href={chrome.runtime.getURL('settings.html')} target="_blank" rel="noreferrer">
            Settings
          </a>
        </div>
      </div>

      {session.lastCommittedRecordId && session.assets.length === 0 && (
        <div className="card">
          ✅ 已保存。{' '}
          <a
            href={chrome.runtime.getURL(`library.html#record=${session.lastCommittedRecordId}`)}
            target="_blank"
            rel="noreferrer"
          >
            在 Library 中查看
          </a>
        </div>
      )}

      {session.conflicts.map((c) => (
        <div className="card conflict" key={c.id}>
          <strong>⚠ Conflict：{c.conflictType}</strong>
          <div className="muted">{c.suggestion}</div>
          {c.existingPreview && (
            <div className="preview-text">原選取：{c.existingPreview}</div>
          )}
          {c.newPreview && <div className="preview-text">新選取：{c.newPreview}</div>}
          <div className="row">
            {c.conflictType === 'OVERLAPPING_SELECTION' && (
              <button
                className="primary"
                onClick={() =>
                  sendMessage({
                    type: 'capture/resolveConflict',
                    payload: { conflictId: c.id, resolution: 'replace' },
                  })
                }
              >
                用新範圍取代
              </button>
            )}
            <button
              onClick={() =>
                sendMessage({
                  type: 'capture/resolveConflict',
                  payload: { conflictId: c.id, resolution: 'cancel' },
                })
              }
            >
              {c.conflictType === 'OVERLAPPING_SELECTION' ? '取消新選取' : '知道了'}
            </button>
          </div>
        </div>
      ))}

      {session.errors.map((e) => (
        <div className="card error" key={e.id}>
          <strong>⛔ {e.errorType}</strong>
          <div className="muted">位置：{e.location}</div>
          {e.sourceUrl && (
            <div className="muted" style={{ wordBreak: 'break-all' }}>
              來源：{e.sourceUrl}
            </div>
          )}
          <div>{e.message}</div>
          <div className="muted">可能原因：{e.probableCause}</div>
          <div className="muted">建議：{e.suggestedAction}</div>
          <div className="row" style={{ marginTop: 6 }}>
            {e.canRetry && e.assetId && (
              <button
                onClick={() =>
                  sendMessage({
                    type: 'capture/dismissError',
                    payload: { errorId: e.id, action: 'retry' },
                  })
                }
              >
                重試
              </button>
            )}
            {e.canSaveSourceOnly && (
              <button
                onClick={() =>
                  sendMessage({
                    type: 'capture/dismissError',
                    payload: { errorId: e.id, action: 'save_source_only' },
                  })
                }
              >
                只保存來源
              </button>
            )}
            <button
              onClick={() =>
                sendMessage({
                  type: 'capture/dismissError',
                  payload: { errorId: e.id, action: 'cancel' },
                })
              }
            >
              關閉
            </button>
          </div>
        </div>
      ))}

      {session.assets.length === 0 && session.conflicts.length === 0 ? (
        <div className="card">
          <p>在任何網頁上：</p>
          <ol style={{ paddingLeft: 18, margin: '4px 0' }}>
            <li>反白文字 → 右鍵 → 「PromptTrace：加入選取文字」</li>
            <li>圖片 / 影片 → 右鍵 → 「PromptTrace：加入圖片 / 影片」</li>
          </ol>
          <p className="muted">加入後在這裡標記 Input / Input Reference / Negative / Output。</p>
        </div>
      ) : (
        SECTIONS.map(({ role, label }) => {
          const items = grouped.get(role) ?? [];
          if (items.length === 0) return null;
          return (
            <div className="section" key={label}>
              <h2>
                <span
                  className="pill"
                  style={{ background: role ? DEFAULT_ROLE_COLORS[role] : DEFAULT_ROLE_COLORS.pending }}
                >
                  {label}
                </span>{' '}
                <span className="muted">{items.length}</span>
              </h2>
              {items.map((a) => (
                <AssetItem key={a.id} asset={a} />
              ))}
            </div>
          );
        })
      )}

      {session.assets.length > 0 && !wizard && (
        <div className="toolbar" style={{ position: 'sticky', bottom: 0 }}>
          <button
            className="primary"
            disabled={!canCommit(session)}
            title={canCommit(session) ? '' : '所有項目都需要先指定角色'}
            onClick={() => setWizard('category')}
          >
            ✓ 保存（{session.assets.length}）
          </button>
          <button
            className="danger"
            onClick={() => sendMessage({ type: 'capture/clearSession', payload: {} })}
          >
            ✕ 取消 session
          </button>
        </div>
      )}

      {wizard === 'category' && (
        <CategoryStep
          categories={flattenTree(categories, { activeOnly: true })}
          value={categoryId}
          onChange={setCategoryId}
          onQuickAdd={async (name) => {
            const now = new Date().toISOString();
            await categoryRepository.save({
              id: crypto.randomUUID(),
              parentId: null,
              name,
              isBuiltin: false,
              isActive: true,
              sortOrder: 999,
              createdAt: now,
              updatedAt: now,
            });
            setRefreshKey((k) => k + 1);
          }}
          onNext={() => setWizard('model')}
          onCancel={() => setWizard(null)}
        />
      )}

      {wizard === 'model' && (
        <ModelStep
          presets={presets.filter((p) => p.isActive)}
          onBack={() => setWizard('category')}
          onCommit={commit}
        />
      )}
    </div>
  );
}

function AssetItem({ asset }: { asset: PendingAsset }) {
  const allowed = allowedRolesFor(asset.assetType);
  return (
    <div className="card">
      <div className="spread">
        <strong>{ASSET_TYPE_LABELS[asset.assetType]}</strong>
        <button
          className="danger"
          onClick={() =>
            sendMessage({ type: 'capture/removeAsset', payload: { pendingAssetId: asset.id } })
          }
        >
          移除
        </button>
      </div>
      {asset.assetType === 'text' ? (
        <div className="preview-text">{asset.textContent}</div>
      ) : asset.assetType === 'image' ? (
        <img className="thumb" src={asset.originalUrl} alt="captured" />
      ) : (
        <div className="preview-text" style={{ wordBreak: 'break-all' }}>
          🎞 {asset.originalUrl ?? '(無可下載 URL，僅保存來源)'}
        </div>
      )}
      <div className="muted" style={{ wordBreak: 'break-all' }}>
        {asset.pageTitle || asset.pageUrl}
      </div>
      <div className="row" style={{ marginTop: 6 }}>
        {(['input', 'input_reference', 'negative', 'output'] as AssetRole[]).map((role) => {
          const isAllowed = allowed.includes(role);
          return (
            <button
              key={role}
              disabled={!isAllowed}
              title={isAllowed ? '' : ROLE_NOT_ALLOWED_MESSAGE}
              style={
                asset.role === role
                  ? { background: DEFAULT_ROLE_COLORS[role], color: '#0b1220', fontWeight: 600 }
                  : undefined
              }
              onClick={() =>
                sendMessage({
                  type: 'capture/assignAssetRole',
                  payload: { pendingAssetId: asset.id, role },
                })
              }
            >
              {ROLE_LABELS[role]}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function CategoryStep(props: {
  categories: { category: { id: string; name: string }; depth: number }[];
  value: string | null;
  onChange: (id: string | null) => void;
  onQuickAdd: (name: string) => Promise<void>;
  onNext: () => void;
  onCancel: () => void;
}) {
  const [newName, setNewName] = useState('');
  return (
    <div className="card" style={{ borderColor: 'var(--accent)' }}>
      <h3>Step 1 / 2：選擇分類（選填）</h3>
      <select value={props.value ?? ''} onChange={(e) => props.onChange(e.target.value || null)}>
        <option value="">未分類</option>
        {props.categories.map(({ category, depth }) => (
          <option key={category.id} value={category.id}>
            {'  '.repeat(depth)}
            {category.name}
          </option>
        ))}
      </select>
      <div className="row" style={{ marginTop: 6 }}>
        <input
          placeholder="快速新增分類…"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          style={{ flex: 1, width: 'auto' }}
        />
        <button
          disabled={!newName.trim()}
          onClick={async () => {
            await props.onQuickAdd(newName.trim());
            setNewName('');
          }}
        >
          新增
        </button>
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <button className="primary" onClick={props.onNext}>
          下一步
        </button>
        <button onClick={props.onCancel}>返回</button>
      </div>
    </div>
  );
}

function ModelStep(props: {
  presets: { id: string; modelName: string; provider?: string; alias?: string }[];
  onBack: () => void;
  onCommit: (model: {
    modelPresetId?: string | null;
    modelProvider?: string;
    modelName?: string;
    modelLabel?: string;
  }) => void;
}) {
  const [choice, setChoice] = useState<string>('');
  const [customLabel, setCustomLabel] = useState('');
  return (
    <div className="card" style={{ borderColor: 'var(--accent)' }}>
      <h3>Step 2 / 2：選擇 Model（選填）</h3>
      <select value={choice} onChange={(e) => setChoice(e.target.value)}>
        <option value="">不填</option>
        <option value="__unknown">Unknown</option>
        <option value="__na">Not applicable</option>
        <option value="__custom">Custom…</option>
        {props.presets.map((p) => (
          <option key={p.id} value={p.id}>
            {p.alias || p.modelName}
            {p.provider ? `（${p.provider}）` : ''}
          </option>
        ))}
      </select>
      {choice === '__custom' && (
        <input
          style={{ marginTop: 6 }}
          placeholder="自訂 model 名稱"
          value={customLabel}
          onChange={(e) => setCustomLabel(e.target.value)}
        />
      )}
      <div className="row" style={{ marginTop: 8 }}>
        <button
          className="primary"
          onClick={() => {
            if (choice === '__unknown') props.onCommit({ modelLabel: 'Unknown' });
            else if (choice === '__na') props.onCommit({ modelLabel: 'Not applicable' });
            else if (choice === '__custom')
              props.onCommit({ modelLabel: customLabel.trim() || 'Custom' });
            else if (choice === '') props.onCommit({});
            else {
              const p = props.presets.find((x) => x.id === choice);
              props.onCommit({
                modelPresetId: choice,
                modelName: p?.modelName,
                modelProvider: p?.provider,
              });
            }
          }}
        >
          ✓ 保存到 Library
        </button>
        <button onClick={props.onBack}>上一步</button>
      </div>
    </div>
  );
}
