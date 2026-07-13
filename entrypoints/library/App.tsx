import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import type { Asset, FileRecord, LibraryRecord } from '@/src/core/domain/entities';
import { ROLE_LABELS, type AssetRole } from '@/src/core/domain/enums';
import {
  allowedRolesFor,
  ROLE_NOT_ALLOWED_MESSAGE,
  validateCategoryName,
} from '@/src/core/domain/validation';
import {
  assetRepository,
  categoryRepository,
  fileRecordRepository,
  recordRepository,
} from '@/src/storage/repositories';
import { assetTypeLabel, categoryLabel, resolveLanguage, roleLabel, UI_TEXT, type ResolvedLanguage, type UiText } from '@/src/ui/i18n';
import { DEFAULT_ROLE_COLORS, DEFAULT_SETTINGS, loadSettings, onSettingsChanged, type DisplaySettings } from '@/src/ui/roleColors';
import { flattenTree, useTaxonomy } from '@/src/ui/hooks';

type RecordBundle = {
  record: LibraryRecord;
  assets: Asset[];
  fileRecords: FileRecord[];
};

type CategoryDraft = {
  id: string;
  name: string;
};

type CategoryColorStyle = CSSProperties & {
  '--category-color': string;
  '--category-indent'?: string;
};

function categoryColorStyle(color: string | null | undefined, extra: Partial<CategoryColorStyle> = {}): CategoryColorStyle {
  return { ...extra, '--category-color': color ?? DEFAULT_ROLE_COLORS.pending };
}

function summaryResultMessage(reason: string | undefined, language: ResolvedLanguage): string {
  const messages: Record<string, { en: string; zh: string }> = {
    no_prompt_text: {
      en: 'No input text was found, so there is nothing to summarize.',
      zh: '沒有輸入文字可摘要，所以這筆紀錄不會送出摘要請求。',
    },
    api_key_required: {
      en: 'Add an API key in Settings before generating summaries.',
      zh: '請先到設定填入 API key，才能產生摘要。',
    },
    model_required: {
      en: 'Choose a summary model in Settings before generating summaries.',
      zh: '請先到設定選擇摘要模型，才能產生摘要。',
    },
    summary_disabled: {
      en: 'Summary is disabled in Settings.',
      zh: '摘要功能目前在設定中關閉。',
    },
    provider_failed: {
      en: 'The summary provider request failed.',
      zh: '摘要服務請求失敗。',
    },
    record_not_found: {
      en: 'This record could not be found.',
      zh: '找不到這筆紀錄。',
    },
  };
  const message = messages[reason ?? ''];
  if (message) return language === 'en-US' ? message.en : message.zh;
  return language === 'en-US' ? `Summary was not generated: ${reason ?? 'unknown'}.` : `摘要未產生：${reason ?? 'unknown'}。`;
}

function summaryReasonNeedsSettings(reason: string | undefined): boolean {
  return reason === 'summary_disabled' || reason === 'api_key_required' || reason === 'model_required';
}

async function loadBundle(record: LibraryRecord): Promise<RecordBundle> {
  const assets = await assetRepository.byRecord(record.id);
  const fileRecords: FileRecord[] = [];
  for (const a of assets) fileRecords.push(...(await fileRecordRepository.byAsset(a.id)));
  return { record, assets, fileRecords };
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
  const [draggingRecordId, setDraggingRecordId] = useState<string | null>(null);
  const [dragOverCategoryId, setDragOverCategoryId] = useState<string | null>(null);
  const [dragOverTrash, setDragOverTrash] = useState(false);
  const [deleteStatus, setDeleteStatus] = useState('');
  const [refresh, setRefresh] = useState(0);
  const { categories } = useTaxonomy(refresh);
  const reload = () => setRefresh((x) => x + 1);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  useEffect(() => {
    loadSettings().then(setSettings);
    onSettingsChanged(setSettings);
  }, []);
  const language = resolveLanguage(settings.language);
  const t = UI_TEXT[language];

  const clearDragState = () => {
    setDraggingRecordId(null);
    setDragOverCategoryId(null);
    setDragOverTrash(false);
  };

  const moveRecordToTrash = async (recordId: string) => {
    await chrome.runtime.sendMessage({ type: 'library/trashRecord', payload: { recordId } });
    setRecords((items) => items.filter((item) => item.id !== recordId));
    setAssetIndex((idx) => {
      const next = new Map(idx);
      next.delete(recordId);
      return next;
    });
    if (selectedId === recordId) setSelectedId(null);
    setDeleteStatus(t.recordMovedToTrash);
    window.setTimeout(() => setDeleteStatus(''), 1800);
    reload();
  };

  useEffect(() => {
    (async () => {
      const all = await recordRepository.listActive();
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

  const assignRecordCategory = async (recordId: string, categoryId: string) => {
    const record = await recordRepository.get(recordId);
    if (!record || record.categoryId === categoryId) return;
    await recordRepository.save({ ...record, categoryId, updatedAt: new Date().toISOString() });
    reload();
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
                className={[
                  'filter-option',
                  filterCategories.includes(category.id) ? 'is-active' : '',
                  dragOverCategoryId === category.id ? 'is-drop-target' : '',
                ].filter(Boolean).join(' ')}
                style={categoryColorStyle(category.color, { '--category-indent': `${depth * 10}px` })}
                aria-pressed={filterCategories.includes(category.id)}
                onDragOver={(e) => {
                  if (!e.dataTransfer.types.includes('application/x-promptrace-record-id')) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  setDragOverCategoryId(category.id);
                }}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragOverCategoryId(null);
                }}
                onDrop={async (e) => {
                  const recordId = e.dataTransfer.getData('application/x-promptrace-record-id');
                  if (!recordId) return;
                  e.preventDefault();
                  setDragOverCategoryId(null);
                  await assignRecordCategory(recordId, category.id);
                }}
                onClick={() => toggleCategoryFilter(category.id)}
              >
                <i aria-hidden="true" />
                <span>{categoryLabel(category, language)}</span>
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
        <TrashDropZone
          isDragging={draggingRecordId !== null}
          isArmed={dragOverTrash}
          t={t}
          onArmedChange={setDragOverTrash}
          onOpenTrash={() => {
            location.href = 'trash.html';
          }}
          onDropRecord={async (recordId) => {
            setDragOverCategoryId(null);
            setDragOverTrash(false);
            await moveRecordToTrash(recordId);
          }}
        />
        {deleteStatus && (
          <div className="library-rail-toast" role="status">
            {deleteStatus}
          </div>
        )}
      </aside>

      <main className="library-main">
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
                dragging={record.id === draggingRecordId}
                layout={settings.cardLayout}
                t={t}
                language={language}
                onOpen={() => setSelectedId(record.id)}
                onDragStart={() => setDraggingRecordId(record.id)}
                onDragDone={clearDragState}
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
              onChanged={reload}
              t={t}
              language={language}
            />
          ) : (
            <div className="library-detail-empty">
              <h2>{language === 'en-US' ? 'Select a record' : '選取一筆紀錄'}</h2>
              <p>{language === 'en-US' ? 'Select a card to see its full text, media, and summary here.' : '點選中央卡片後，這裡會固定顯示完整文字、圖片與摘要。'}</p>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

function TrashDropZone(props: {
  isDragging: boolean;
  isArmed: boolean;
  t: UiText;
  onArmedChange: (armed: boolean) => void;
  onOpenTrash: () => void;
  onDropRecord: (recordId: string) => Promise<void>;
}) {
  const { isDragging, isArmed, t, onArmedChange, onOpenTrash, onDropRecord } = props;
  const recordDragType = 'application/x-promptrace-record-id';

  const acceptsRecordDrag = (types: DataTransfer['types']) => Array.from(types).includes(recordDragType);

  return (
    <div
      className={[
        'library-trash-zone',
        isDragging ? 'is-dragging' : '',
        isArmed ? 'is-open' : '',
      ].filter(Boolean).join(' ')}
      role="button"
      tabIndex={0}
      aria-label={t.trashOpen}
      onClick={onOpenTrash}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpenTrash();
        }
      }}
      onDragEnter={(e) => {
        if (!acceptsRecordDrag(e.dataTransfer.types)) return;
        e.preventDefault();
        onArmedChange(true);
      }}
      onDragOver={(e) => {
        if (!acceptsRecordDrag(e.dataTransfer.types)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        onArmedChange(true);
      }}
      onDragLeave={(e) => {
        const nextTarget = e.relatedTarget;
        if (nextTarget instanceof Node && e.currentTarget.contains(nextTarget)) return;
        onArmedChange(false);
      }}
      onDrop={async (e) => {
        const recordId = e.dataTransfer.getData(recordDragType);
        if (!recordId) return;
        e.preventDefault();
        onArmedChange(false);
        await onDropRecord(recordId);
      }}
    >
      <span className="library-trash-icon" aria-hidden="true">
        <span className="library-trash-lid" />
        <span className="library-trash-bin" />
      </span>
      <span className="library-trash-title">{t.trashTitle}</span>
      <span className="library-trash-hint">{isArmed ? t.trashReady : t.trashHint}</span>
    </div>
  );
}

function RecordCard(props: {
  record: LibraryRecord;
  assets: Asset[];
  categories: ReturnType<typeof useTaxonomy>['categories'];
  selected: boolean;
  dragging: boolean;
  layout: DisplaySettings['cardLayout'];
  t: UiText;
  language: ResolvedLanguage;
  onOpen: () => void;
  onDragStart: () => void;
  onDragDone: () => void;
}) {
  const { record, assets, categories, selected, dragging, layout, t, language, onOpen, onDragStart, onDragDone } = props;
  const category = categories.find((c) => c.id === record.categoryId);
  const copyAssets = async (pickedAssets: Asset[]) => {
    onOpen();
    try {
      await copyPreviewAssetsToClipboard(pickedAssets);
    } catch {
      // Clipboard availability depends on browser focus/permissions; selecting the record still succeeds.
    }
  };

  return (
    <article
      className={[
        'record-card',
        selected ? 'is-selected' : '',
        dragging ? 'is-dragging' : '',
      ].filter(Boolean).join(' ')}
      role="button"
      tabIndex={0}
      draggable
      onDragStart={(e) => {
        onDragStart();
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('application/x-promptrace-record-id', record.id);
        e.dataTransfer.setData('text/plain', record.title || record.id);
      }}
      onDragEnd={onDragDone}
      onFocus={onOpen}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
    >
      <div className="record-card-topline">
        <span
          className={category ? 'record-category-pill' : 'record-category-pill is-empty'}
          style={categoryColorStyle(category?.color)}
        >
          {category ? categoryLabel(category, language) : t.uncategorized}
        </span>
        <span className="record-asset-count">{assets.length} {t.assets}</span>
      </div>
      <div className="record-card-summary-slot" aria-label={language === 'en-US' ? 'Summary area' : '摘要保留區'}>
        {record.summary ? (
          <div className="record-card-summary">{record.summary}</div>
        ) : record.summaryStatus === 'pending' ? (
          <div className="record-card-summary is-muted">{language === 'en-US' ? 'Summarizing...' : '摘要中...'}</div>
        ) : record.summaryStatus === 'failed' ? (
          <div className="record-card-summary is-muted">{language === 'en-US' ? 'Summary failed' : '摘要失敗'}</div>
        ) : (
          <div className="record-card-summary is-muted">{language === 'en-US' ? 'No summary yet' : '尚未摘要'}</div>
        )}
      </div>
      <CardPreview assets={assets} layout={layout} t={t} onAssetPick={copyAssets} />
    </article>
  );
}

function RecordDetail(props: {
  recordId: string;
  categories: ReturnType<typeof useTaxonomy>['categories'];
  onChanged: () => void;
  t: UiText;
  language: ResolvedLanguage;
}) {
  const [bundle, setBundle] = useState<RecordBundle | null>(null);
  const [toast, setToast] = useState('');
  const [summaryNotice, setSummaryNotice] = useState('');
  const [summaryNoticeReason, setSummaryNoticeReason] = useState<string | undefined>();
  const [summarizing, setSummarizing] = useState(false);

  const load = useCallback(async () => {
    const record = await recordRepository.get(props.recordId);
    if (record) setBundle(await loadBundle(record));
  }, [props.recordId]);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    setSummaryNotice('');
    setSummaryNoticeReason(undefined);
  }, [props.recordId]);

  const { t, language } = props;
  if (!bundle) return <div className="muted">{t.loading}</div>;
  const { record, assets, fileRecords } = bundle;

  const say = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 2500);
  };

  const updateRecord = async (patch: Partial<LibraryRecord>) => {
    await recordRepository.save({ ...record, ...patch, updatedAt: new Date().toISOString() });
    await load();
    props.onChanged();
  };

  const updateTextAsset = async (asset: Asset, textContent: string) => {
    await assetRepository.save({ ...asset, textContent });
    await recordRepository.save({ ...record, updatedAt: new Date().toISOString() });
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
      if (!result?.ok) {
        const message = summaryResultMessage(result?.reason, language);
        setSummaryNotice(message);
        setSummaryNoticeReason(result?.reason);
        if (result?.reason === 'no_prompt_text') props.onChanged();
      } else {
        setSummaryNotice('');
        setSummaryNoticeReason(undefined);
        props.onChanged();
        say(language === 'en-US' ? 'Summary updated.' : '摘要已更新。');
      }
    } catch {
      const message = language === 'en-US' ? 'Summary request failed.' : '摘要請求失敗。';
      setSummaryNotice(message);
      setSummaryNoticeReason(undefined);
    } finally {
      setSummarizing(false);
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
                      props.onChanged();
                    }}
                  >
                    {(Object.keys(ROLE_LABELS) as AssetRole[]).map((r) => (
                      <option key={r} value={r} disabled={!allowedRolesFor(a.assetType).includes(r)}>
                        {roleLabel(r, language)}
                      </option>
                    ))}
                  </select>
                  {file && <FileRecordLine file={file} language={language} onSay={say} />}
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
                <TextAssetEditor asset={a} language={language} onSave={(textContent) => updateTextAsset(a, textContent)} />
              ) : a.assetType === 'image' ? (
                <img className="thumb" src={a.previewRef ?? a.originalUrl} alt="asset" />
              ) : a.previewRef?.startsWith('data:image/') ? (
                <img className="thumb" src={a.previewRef} alt="video preview" />
              ) : a.previewRef?.startsWith('data:video/') ? (
                <video className="thumb" src={a.previewRef} controls muted />
              ) : (
                <div className="preview-text">🎞 {language === 'en-US' ? 'Video file' : '影片檔案'}</div>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div>
      {toast && (
        <div className="card" style={{ borderColor: 'var(--ok)', position: 'sticky', top: 0, zIndex: 10 }}>
          {toast}
        </div>
      )}
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
      </div>

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
        {summaryNotice && (
          <div className="record-summary-notice">
            <span>{summaryNotice}</span>
            {summaryReasonNeedsSettings(summaryNoticeReason) && (
              <button
                type="button"
                className="record-summary-settings-button"
                onClick={() => {
                  location.href = 'settings.html';
                }}
              >
                {t.settings}
              </button>
            )}
          </div>
        )}
        {record.summaryTokenUsage && (
          <div className="record-summary-token-row">
            <span>{language === 'en-US' ? 'Input' : '輸入'} {formatTokenMaybe(record.summaryTokenUsage.inputTokens, language)}</span>
            <span>{language === 'en-US' ? 'Output' : '輸出'} {formatTokenMaybe(record.summaryTokenUsage.outputTokens, language)}</span>
            <span>{language === 'en-US' ? 'Total' : '總計'} {formatTokenMaybe(record.summaryTokenUsage.totalTokens, language)}</span>
          </div>
        )}
      </div>

      <div className="row" style={{ alignItems: 'flex-start' }}>
        <div style={{ flex: 2, minWidth: 320 }}>
          {(['input', 'input_reference', 'negative', 'output'] as AssetRole[]).map(roleSection)}
        </div>
      </div>
    </div>
  );
}

function formatTokenMaybe(value: number | null | undefined, language: ResolvedLanguage): string {
  return value == null ? '--' : value.toLocaleString(language);
}

function TextAssetEditor({
  asset,
  language,
  onSave,
}: {
  asset: Asset;
  language: ResolvedLanguage;
  onSave: (textContent: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState(asset.textContent ?? '');
  const [status, setStatus] = useState('');

  useEffect(() => {
    setDraft(asset.textContent ?? '');
    setStatus('');
  }, [asset.id, asset.textContent]);

  const save = async () => {
    if (draft === (asset.textContent ?? '')) return;
    await onSave(draft);
    setStatus(language === 'en-US' ? 'Saved' : '已保存');
    window.setTimeout(() => setStatus(''), 1600);
  };

  return (
    <div className="asset-text-edit">
      <textarea
        className="preview-text asset-text-editor"
        value={draft}
        rows={Math.min(8, Math.max(3, draft.split('\n').length))}
        onChange={(e) => {
          setDraft(e.target.value);
          setStatus(language === 'en-US' ? 'Editing' : '編輯中');
        }}
        onBlur={save}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.currentTarget.blur();
          }
        }}
      />
      {status && <span className="asset-text-edit-status">{status}</span>}
    </div>
  );
}

function FileRecordLine({
  file,
  language,
  onSay,
}: {
  file: FileRecord;
  language: ResolvedLanguage;
  onSay: (message: string) => void;
}) {
  const openLocation = () => {
    if (file.downloadId == null) return;
    try {
      chrome.downloads.show(file.downloadId);
    } catch {
      onSay(language === 'en-US' ? 'Could not open the file location.' : '無法開啟檔案位置。');
    }
  };

  return (
    <>
      {file.deleteStatus !== 'not_deleted' && (
        <span className="file-record-meta">
          {language === 'en-US' ? 'File status' : '檔案狀態'}：{file.deleteStatus}
        </span>
      )}
      {file.downloadStatus === 'failed' ? (
        <button
          type="button"
          onClick={() =>
            chrome.runtime
              .sendMessage({ type: 'media/retryDownload', payload: { fileRecordId: file.id } })
              .then(() => onSay(language === 'en-US' ? 'Retried.' : '已重試。'))
          }
        >
          {language === 'en-US' ? 'Retry' : '重試'}
        </button>
      ) : (
        <button type="button" disabled={file.downloadId == null} onClick={openLocation}>
          {language === 'en-US' ? 'Location' : '位置'}
        </button>
      )}
    </>
  );
}

async function copyPreviewAssetsToClipboard(assets: Asset[]): Promise<void> {
  const texts = assets
    .filter((asset) => asset.assetType === 'text')
    .map((asset) => (asset.textContent ?? '').trim())
    .filter(Boolean);
  if (texts.length === 0) return;
  await navigator.clipboard.writeText(texts.join('\n\n'));
}

/** Compact left/right or single-column preview of a record's assets on its list card. */
function CardPreview({
  assets,
  layout,
  t,
  onAssetPick,
}: {
  assets: Asset[];
  layout: DisplaySettings['cardLayout'];
  t: UiText;
  onAssetPick: (assets: Asset[]) => void;
}) {
  const renderAssetPreview = (asset: Asset) => {
    if (asset.assetType === 'text') {
      const text = (asset.textContent ?? '').trim();
      return text ? (
        <div key={asset.id} className="record-preview-text record-preview-unit">
          {text.slice(0, 220)}
        </div>
      ) : null;
    }
    const src = asset.previewRef ?? asset.originalUrl;
    return src ? (
      <img
        key={asset.id}
        src={src}
        alt=""
        className="record-preview-thumb record-preview-unit"
        onError={(e) => {
          e.currentTarget.style.display = 'none';
        }}
      />
    ) : null;
  };
  const groupCard = (items: Asset[]) => {
    const pick = (e: { stopPropagation: () => void }) => {
      e.stopPropagation();
      onAssetPick(items);
    };
    const hasText = items.some((item) => item.assetType === 'text');
    const hasMedia = items.some((item) => item.assetType !== 'text');
    const stackClass = hasText && hasMedia
      ? 'record-preview-stack is-mixed'
      : hasText
        ? 'record-preview-stack is-text-only'
        : 'record-preview-stack is-media-only';
    return (
      <button type="button" className="record-preview-item" onClick={pick}>
        <div className={stackClass}>
          {items.map(renderAssetPreview)}
        </div>
      </button>
    );
  };
  const col = (items: Asset[], label: string) => (
    <div className="record-preview-col">
      <div className="record-preview-label">{label}</div>
      {items.length === 0 ? <div className="record-preview-empty">—</div> : groupCard(items)}
    </div>
  );
  const left = assets.filter((a) => a.role !== 'output');
  const right = assets.filter((a) => a.role === 'output');
  if (layout === 'input-only') {
    return <div className="record-preview is-output-only">{col(left, t.inputReference)}</div>;
  }
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
