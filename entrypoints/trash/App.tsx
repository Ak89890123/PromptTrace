import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Asset, LibraryRecord, RecordCategory } from '@/src/core/domain/entities';
import { assetRepository, categoryRepository, recordRepository } from '@/src/storage/repositories';
import { categoryLabel, resolveLanguage, UI_TEXT, type ResolvedLanguage } from '@/src/ui/i18n';
import { DEFAULT_SETTINGS, loadSettings, onSettingsChanged, saveSettings, type DisplaySettings } from '@/src/ui/roleColors';
import { PrompTraceWordmark } from '@/src/ui/PrompTraceWordmark';

type TrashBundle = {
  record: LibraryRecord;
  assets: Asset[];
};

const DAY_MS = 24 * 60 * 60 * 1000;

function clampRetentionDays(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_SETTINGS.trashRetentionDays;
  return Math.min(365, Math.max(1, Math.round(value)));
}

function formatDate(value: string | undefined, language: ResolvedLanguage): string {
  if (!value) return '—';
  return new Date(value).toLocaleString(language, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function expiryDate(record: LibraryRecord, retentionDays: number): Date | null {
  if (!record.trashedAt) return null;
  return new Date(new Date(record.trashedAt).getTime() + retentionDays * DAY_MS);
}

function daysLeft(record: LibraryRecord, retentionDays: number): number | null {
  const expiry = expiryDate(record, retentionDays);
  if (!expiry) return null;
  return Math.max(0, Math.ceil((expiry.getTime() - Date.now()) / DAY_MS));
}

function textFor(language: ResolvedLanguage) {
  return language === 'en-US'
    ? {
        title: 'Trash',
        subtitle: 'Records dragged here are kept temporarily. They can be restored before the retention time expires.',
        back: 'Back to Library',
        retention: 'Auto-delete after',
        days: 'days',
        save: 'Save retention',
        cleanExpired: 'Clean expired now',
        saved: 'Retention saved.',
        cleaned: (count: number) => `Permanently deleted ${count} expired record${count === 1 ? '' : 's'}.`,
        emptyTitle: 'Trash is empty',
        emptyHint: 'Drag cards onto the trash area in the Library to keep them here before permanent deletion.',
        restored: 'Record restored.',
        deleted: 'Record permanently deleted.',
        restore: 'Restore',
        deleteNow: 'Delete now',
        confirmDelete: 'Permanently delete this record and its local files?',
        movedAt: 'Moved to trash',
        expiresAt: 'Expires',
        left: (days: number | null) => (days == null ? '—' : days === 0 ? 'expires today' : `${days} day${days === 1 ? '' : 's'} left`),
        assets: 'assets',
        noPreview: 'No preview',
        uncategorized: 'Uncategorized',
      }
    : {
        title: '垃圾桶',
        subtitle: '拖進來的卡片會先暫存在這裡。到期前都可以還原，超過保留時間後會永久刪除。',
        back: '回到紀錄庫',
        retention: '自動刪除時間',
        days: '天',
        save: '保存時間',
        cleanExpired: '立即清理過期項目',
        saved: '保留時間已保存。',
        cleaned: (count: number) => `已永久刪除 ${count} 筆過期紀錄。`,
        emptyTitle: '垃圾桶是空的',
        emptyHint: '在紀錄庫把卡片拖到左下角垃圾桶後，會先暫存在這裡。',
        restored: '紀錄已還原。',
        deleted: '紀錄已永久刪除。',
        restore: '還原',
        deleteNow: '立即永久刪除',
        confirmDelete: '確定要永久刪除這筆紀錄與本機檔案嗎？',
        movedAt: '移入時間',
        expiresAt: '到期時間',
        left: (days: number | null) => (days == null ? '—' : days === 0 ? '今天到期' : `剩 ${days} 天`),
        assets: 'assets',
        noPreview: '沒有預覽',
        uncategorized: '未分類',
      };
}

export default function App() {
  const [settings, setSettings] = useState<DisplaySettings>(DEFAULT_SETTINGS);
  const [retentionDraft, setRetentionDraft] = useState(String(DEFAULT_SETTINGS.trashRetentionDays));
  const [bundles, setBundles] = useState<TrashBundle[]>([]);
  const [categories, setCategories] = useState<RecordCategory[]>([]);
  const [toast, setToast] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    loadSettings().then((loaded) => {
      setSettings(loaded);
      setRetentionDraft(String(loaded.trashRetentionDays));
    });
    onSettingsChanged((next) => {
      setSettings(next);
      setRetentionDraft(String(next.trashRetentionDays));
    });
  }, []);

  const language = resolveLanguage(settings.language);
  const t = UI_TEXT[language];
  const copy = textFor(language);

  const say = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(''), 2200);
  };

  const load = useCallback(async () => {
    const [records, allAssets, cats] = await Promise.all([
      recordRepository.listTrashed(),
      assetRepository.list(),
      categoryRepository.list(),
    ]);
    const assetsByRecord = new Map<string, Asset[]>();
    for (const asset of allAssets) {
      if (!assetsByRecord.has(asset.recordId)) assetsByRecord.set(asset.recordId, []);
      assetsByRecord.get(asset.recordId)!.push(asset);
    }
    setCategories(cats);
    setBundles(
      records
        .slice()
        .sort((a, b) => (b.trashedAt ?? b.updatedAt).localeCompare(a.trashedAt ?? a.updatedAt))
        .map((record) => ({
          record,
          assets: (assetsByRecord.get(record.id) ?? []).slice().sort((a, b) => a.orderIndex - b.orderIndex),
        })),
    );
  }, []);

  useEffect(() => {
    chrome.runtime.sendMessage({ type: 'library/purgeExpiredTrash', payload: {} }).finally(load);
  }, [load]);

  const categoryNames = useMemo(() => new Map(categories.map((category) => [category.id, categoryLabel(category, language)])), [categories, language]);

  const saveRetention = async () => {
    const days = clampRetentionDays(Number(retentionDraft));
    const next = { ...settings, trashRetentionDays: days };
    setBusy(true);
    try {
      await saveSettings(next);
      setSettings(next);
      setRetentionDraft(String(days));
      const result = await chrome.runtime.sendMessage({ type: 'library/purgeExpiredTrash', payload: {} });
      await load();
      say(result?.deletedCount ? copy.cleaned(result.deletedCount) : copy.saved);
    } finally {
      setBusy(false);
    }
  };

  const cleanExpired = async () => {
    setBusy(true);
    try {
      const result = await chrome.runtime.sendMessage({ type: 'library/purgeExpiredTrash', payload: {} });
      await load();
      say(copy.cleaned(result?.deletedCount ?? 0));
    } finally {
      setBusy(false);
    }
  };

  const restoreRecord = async (recordId: string) => {
    await chrome.runtime.sendMessage({ type: 'library/restoreRecord', payload: { recordId } });
    await load();
    say(copy.restored);
  };

  const deleteNow = async (recordId: string) => {
    if (!window.confirm(copy.confirmDelete)) return;
    await chrome.runtime.sendMessage({ type: 'library/deleteRecord', payload: { recordId } });
    await load();
    say(copy.deleted);
  };

  return (
    <main className="trash-page">
      <header className="trash-hero">
        <div>
          <div className="trash-eyebrow"><PrompTraceWordmark className="trash-wordmark" /></div>
          <h1>{copy.title}</h1>
          <p>{copy.subtitle}</p>
        </div>
        <div className="trash-actions">
          <button type="button" onClick={() => { location.href = 'library.html'; }}>
            {copy.back}
          </button>
          <button type="button" className="danger" disabled={busy} onClick={cleanExpired}>
            {copy.cleanExpired}
          </button>
        </div>
      </header>

      <section className="trash-settings card">
        <div>
          <h2>{copy.retention}</h2>
          <p className="muted">{language === 'en-US' ? 'Records older than this in Trash are permanently deleted automatically.' : '待在垃圾桶超過這個天數的紀錄，會由系統自動永久刪除。'}</p>
        </div>
        <div className="trash-retention-control">
          <input
            type="number"
            min={1}
            max={365}
            value={retentionDraft}
            onChange={(e) => setRetentionDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') saveRetention();
            }}
          />
          <span>{copy.days}</span>
          <button type="button" className="primary" disabled={busy} onClick={saveRetention}>
            {copy.save}
          </button>
        </div>
      </section>

      {toast && <div className="trash-toast" role="status">{toast}</div>}

      {bundles.length === 0 ? (
        <section className="trash-empty card">
          <h2>{copy.emptyTitle}</h2>
          <p>{copy.emptyHint}</p>
        </section>
      ) : (
        <section className="trash-list" aria-label={copy.title}>
          {bundles.map((bundle) => (
            <TrashCard
              key={bundle.record.id}
              bundle={bundle}
              categoryName={bundle.record.categoryId ? categoryNames.get(bundle.record.categoryId) : undefined}
              retentionDays={settings.trashRetentionDays}
              language={language}
              labels={copy}
              onRestore={() => restoreRecord(bundle.record.id)}
              onDeleteNow={() => deleteNow(bundle.record.id)}
            />
          ))}
        </section>
      )}
    </main>
  );
}

function TrashCard({
  bundle,
  categoryName,
  retentionDays,
  language,
  labels,
  onRestore,
  onDeleteNow,
}: {
  bundle: TrashBundle;
  categoryName: string | undefined;
  retentionDays: number;
  language: ResolvedLanguage;
  labels: ReturnType<typeof textFor>;
  onRestore: () => void;
  onDeleteNow: () => void;
}) {
  const { record, assets } = bundle;
  const preview = assets.find((asset) => asset.assetType !== 'text' && (asset.previewRef || asset.originalUrl)) ?? assets.find((asset) => asset.assetType === 'text' && asset.textContent?.trim());
  const expires = expiryDate(record, retentionDays);

  return (
    <article className="trash-card card">
      <div className="trash-card-main">
        <div className="trash-card-preview">
          {preview?.assetType === 'text' ? (
            <div className="trash-text-preview">{preview.textContent?.slice(0, 260)}</div>
          ) : preview ? (
            <img src={preview.previewRef ?? preview.originalUrl} alt="" />
          ) : (
            <div className="trash-no-preview">{labels.noPreview}</div>
          )}
        </div>
        <div className="trash-card-body">
          <div className="trash-card-topline">
            <span className="trash-category-pill">{categoryName ?? labels.uncategorized}</span>
            <span className="muted">{assets.length} {labels.assets}</span>
          </div>
          <h3>{record.title || record.summary || record.sourcePageTitle || (language === 'en-US' ? 'Untitled record' : '未命名紀錄')}</h3>
          {record.summary && <p className="trash-summary">{record.summary}</p>}
          <div className="trash-meta-grid">
            <span>{labels.movedAt}<strong>{formatDate(record.trashedAt, language)}</strong></span>
            <span>{labels.expiresAt}<strong>{expires ? formatDate(expires.toISOString(), language) : '—'}</strong></span>
            <span><strong>{labels.left(daysLeft(record, retentionDays))}</strong></span>
          </div>
        </div>
      </div>
      <div className="trash-card-actions">
        <button type="button" className="primary" onClick={onRestore}>{labels.restore}</button>
        <button type="button" className="danger" onClick={onDeleteNow}>{labels.deleteNow}</button>
      </div>
    </article>
  );
}
