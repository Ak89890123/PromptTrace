import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Asset, FileRecord, LibraryRecord, Tag } from '@/src/core/domain/entities';
import { ROLE_LABELS, type AssetRole, type AssetType } from '@/src/core/domain/enums';
import {
  allowedRolesFor,
  categoryPath,
  ROLE_NOT_ALLOWED_MESSAGE,
  validateCategoryName,
} from '@/src/core/domain/validation';
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
  categoryRepository,
  deleteRecordCascade,
  exportRecordRepository,
  fileRecordRepository,
  recordRepository,
  tagRepository,
} from '@/src/storage/repositories';
import { assetTypeLabel, categoryLabel, resolveLanguage, roleLabel, UI_TEXT, type ResolvedLanguage, type UiText } from '@/src/ui/i18n';
import { DEFAULT_ROLE_COLORS, DEFAULT_SETTINGS, loadSettings, onSettingsChanged } from '@/src/ui/roleColors';
import { flattenTree, useTaxonomy } from '@/src/ui/hooks';

type RecordBundle = {
  record: LibraryRecord;
  assets: Asset[];
  fileRecords: FileRecord[];
  tags: Tag[];
};

type CategoryDraft = {
  id: string;
  name: string;
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
  const [filterCategories, setFilterCategories] = useState<string[]>([]);
  const [categoryDrafts, setCategoryDrafts] = useState<CategoryDraft[]>([]);
  const [assetIndex, setAssetIndex] = useState<Map<string, Asset[]>>(new Map());
  const [refresh, setRefresh] = useState(0);
  const { categories, presets } = useTaxonomy(refresh);
  const reload = () => setRefresh((x) => x + 1);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  useEffect(() => {
    loadSettings().then(setSettings);
    onSettingsChanged(setSettings);
  }, []);
  const language = resolveLanguage(settings.language);
  const t = UI_TEXT[language];

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

  const toggleCategoryFilter = (categoryId: string) => {
    setFilterCategories((ids) => (ids.includes(categoryId) ? ids.filter((id) => id !== categoryId) : [...ids, categoryId]));
  };

  const addCategoryDraft = () => {
    setCategoryDrafts((drafts) => [...drafts, { id: crypto.randomUUID(), name: '' }]);
  };

  const updateCategoryDraft = (draftId: string, name: string) => {
    setCategoryDrafts((drafts) => drafts.map((draft) => (draft.id === draftId ? { ...draft, name } : draft)));
  };

  const discardCategoryDraft = (draftId: string) => {
    setCategoryDrafts((drafts) => drafts.filter((draft) => draft.id !== draftId));
  };

  const commitCategoryDraft = async (draft: CategoryDraft) => {
    const name = draft.name.trim();
    const validation = validateCategoryName(name);
    if (!validation.ok) {
      if (name.length === 0) discardCategoryDraft(draft.id);
      return;
    }
    const now = new Date().toISOString();
    await categoryRepository.save({
      id: crypto.randomUUID(),
      parentId: null,
      name,
      isBuiltin: false,
      isActive: true,
      sortOrder: categories.length + categoryDrafts.length,
      createdAt: now,
      updatedAt: now,
    });
    discardCategoryDraft(draft.id);
    reload();
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return records.filter((r) => {
      if (filterCategories.length > 0 && (!r.categoryId || !filterCategories.includes(r.categoryId))) return false;
      const assets = assetIndex.get(r.id) ?? [];
      if (q) {
        const haystack = [
          r.title,
          r.notes,
          r.sourcePageTitle,
          r.sourcePageUrl,
          r.modelLabel,
          r.modelName,
          r.summary,
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
  }, [records, assetIndex, search, filterCategories]);

  return (
    <div className="library-shell">
      <aside className="library-filter-rail">
        <div className="library-brand">
          <span className="library-count">{filtered.length} / {records.length}</span>
          <button
            type="button"
            className="library-settings-button"
            aria-label={t.settings}
            title={t.settings}
            onClick={() => {
              location.href = 'settings.html';
            }}
          >
            {t.settings}
          </button>
        </div>
        <label className="filter-field">
          <span>{t.search}</span>
          <input placeholder={t.searchPlaceholder} value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
        <div className="filter-section">
          <div className="filter-section-title">{t.category}</div>
          <button
            type="button"
            className="filter-section-reset"
            disabled={filterCategories.length === 0}
            onClick={() => setFilterCategories([])}
          >
            {t.resetCategory}
          </button>
          <div className="filter-option-list" role="group" aria-label={t.category}>
            {flattenTree(categories).map(({ category, depth }) => (
              <button
                type="button"
                key={category.id}
                className={filterCategories.includes(category.id) ? 'filter-option is-active' : 'filter-option'}
                style={{ paddingLeft: 12 + depth * 10 }}
                aria-pressed={filterCategories.includes(category.id)}
                onClick={() => toggleCategoryFilter(category.id)}
              >
                <span>{categoryLabel(category, language)}</span>
                <i aria-hidden="true" />
              </button>
            ))}
            {categoryDrafts.map((draft) => (
              <input
                key={draft.id}
                className="filter-new-item-input"
                value={draft.name}
                autoFocus
                placeholder={t.addCategory}
                onChange={(e) => updateCategoryDraft(draft.id, e.target.value)}
                onBlur={() => commitCategoryDraft(draft)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    e.currentTarget.blur();
                  }
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    discardCategoryDraft(draft.id);
                  }
                }}
              />
            ))}
            <button
              type="button"
              className="filter-add-item"
              aria-label={t.addCategory}
              onClick={addCategoryDraft}
            >
              +
            </button>
          </div>
        </div>
      </aside>

      <main className="library-main">
        <header className="library-hero">
          <div className="library-hero-stats">
            <span>{records.length} {t.records}</span>
            <span>{Array.from(assetIndex.values()).reduce((sum, items) => sum + items.length, 0)} {t.assets}</span>
          </div>
        </header>

        {filtered.length === 0 ? (
          <div className="library-empty">
            {records.length === 0 ? (
              <>
                <h2>{t.noRecords}</h2>
                <p>{t.noRecordsHint}</p>
              </>
            ) : (
              <>
                <h2>{t.noMatches}</h2>
                <p>{t.noMatchesHint}</p>
              </>
            )}
          </div>
        ) : (
          <section className="library-card-grid" aria-label={language === 'en-US' ? 'Library records' : '紀錄庫卡片'}>
            {filtered.map((record) => (
              <RecordCard
                key={record.id}
                record={record}
                assets={assetIndex.get(record.id) ?? []}
                categories={categories}
                selected={record.id === selectedId}
                layout={settings.cardLayout}
                t={t}
                language={language}
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
              t={t}
              language={language}
              onDeleted={() => {
                setSelectedId(null);
                reload();
              }}
            />
          ) : (
            <div className="library-detail-empty">
              <h2>{language === 'en-US' ? 'Select a record' : '選取一筆紀錄'}</h2>
              <p>{language === 'en-US' ? 'Select a card to see its full text, media, notes, tags, and files here.' : '點選中央卡片後，這裡會固定顯示完整文字、圖片、notes、tags 與檔案紀錄。'}</p>
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
  t: UiText;
  language: ResolvedLanguage;
  onOpen: () => void;
}) {
  const { record, assets, categories, selected, layout, t, language, onOpen } = props;
  const outputCount = assets.filter((a) => a.role === 'output').length;
  const category = categories.find((c) => c.id === record.categoryId);

  return (
    <button className={`record-card ${selected ? 'is-selected' : ''}`} onFocus={onOpen} onClick={onOpen}>
      <div className="record-card-topline">
        <span>{category ? categoryLabel(category, language) : t.uncategorized}</span>
        <span>{assets.length} {t.assets}</span>
      </div>
      <div className="record-card-summary-slot" aria-label={language === 'en-US' ? 'Summary area' : '摘要保留區'}>
        {record.summary ? (
          <div className="record-card-summary">{record.summary}</div>
        ) : record.summaryStatus === 'pending' ? (
          <div className="record-card-summary is-muted">摘要中...</div>
        ) : record.summaryStatus === 'failed' ? (
          <div className="record-card-summary is-muted">摘要失敗</div>
        ) : (
          <div className="record-card-summary is-muted">尚未摘要</div>
        )}
      </div>
      <CardPreview assets={assets} layout={layout} t={t} />
      <div className="record-card-footer">
        <span>{modelLabelOf(record)}</span>
        <span>{outputCount > 0 ? `${outputCount} ${t.output}` : language === 'en-US' ? 'no output' : '無輸出'}</span>
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
  t: UiText;
  language: ResolvedLanguage;
}) {
  const [bundle, setBundle] = useState<RecordBundle | null>(null);
  const [tray, setTray] = useState<CopyBundle | null>(null);
  const [toast, setToast] = useState('');
  const [newText, setNewText] = useState('');
  const [newTextRole, setNewTextRole] = useState<AssetRole>('input');
  const [tagInput, setTagInput] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [summarizing, setSummarizing] = useState(false);

  const load = useCallback(async () => {
    const record = await recordRepository.get(props.recordId);
    if (record) setBundle(await loadBundle(record));
  }, [props.recordId]);
  useEffect(() => {
    load();
  }, [load]);

  const { t, language } = props;
  if (!bundle) return <div className="muted">{t.loading}</div>;
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
        say(language === 'en-US' ? `${label} text copied. Handle media from the copy tray below.` : `${label} 文字已複製；媒體請從下方快速複製列逐項處理。`);
      } else {
        say(language === 'en-US' ? `${label} copied.` : `${label} 已複製。`);
      }
    } catch {
      setTray(b);
      say(language === 'en-US' ? 'Clipboard write failed. Copy items from the copy tray below.' : '剪貼簿寫入失敗；請從快速複製列逐項複製。');
    }
  };

  const exportCtx = async (): Promise<ExportContext> => {
    return {
      record,
      assets,
      fileRecords,
      tags,
      categoryPath: catPath,
      includeSource: true,
      includeFilePath: true,
    };
  };

  const updateRecord = async (patch: Partial<LibraryRecord>) => {
    await recordRepository.save({ ...record, ...patch, updatedAt: new Date().toISOString() });
    await load();
    props.onChanged();
  };

  const summarize = async () => {
    setSummarizing(true);
    try {
      const result = await chrome.runtime.sendMessage({
        type: 'summary/summarizeRecord',
        payload: { recordId: record.id },
      });
      await load();
      props.onChanged();
      if (!result?.ok) {
        say(language === 'en-US' ? `Summary skipped: ${result?.reason ?? 'unknown'}` : `摘要未完成：${result?.reason ?? 'unknown'}`);
      } else {
        say(language === 'en-US' ? 'Summary updated.' : '摘要已更新。');
      }
    } catch {
      say(language === 'en-US' ? 'Summary request failed.' : '摘要請求失敗。');
    } finally {
      setSummarizing(false);
    }
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
            {roleLabel(role, language)}
          </span>{' '}
          <span className="muted">{items.length}</span>
        </h2>
        {items.length === 0 && <div className="muted">{language === 'en-US' ? 'None' : '無'}</div>}
        {items.map((a) => {
          const file = fileRecords.find((f) => f.assetId === a.id);
          return (
            <div className="card" key={a.id}>
              <div className="spread">
                <strong>{assetTypeLabel(a.assetType, language)}</strong>
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
                        {roleLabel(r, language)}
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
                    {language === 'en-US' ? 'Remove' : '移除'}
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
                <div className="preview-text">🎞 {language === 'en-US' ? 'Video file' : '影片檔案'}</div>
              )}
              {a.originalUrl && !a.originalUrl.startsWith('data:') && (
                <div className="muted" style={{ wordBreak: 'break-all' }}>
                  {language === 'en-US' ? 'Source' : '來源'}：<a href={a.originalUrl} target="_blank" rel="noreferrer">{a.originalUrl}</a>
                </div>
              )}
              {file && (
                <div className="muted">
                  {language === 'en-US' ? 'Download' : '下載'}：{file.downloadStatus}
                  {file.localPath ? ` · ${file.localPath}` : ''}
                  {file.deleteStatus !== 'not_deleted' ? ` · 檔案狀態：${file.deleteStatus}` : ''}
                  {file.downloadStatus === 'failed' && (
                    <>
                      {' '}
                      <button
                        onClick={() =>
                          chrome.runtime
                            .sendMessage({ type: 'media/retryDownload', payload: { fileRecordId: file.id } })
                            .then(() => say(language === 'en-US' ? 'Download retried.' : '已重試下載。'))
                        }
                      >
                        {language === 'en-US' ? 'Retry download' : '重試下載'}
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
          placeholder={language === 'en-US' ? '(Untitled record - type a title)' : '（未命名紀錄，點此輸入標題）'}
          onChange={(e) => setBundle({ ...bundle, record: { ...record, title: e.target.value } })}
          onBlur={(e) => updateRecord({ title: e.target.value })}
        />
        {!deleting ? (
          <button className="danger" onClick={() => setDeleting(true)}>{language === 'en-US' ? 'Delete record' : '刪除紀錄'}</button>
        ) : (
          <div className="row">
            <button
              className="danger"
              onClick={async () => {
                await deleteRecordCascade(record.id);
                props.onDeleted();
              }}
            >
              {language === 'en-US' ? 'Delete record only' : '只刪紀錄（保留檔案）'}
            </button>
            <button
              className="danger"
              onClick={async () => {
                const res = await chrome.runtime
                  .sendMessage({ type: 'media/deleteRecordFiles', payload: { recordId: record.id } })
                  .catch(() => ({ ok: false }));
                await deleteRecordCascade(record.id);
                if (res && !res.ok) {
                  alert(language === 'en-US' ? 'Some local files could not be deleted. The record was deleted.' : '部分本地檔案刪除失敗，請手動處理。紀錄已刪除。');
                }
                props.onDeleted();
              }}
            >
              {language === 'en-US' ? 'Delete record and files' : '連同本地檔案刪除'}
            </button>
            <button onClick={() => setDeleting(false)}>{language === 'en-US' ? 'Cancel' : '取消'}</button>
          </div>
        )}
        <button onClick={props.onClose} aria-label={language === 'en-US' ? 'Close details' : '關閉詳情'}>{t.close}</button>
      </div>

      <div className="row" style={{ margin: '8px 0' }}>
        <label className="muted">{t.category}</label>
        <select
          style={{ width: 'auto' }}
          value={record.categoryId ?? ''}
          onChange={(e) => updateRecord({ categoryId: e.target.value || null })}
        >
          <option value="">{t.uncategorized}</option>
          {flattenTree(props.categories).map(({ category, depth }) => (
            <option key={category.id} value={category.id}>
              {'  '.repeat(depth)}{categoryLabel(category, language)}
            </option>
          ))}
        </select>
        <label className="muted">{t.model}</label>
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
          <option value="">{language === 'en-US' ? 'Not specified' : '未指定'}</option>
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

      <div className="card record-summary-panel">
        <div className="spread">
          <strong>{language === 'en-US' ? 'Summary' : '摘要'}</strong>
          <button type="button" disabled={summarizing} onClick={summarize}>
            {summarizing ? (language === 'en-US' ? 'Summarizing...' : '摘要中...') : (record.summary ? (language === 'en-US' ? 'Resummarize' : '重新摘要') : (language === 'en-US' ? 'Summarize' : '產生摘要'))}
          </button>
        </div>
        {record.summary ? (
          <p>{record.summary}</p>
        ) : record.summaryStatus === 'failed' ? (
          <p className="muted">{language === 'en-US' ? 'Last summary failed.' : '上次摘要失敗。'}</p>
        ) : record.summaryStatus === 'skipped' ? (
          <p className="muted">{language === 'en-US' ? 'No prompt text was found.' : '沒有找到可摘要的 prompt 文字。'}</p>
        ) : (
          <p className="muted">{language === 'en-US' ? 'No summary yet.' : '尚未摘要。'}</p>
        )}
        {record.summaryTokenUsage && (
          <div className="record-summary-token-row">
            <span>{language === 'en-US' ? 'Input' : '輸入'} {formatTokenMaybe(record.summaryTokenUsage.inputTokens)}</span>
            <span>{language === 'en-US' ? 'Output' : '輸出'} {formatTokenMaybe(record.summaryTokenUsage.outputTokens)}</span>
            <span>{language === 'en-US' ? 'Total' : '總計'} {formatTokenMaybe(record.summaryTokenUsage.totalTokens)}</span>
          </div>
        )}
      </div>

      <div className="row" style={{ margin: '10px 0' }}>
        <button onClick={() => copyBundle(composeInputBundle(assets, fileRecords), roleLabel('input', language))}>
          {t.copy} {roleLabel('input', language)}
        </button>
        <button onClick={() => copyBundle(composeOutputBundle(assets, fileRecords), roleLabel('output', language))}>
          {t.copy} {roleLabel('output', language)}
        </button>
        <button onClick={() => copyBundle(composeFullRecord(record, assets, fileRecords, catPath), language === 'en-US' ? 'Full record' : '完整紀錄')}>
          {language === 'en-US' ? 'Copy full record' : '複製完整紀錄'}
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
          {language === 'en-US' ? 'Export Markdown' : '匯出 Markdown'}
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
          {language === 'en-US' ? 'Export JSON' : '匯出 JSON'}
        </button>
      </div>

      {tray && (
        <div className="card" style={{ borderColor: 'var(--accent)' }}>
          <div className="spread">
            <strong>{t.copyTrayShort}</strong>
            <button onClick={() => setTray(null)}>{t.close}</button>
          </div>
          <div className="muted">
            {language === 'en-US'
              ? 'Text was copied. Copy the media below one by one, or drag it into the target chat.'
              : '文字已複製。以下媒體無法與文字一起寫入剪貼簿，請逐項複製或直接拖進目標聊天框。'}
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
                    say(language === 'en-US' ? 'Media link copied.' : '已複製媒體連結。');
                  }}
                >
                  {language === 'en-US' ? 'Copy link' : '複製連結'}
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
              placeholder={language === 'en-US' ? 'Add tag…' : '新增標籤…'}
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
          <h2>{language === 'en-US' ? 'Add content' : '補充內容'}</h2>
          <textarea
            rows={3}
            placeholder={language === 'en-US' ? 'Paste text, then click Add text' : '貼上文字後按「新增文字」'}
            value={newText}
            onChange={(e) => setNewText(e.target.value)}
          />
          <div className="row" style={{ marginTop: 4 }}>
            <select value={newTextRole} style={{ width: 'auto' }} onChange={(e) => setNewTextRole(e.target.value as AssetRole)}>
              {(Object.keys(ROLE_LABELS) as AssetRole[]).map((r) => (
                <option key={r} value={r}>{roleLabel(r, language)}</option>
              ))}
            </select>
            <button
              disabled={!newText.trim()}
              onClick={async () => {
                await addTextAsset(newText.trim(), newTextRole);
                setNewText('');
              }}
            >
              {language === 'en-US' ? 'Add text' : '新增文字'}
            </button>
          </div>
          <div className="muted" style={{ marginTop: 6 }}>
            {language === 'en-US'
              ? 'You can also drag images or videos here. They are added as Input first and can be changed later.'
              : '也可以直接把圖片或影片拖放到這裡。會先用輸入角色加入，之後可以再調整。'}
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
          <h2>{language === 'en-US' ? 'Files' : '檔案紀錄'}</h2>
          {fileRecords.length === 0 && <div className="muted">{language === 'en-US' ? 'None' : '無'}</div>}
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

function formatTokenMaybe(value: number | null | undefined): string {
  return value == null ? '--' : value.toLocaleString();
}

/** Compact left/right (or output-only) preview of a record's assets on its list card. */
function CardPreview({ assets, layout, t }: { assets: Asset[]; layout: 'split' | 'output-only'; t: UiText }) {
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
    return <div className="record-preview is-output-only">{col(right, t.output)}</div>;
  }
  return (
    <div className="record-preview">
      {col(left, t.inputReference)}
      {col(right, t.output)}
    </div>
  );
}
