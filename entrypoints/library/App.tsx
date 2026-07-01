import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Asset, FileRecord, LibraryRecord, Tag } from '@/src/core/domain/entities';
import { ASSET_TYPE_LABELS, ROLE_LABELS, type AssetRole, type AssetType } from '@/src/core/domain/enums';
import { allowedRolesFor, categoryPath, ROLE_NOT_ALLOWED_MESSAGE } from '@/src/core/domain/validation';
import {
  composeFullRecord,
  composeInputBundle,
  composeOutputBundle,
  type CopyBundle,
} from '@/src/core/copy-bundle/compose';
import { exportMarkdown, modelLabelOf, type ExportContext } from '@/src/core/export/markdown';
import { exportJsonString } from '@/src/core/export/json';
import {
  assetRepository,
  deleteRecordCascade,
  exportRecordRepository,
  fileRecordRepository,
  recordRepository,
  tagRepository,
} from '@/src/storage/repositories';
import { DEFAULT_ROLE_COLORS, DEFAULT_SETTINGS, loadSettings, onSettingsChanged } from '@/src/ui/roleColors';
import { flattenTree, useTaxonomy } from '@/src/ui/hooks';

type RecordBundle = {
  record: LibraryRecord;
  assets: Asset[];
  fileRecords: FileRecord[];
  tags: Tag[];
};

async function loadBundle(record: LibraryRecord): Promise<RecordBundle> {
  const assets = await assetRepository.byRecord(record.id);
  const fileRecords: FileRecord[] = [];
  for (const a of assets) fileRecords.push(...(await fileRecordRepository.byAsset(a.id)));
  const tags = await tagRepository.byRecord(record.id);
  return { record, assets, fileRecords, tags };
}

function downloadText(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function App() {
  const [records, setRecords] = useState<LibraryRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(
    () => new URLSearchParams(location.hash.slice(1)).get('record'),
  );
  const [search, setSearch] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterModel, setFilterModel] = useState('');
  const [filterRole, setFilterRole] = useState('');
  const [assetIndex, setAssetIndex] = useState<Map<string, Asset[]>>(new Map());
  const { categories, presets } = useTaxonomy();
  const [refresh, setRefresh] = useState(0);
  const reload = () => setRefresh((x) => x + 1);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  useEffect(() => {
    loadSettings().then(setSettings);
    onSettingsChanged(setSettings);
  }, []);

  useEffect(() => {
    (async () => {
      const all = await recordRepository.list();
      all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      setRecords(all);
      const idx = new Map<string, Asset[]>();
      for (const a of await assetRepository.list()) {
        if (!idx.has(a.recordId)) idx.set(a.recordId, []);
        idx.get(a.recordId)!.push(a);
      }
      setAssetIndex(idx);
    })();
  }, [refresh]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return records.filter((r) => {
      if (filterCategory && r.categoryId !== filterCategory) return false;
      if (filterModel && r.modelPresetId !== filterModel) return false;
      const assets = assetIndex.get(r.id) ?? [];
      if (filterRole && !assets.some((a) => a.role === filterRole)) return false;
      if (q) {
        const haystack = [
          r.title,
          r.notes,
          r.sourcePageTitle,
          r.sourcePageUrl,
          r.modelLabel,
          r.modelName,
          ...assets.map((a) => a.textContent ?? ''),
          ...assets.map((a) => a.originalUrl ?? ''),
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [records, assetIndex, search, filterCategory, filterModel, filterRole]);

  return (
    <div className="library-shell">
      <aside className="library-filter-rail">
        <div className="library-brand">
          <h1>Library</h1>
          <span className="library-count">{filtered.length} / {records.length}</span>
        </div>
        <label className="filter-field">
          <span>搜尋</span>
          <input placeholder="Prompt、來源、URL…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
        <label className="filter-field">
          <span>分類</span>
          <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)}>
            <option value="">全部分類</option>
            {flattenTree(categories).map(({ category, depth }) => (
              <option key={category.id} value={category.id}>
                {'  '.repeat(depth)}{category.name}
              </option>
            ))}
          </select>
        </label>
        <label className="filter-field">
          <span>Model</span>
          <select value={filterModel} onChange={(e) => setFilterModel(e.target.value)}>
            <option value="">全部 Model</option>
            {presets.map((p) => (
              <option key={p.id} value={p.id}>{p.alias || p.modelName}</option>
            ))}
          </select>
        </label>
        <label className="filter-field">
          <span>角色</span>
          <select value={filterRole} onChange={(e) => setFilterRole(e.target.value)}>
            <option value="">全部角色</option>
            {(Object.keys(ROLE_LABELS) as AssetRole[]).map((r) => (
              <option key={r} value={r}>{ROLE_LABELS[r]}</option>
            ))}
          </select>
        </label>
        <button
          className="library-clear-filters"
          disabled={!search && !filterCategory && !filterModel && !filterRole}
          onClick={() => {
            setSearch('');
            setFilterCategory('');
            setFilterModel('');
            setFilterRole('');
          }}
        >
          重置篩選
        </button>
      </aside>

      <main className="library-main">
        <header className="library-hero">
          <div>
            <div className="eyebrow">PromptTrace</div>
            <h1>Library</h1>
            <p>本機保存的 Input、參考素材、Output 與檔案紀錄。點選卡片後在右側查看完整內容。</p>
          </div>
          <div className="library-hero-stats">
            <span>{records.length} records</span>
            <span>{Array.from(assetIndex.values()).reduce((sum, items) => sum + items.length, 0)} assets</span>
          </div>
        </header>

        {filtered.length === 0 ? (
          <div className="library-empty">
            {records.length === 0 ? (
              <>
                <h2>尚無紀錄</h2>
                <p>在網頁上反白文字或選取圖片 / 影片後保存，這裡會出現可搜尋、可複製、可匯出的本機紀錄。</p>
              </>
            ) : (
              <>
                <h2>沒有符合的紀錄</h2>
                <p>調整左側篩選或搜尋條件，找回已保存的 prompt、輸入素材與輸出結果。</p>
              </>
            )}
          </div>
        ) : (
          <section className="library-card-grid" aria-label="Library records">
            {filtered.map((record) => (
              <RecordCard
                key={record.id}
                record={record}
                assets={assetIndex.get(record.id) ?? []}
                categories={categories}
                selected={record.id === selectedId}
                layout={settings.cardLayout}
                onOpen={() => setSelectedId(record.id)}
              />
            ))}
          </section>
        )}
      </main>

      <aside className="library-detail-rail">
        <div className={`library-detail-drawer ${selectedId ? 'is-open' : ''}`}>
          {selectedId ? (
            <RecordDetail
              key={`${selectedId}-${refresh}`}
              recordId={selectedId}
              categories={categories}
              presets={presets}
              onClose={() => setSelectedId(null)}
              onChanged={reload}
              onDeleted={() => {
                setSelectedId(null);
                reload();
              }}
            />
          ) : (
            <div className="library-detail-empty">
              <h2>選取一筆紀錄</h2>
              <p>點選中央卡片後，這裡會固定顯示完整文字、圖片、notes、tags 與檔案紀錄。</p>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

function RecordCard(props: {
  record: LibraryRecord;
  assets: Asset[];
  categories: ReturnType<typeof useTaxonomy>['categories'];
  selected: boolean;
  layout: 'split' | 'output-only';
  onOpen: () => void;
}) {
  const { record, assets, categories, selected, layout, onOpen } = props;
  const outputCount = assets.filter((a) => a.role === 'output').length;

  return (
    <button className={`record-card ${selected ? 'is-selected' : ''}`} onFocus={onOpen} onClick={onOpen}>
      <div className="record-card-topline">
        <span>{categoryPath(categories, record.categoryId) || '未分類'}</span>
        <span>{assets.length} assets</span>
      </div>
      <div className="record-card-summary-slot" aria-label="摘要保留區" />
      <CardPreview assets={assets} layout={layout} />
      <div className="record-card-footer">
        <span>{modelLabelOf(record)}</span>
        <span>{outputCount > 0 ? `${outputCount} output` : 'no output'}</span>
      </div>
    </button>
  );
}

function RecordDetail(props: {
  recordId: string;
  categories: ReturnType<typeof useTaxonomy>['categories'];
  presets: ReturnType<typeof useTaxonomy>['presets'];
  onClose: () => void;
  onChanged: () => void;
  onDeleted: () => void;
}) {
  const [bundle, setBundle] = useState<RecordBundle | null>(null);
  const [tray, setTray] = useState<CopyBundle | null>(null);
  const [toast, setToast] = useState('');
  const [newText, setNewText] = useState('');
  const [newTextRole, setNewTextRole] = useState<AssetRole>('input');
  const [tagInput, setTagInput] = useState('');
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    const record = await recordRepository.get(props.recordId);
    if (record) setBundle(await loadBundle(record));
  }, [props.recordId]);
  useEffect(() => {
    load();
  }, [load]);

  if (!bundle) return <div className="muted">載入中…</div>;
  const { record, assets, fileRecords, tags } = bundle;
  const catPath = categoryPath(props.categories, record.categoryId);

  const say = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 2500);
  };

  const copyBundle = async (b: CopyBundle, label: string) => {
    try {
      await navigator.clipboard.writeText(b.text);
      if (b.needsTrayFallback) {
        setTray(b);
        say(`${label} 文字已複製；媒體請從下方 Copy Tray 逐項處理。`);
      } else {
        say(`${label} 已複製。`);
      }
    } catch {
      setTray(b);
      say('剪貼簿寫入失敗（CLIPBOARD_WRITE_FAILED）；請從 Copy Tray 逐項複製。');
    }
  };

  const exportCtx = async (): Promise<ExportContext> => {
    const settings = await loadSettings();
    return {
      record,
      assets,
      fileRecords,
      tags,
      categoryPath: catPath,
      includeSource: settings.exportIncludeSource,
      includeFilePath: settings.exportIncludeFilePath,
    };
  };

  const updateRecord = async (patch: Partial<LibraryRecord>) => {
    await recordRepository.save({ ...record, ...patch, updatedAt: new Date().toISOString() });
    await load();
    props.onChanged();
  };

  const addTextAsset = async (text: string, role: AssetRole, type: AssetType = 'text', url?: string) => {
    await assetRepository.save({
      id: crypto.randomUUID(),
      recordId: record.id,
      assetType: type,
      role,
      textContent: type === 'text' ? text : undefined,
      originalUrl: url,
      previewRef: url,
      orderIndex: assets.length,
      capturedAt: new Date().toISOString(),
    });
    await load();
    props.onChanged();
  };

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    for (const file of Array.from(e.dataTransfer.files)) {
      const type: AssetType | null = file.type.startsWith('image/')
        ? 'image'
        : file.type.startsWith('video/')
          ? 'video'
          : null;
      if (!type) continue;
      // Store dropped/uploaded local media as a data URL preview (kept in IndexedDB).
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      await addTextAsset('', 'input', type, dataUrl);
    }
  };

  const roleSection = (role: AssetRole) => {
    const items = assets.filter((a) => a.role === role).sort((a, b) => a.orderIndex - b.orderIndex);
    return (
      <div className="section" key={role}>
        <h2>
          <span className="pill" style={{ background: DEFAULT_ROLE_COLORS[role] }}>
            {ROLE_LABELS[role]}
          </span>{' '}
          <span className="muted">{items.length}</span>
        </h2>
        {items.length === 0 && <div className="muted">None</div>}
        {items.map((a) => {
          const file = fileRecords.find((f) => f.assetId === a.id);
          return (
            <div className="card" key={a.id}>
              <div className="spread">
                <strong>{ASSET_TYPE_LABELS[a.assetType]}</strong>
                <div className="row">
                  <select
                    value={a.role}
                    style={{ width: 'auto' }}
                    onChange={async (e) => {
                      const next = e.target.value as AssetRole;
                      if (!allowedRolesFor(a.assetType).includes(next)) {
                        say(ROLE_NOT_ALLOWED_MESSAGE);
                        return;
                      }
                      await assetRepository.save({ ...a, role: next });
                      await load();
                    }}
                  >
                    {(Object.keys(ROLE_LABELS) as AssetRole[]).map((r) => (
                      <option key={r} value={r} disabled={!allowedRolesFor(a.assetType).includes(r)}>
                        {ROLE_LABELS[r]}
                      </option>
                    ))}
                  </select>
                  <button
                    className="danger"
                    onClick={async () => {
                      await assetRepository.delete(a.id);
                      if (file) await fileRecordRepository.delete(file.id);
                      await load();
                      props.onChanged();
                    }}
                  >
                    移除
                  </button>
                </div>
              </div>
              {a.assetType === 'text' ? (
                <div className="preview-text">{a.textContent}</div>
              ) : a.assetType === 'image' ? (
                <img className="thumb" src={a.previewRef ?? a.originalUrl} alt="asset" />
              ) : a.previewRef?.startsWith('data:') ? (
                <video className="thumb" src={a.previewRef} controls />
              ) : (
                <div className="preview-text">🎞 影片 file card</div>
              )}
              {a.originalUrl && !a.originalUrl.startsWith('data:') && (
                <div className="muted" style={{ wordBreak: 'break-all' }}>
                  來源：<a href={a.originalUrl} target="_blank" rel="noreferrer">{a.originalUrl}</a>
                </div>
              )}
              {file && (
                <div className="muted">
                  下載：{file.downloadStatus}
                  {file.localPath ? ` · ${file.localPath}` : ''}
                  {file.deleteStatus !== 'not_deleted' ? ` · 檔案狀態：${file.deleteStatus}` : ''}
                  {file.downloadStatus === 'failed' && (
                    <>
                      {' '}
                      <button
                        onClick={() =>
                          chrome.runtime
                            .sendMessage({ type: 'media/retryDownload', payload: { fileRecordId: file.id } })
                            .then(() => say('已重試下載。'))
                        }
                      >
                        重試下載
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      {toast && (
        <div className="card" style={{ borderColor: 'var(--ok)', position: 'sticky', top: 0, zIndex: 10 }}>
          {toast}
        </div>
      )}
      <div className="spread">
        <input
          style={{ fontSize: 16, fontWeight: 600, flex: 1 }}
          value={record.title ?? ''}
          placeholder="（未命名 record — 點此輸入標題）"
          onChange={(e) => setBundle({ ...bundle, record: { ...record, title: e.target.value } })}
          onBlur={(e) => updateRecord({ title: e.target.value })}
        />
        {!deleting ? (
          <button className="danger" onClick={() => setDeleting(true)}>刪除 Record</button>
        ) : (
          <div className="row">
            <button
              className="danger"
              onClick={async () => {
                await deleteRecordCascade(record.id);
                props.onDeleted();
              }}
            >
              只刪 Record（保留檔案）
            </button>
            <button
              className="danger"
              onClick={async () => {
                const res = await chrome.runtime
                  .sendMessage({ type: 'media/deleteRecordFiles', payload: { recordId: record.id } })
                  .catch(() => ({ ok: false }));
                await deleteRecordCascade(record.id);
                if (res && !res.ok) {
                  alert('部分本地檔案刪除失敗（FILE_DELETE_FAILED），請手動處理。Record 已刪除。');
                }
                props.onDeleted();
              }}
            >
              連同本地檔案刪除
            </button>
            <button onClick={() => setDeleting(false)}>取消</button>
          </div>
        )}
        <button onClick={props.onClose} aria-label="關閉詳情">關閉</button>
      </div>

      <div className="row" style={{ margin: '8px 0' }}>
        <label className="muted">分類</label>
        <select
          style={{ width: 'auto' }}
          value={record.categoryId ?? ''}
          onChange={(e) => updateRecord({ categoryId: e.target.value || null })}
        >
          <option value="">未分類</option>
          {flattenTree(props.categories).map(({ category, depth }) => (
            <option key={category.id} value={category.id}>
              {'  '.repeat(depth)}{category.name}
            </option>
          ))}
        </select>
        <label className="muted">Model</label>
        <select
          style={{ width: 'auto' }}
          value={record.modelPresetId ?? (record.modelLabel ? '__label' : '')}
          onChange={(e) => {
            const v = e.target.value;
            if (v === '') updateRecord({ modelPresetId: null, modelLabel: undefined, modelName: undefined, modelProvider: undefined });
            else if (v !== '__label') {
              const p = props.presets.find((x) => x.id === v);
              updateRecord({ modelPresetId: v, modelName: p?.modelName, modelProvider: p?.provider, modelLabel: undefined });
            }
          }}
        >
          <option value="">Not specified</option>
          {record.modelLabel && <option value="__label">{record.modelLabel}</option>}
          {props.presets.map((p) => (
            <option key={p.id} value={p.id}>{p.alias || p.modelName}</option>
          ))}
        </select>
      </div>

      {record.sourcePageUrl && (
        <div className="muted" style={{ wordBreak: 'break-all' }}>
          Source：
          <a href={record.sourcePageUrl} target="_blank" rel="noreferrer">
            {record.sourcePageTitle || record.sourcePageUrl}
          </a>
        </div>
      )}

      <div className="row" style={{ margin: '10px 0' }}>
        <button onClick={() => copyBundle(composeInputBundle(assets, fileRecords), 'Input')}>
          複製 Input
        </button>
        <button onClick={() => copyBundle(composeOutputBundle(assets, fileRecords), 'Output')}>
          複製 Output
        </button>
        <button onClick={() => copyBundle(composeFullRecord(record, assets, fileRecords, catPath), '完整紀錄')}>
          複製完整紀錄
        </button>
        <button
          onClick={async () => {
            downloadText(`prompttrace-${record.id.slice(0, 8)}.md`, exportMarkdown(await exportCtx()), 'text/markdown');
            await exportRecordRepository.save({
              id: crypto.randomUUID(),
              recordId: record.id,
              format: 'markdown',
              exportedAt: new Date().toISOString(),
            });
          }}
        >
          匯出 Markdown
        </button>
        <button
          onClick={async () => {
            downloadText(`prompttrace-${record.id.slice(0, 8)}.json`, exportJsonString(await exportCtx()), 'application/json');
            await exportRecordRepository.save({
              id: crypto.randomUUID(),
              recordId: record.id,
              format: 'json',
              exportedAt: new Date().toISOString(),
            });
          }}
        >
          匯出 JSON
        </button>
      </div>

      {tray && (
        <div className="card" style={{ borderColor: 'var(--accent)' }}>
          <div className="spread">
            <strong>Floating Copy Tray</strong>
            <button onClick={() => setTray(null)}>關閉</button>
          </div>
          <div className="muted">
            文字已複製。以下媒體無法與文字一起寫入剪貼簿，請逐項複製或直接拖進目標聊天框。
          </div>
          <div className="row" style={{ marginTop: 6 }}>
            {tray.mediaAssets.map((m) => (
              <div key={m.id} style={{ maxWidth: 140 }}>
                {m.assetType === 'image' ? (
                  <img className="thumb" src={m.previewRef ?? m.originalUrl} alt="tray" draggable />
                ) : (
                  <div className="preview-text">🎞 video</div>
                )}
                <button
                  style={{ width: '100%' }}
                  onClick={async () => {
                    const url = m.originalUrl ?? m.previewRef ?? '';
                    await navigator.clipboard.writeText(url);
                    say('已複製媒體連結。');
                  }}
                >
                  複製連結
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="row" style={{ alignItems: 'flex-start' }}>
        <div style={{ flex: 2, minWidth: 320 }}>
          {(['input', 'input_reference', 'negative', 'output'] as AssetRole[]).map(roleSection)}
        </div>
        <div style={{ flex: 1, minWidth: 240 }}>
          <h2>Notes</h2>
          <textarea
            rows={4}
            value={record.notes ?? ''}
            onChange={(e) => setBundle({ ...bundle, record: { ...record, notes: e.target.value } })}
            onBlur={(e) => updateRecord({ notes: e.target.value })}
          />
          <h2>Tags</h2>
          <div className="row">
            {tags.map((t) => (
              <span key={t.id} className="pill" style={{ background: 'var(--panel-2)', color: 'var(--text)' }}>
                #{t.name}{' '}
                <a
                  style={{ cursor: 'pointer' }}
                  onClick={async () => {
                    await tagRepository.delete(t.id);
                    await load();
                  }}
                >
                  ×
                </a>
              </span>
            ))}
          </div>
          <div className="row" style={{ marginTop: 4 }}>
            <input
              placeholder="新增 tag…"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={async (e) => {
                if (e.key === 'Enter' && tagInput.trim()) {
                  await tagRepository.save({ id: crypto.randomUUID(), recordId: record.id, name: tagInput.trim() });
                  setTagInput('');
                  await load();
                }
              }}
            />
          </div>
          <h2>補充資產</h2>
          <textarea
            rows={3}
            placeholder="貼上文字後按「新增文字」"
            value={newText}
            onChange={(e) => setNewText(e.target.value)}
          />
          <div className="row" style={{ marginTop: 4 }}>
            <select value={newTextRole} style={{ width: 'auto' }} onChange={(e) => setNewTextRole(e.target.value as AssetRole)}>
              {(Object.keys(ROLE_LABELS) as AssetRole[]).map((r) => (
                <option key={r} value={r}>{ROLE_LABELS[r]}</option>
              ))}
            </select>
            <button
              disabled={!newText.trim()}
              onClick={async () => {
                await addTextAsset(newText.trim(), newTextRole);
                setNewText('');
              }}
            >
              新增文字
            </button>
          </div>
          <div className="muted" style={{ marginTop: 6 }}>
            或直接把圖片 / 影片檔拖放到本頁面即可加入（以 Input 角色加入，可再調整）。
          </div>
          <label className="row" style={{ marginTop: 6 }}>
            <input
              type="file"
              accept="image/*,video/*"
              multiple
              onChange={async (e) => {
                for (const file of Array.from(e.target.files ?? [])) {
                  const type: AssetType | null = file.type.startsWith('image/')
                    ? 'image'
                    : file.type.startsWith('video/')
                      ? 'video'
                      : null;
                  if (!type) continue;
                  const dataUrl = await new Promise<string>((resolve) => {
                    const reader = new FileReader();
                    reader.onload = () => resolve(String(reader.result));
                    reader.readAsDataURL(file);
                  });
                  await addTextAsset('', 'input', type, dataUrl);
                }
                e.target.value = '';
              }}
            />
          </label>
          <h2>File Records</h2>
          {fileRecords.length === 0 && <div className="muted">None</div>}
          {fileRecords.map((f) => (
            <div className="card" key={f.id}>
              <div style={{ wordBreak: 'break-all' }}>{f.filename}</div>
              <div className="muted">
                {f.downloadStatus}
                {f.localPath ? ` · ${f.localPath}` : ''}
                {f.deleteStatus !== 'not_deleted' ? ` · ${f.deleteStatus}` : ''}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Compact left/right (or output-only) preview of a record's assets on its list card. */
function CardPreview({ assets, layout }: { assets: Asset[]; layout: 'split' | 'output-only' }) {
  const cell = (a: Asset) => {
    if (a.assetType === 'text') {
      const text = (a.textContent ?? '').trim();
      return text ? (
        <div key={a.id} className="record-preview-text">
          {text.slice(0, 160)}
        </div>
      ) : null;
    }
    const src = a.previewRef ?? a.originalUrl;
    return src ? (
      <img
        key={a.id}
        src={src}
        alt=""
        className="record-preview-thumb"
        onError={(e) => {
          e.currentTarget.style.display = 'none';
        }}
      />
    ) : null;
  };
  const col = (items: Asset[], label: string) => (
    <div className="record-preview-col">
      <div className="record-preview-label">{label}</div>
      {items.length === 0 ? <div className="record-preview-empty">—</div> : items.map(cell)}
    </div>
  );
  const left = assets.filter((a) => a.role !== 'output');
  const right = assets.filter((a) => a.role === 'output');
  if (layout === 'output-only') {
    return <div className="record-preview is-output-only">{col(right, 'Output')}</div>;
  }
  return (
    <div className="record-preview">
      {col(left, 'Input · Reference')}
      {col(right, 'Output')}
    </div>
  );
}
