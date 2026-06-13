import type { Asset, FileRecord, LibraryRecord, PendingAsset } from '../core/domain/entities';
import type { CommitCaptureSessionMessage } from '../core/messages';
import { safeFilename } from '../core/domain/validation';
import { assetRepository, fileRecordRepository, recordRepository } from './repositories';

export type CommitResult = {
  record: LibraryRecord;
  assets: Asset[];
  /** Media file records that need a download attempt (status 'pending'). */
  pendingDownloads: { fileRecord: FileRecord; url: string }[];
  /** Media assets without a usable URL (source-only fallback). */
  sourceOnlyAssets: Asset[];
};

/**
 * Turn a capture session into a LibraryRecord + Assets + FileRecords.
 * Pure persistence — actually starting chrome.downloads is the caller's job
 * so this stays testable outside the extension runtime.
 */
export async function commitSessionToLibrary(
  pendingAssets: PendingAsset[],
  meta: CommitCaptureSessionMessage['payload'],
): Promise<CommitResult> {
  const now = new Date().toISOString();
  const first = pendingAssets[0];
  const record: LibraryRecord = {
    id: crypto.randomUUID(),
    categoryId: meta.categoryId ?? null,
    modelPresetId: meta.modelPresetId ?? null,
    modelProvider: meta.modelProvider,
    modelName: meta.modelName,
    modelVersion: meta.modelVersion,
    modelLabel: meta.modelLabel,
    title: meta.title,
    sourcePageUrl: first?.pageUrl,
    sourcePageTitle: first?.pageTitle,
    createdAt: now,
    updatedAt: now,
  };
  await recordRepository.save(record);

  const assets: Asset[] = [];
  const pendingDownloads: CommitResult['pendingDownloads'] = [];
  const sourceOnlyAssets: Asset[] = [];

  for (let i = 0; i < pendingAssets.length; i++) {
    const p = pendingAssets[i];
    const asset: Asset = {
      id: crypto.randomUUID(),
      recordId: record.id,
      assetType: p.assetType,
      role: p.role ?? 'input',
      textContent: p.textContent,
      originalUrl: p.originalUrl,
      pageUrl: p.pageUrl,
      pageTitle: p.pageTitle,
      orderIndex: i,
      capturedAt: p.capturedAt,
    };
    await assetRepository.save(asset);
    assets.push(asset);

    if (p.assetType !== 'text') {
      if (p.originalUrl && !p.sourceOnly && isDownloadableUrl(p.originalUrl)) {
        const filename = safeFilename(p.originalUrl, p.assetType);
        const fileRecord: FileRecord = {
          id: crypto.randomUUID(),
          assetId: asset.id,
          filename: `${asset.id.slice(0, 8)}-${filename}`,
          downloadStatus: 'pending',
          deleteStatus: 'not_deleted',
          updatedAt: now,
        };
        await fileRecordRepository.save(fileRecord);
        pendingDownloads.push({ fileRecord, url: p.originalUrl });
      } else {
        sourceOnlyAssets.push(asset);
      }
    }
  }

  return { record, assets, pendingDownloads, sourceOnlyAssets };
}

/** blob:/mediasource URLs cannot be fetched from the background; treat as not downloadable. */
export function isDownloadableUrl(url: string): boolean {
  return /^https?:/i.test(url) || /^data:/i.test(url);
}

/** Relative download path under the user's Downloads folder. */
export function downloadPathFor(recordId: string, fileRecord: FileRecord): string {
  return `PromptTrace/${recordId}/${fileRecord.filename}`;
}
