import type { Asset, FileRecord, LibraryRecord, PendingAsset } from '../core/domain/entities';
import type { CommitCaptureSessionMessage } from '../core/messages';
import { safeFilename } from '../core/domain/validation';
import { assetRepository, fileRecordRepository, recordRepository } from './repositories';
import { DEFAULT_MEDIA_STORAGE_POLICY, type MediaStoragePolicy } from '../core/media/storagePolicy';

const MEDIA_EXT: Record<'image' | 'video', string> = { image: 'png', video: 'mp4' };

/**
 * Filename for a downloaded media asset, guaranteeing a usable extension.
 * Many LLM image URLs end in `/content` (no extension), which Windows then
 * saves as an unopenable extensionless file — fall back to the asset type.
 */
export function mediaFilename(url: string, assetType: 'image' | 'video'): string {
  const name = safeFilename(url, assetType);
  if (/\.[A-Za-z0-9]{2,5}$/.test(name)) return name;
  return `${name}.${MEDIA_EXT[assetType]}`;
}

export type CommitResult = {
  record: LibraryRecord;
  assets: Asset[];
  /** Media file records that need a download attempt (status 'pending'). */
  pendingDownloads: { fileRecord: FileRecord; url: string; mode: 'original' | 'image-webp' }[];
  /** Downloadable media that should receive a durable local preview. */
  pendingPreviews: { assetId: string; assetType: 'image' | 'video'; url: string }[];
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
  mediaStorage: MediaStoragePolicy = DEFAULT_MEDIA_STORAGE_POLICY,
): Promise<CommitResult> {
  const now = new Date().toISOString();
  const first = pendingAssets[0];
  const record: LibraryRecord = {
    id: crypto.randomUUID(),
    categoryId: meta.categoryId ?? null,
    title: meta.title,
    sourcePageUrl: first?.pageUrl,
    sourcePageTitle: first?.pageTitle,
    createdAt: now,
    updatedAt: now,
  };
  await recordRepository.save(record);

  const assets: Asset[] = [];
  const pendingDownloads: CommitResult['pendingDownloads'] = [];
  const pendingPreviews: CommitResult['pendingPreviews'] = [];
  const sourceOnlyAssets: Asset[] = [];
  const normalizedAssets = mergeSameRoleTextAssets(pendingAssets);

  for (let i = 0; i < normalizedAssets.length; i++) {
    const p = normalizedAssets[i];
    const asset: Asset = {
      id: crypto.randomUUID(),
      recordId: record.id,
      assetType: p.assetType,
      role: p.role ?? 'input',
      textContent: p.textContent,
      originalUrl: p.originalUrl,
      previewRef: p.originalUrl && isDataUrl(p.originalUrl) ? p.originalUrl : undefined,
      pageUrl: p.pageUrl,
      pageTitle: p.pageTitle,
      orderIndex: i,
      capturedAt: p.capturedAt,
    };
    await assetRepository.save(asset);
    assets.push(asset);

    if (p.assetType !== 'text') {
      if (p.originalUrl && !p.sourceOnly && isDownloadableUrl(p.originalUrl)) {
        pendingPreviews.push({ assetId: asset.id, assetType: p.assetType, url: p.originalUrl });
        const shouldDownload = p.assetType === 'image' || mediaStorage.video === 'original';
        if (shouldDownload) {
          const imageWebp = p.assetType === 'image' && mediaStorage.image === 'webp';
          const filename = imageWebp ? `${asset.id.slice(0, 8)}-preview.webp` : `${asset.id.slice(0, 8)}-${mediaFilename(p.originalUrl, p.assetType)}`;
          const fileRecord: FileRecord = {
            id: crypto.randomUUID(),
            assetId: asset.id,
            filename,
            mimeType: imageWebp ? 'image/webp' : undefined,
            downloadStatus: 'pending',
            deleteStatus: 'not_deleted',
            updatedAt: now,
          };
          await fileRecordRepository.save(fileRecord);
          pendingDownloads.push({ fileRecord, url: p.originalUrl, mode: imageWebp ? 'image-webp' : 'original' });
        }
      } else {
        sourceOnlyAssets.push(asset);
      }
    }
  }

  return { record, assets, pendingDownloads, pendingPreviews, sourceOnlyAssets };
}

function mergeSameRoleTextAssets(pendingAssets: PendingAsset[]): PendingAsset[] {
  const mergedTextByRole = new Map<NonNullable<PendingAsset['role']>, PendingAsset>();
  const normalized: PendingAsset[] = [];

  for (const asset of pendingAssets) {
    if (asset.assetType !== 'text' || !asset.textContent?.trim()) {
      normalized.push(asset);
      continue;
    }

    const role = asset.role ?? 'input';
    const text = asset.textContent.trim();
    const existing = mergedTextByRole.get(role);
    if (existing) {
      existing.textContent = `${existing.textContent?.trim() ?? ''}\n\n${text}`;
      continue;
    }

    const mergedAsset = { ...asset, role, textContent: text };
    mergedTextByRole.set(role, mergedAsset);
    normalized.push(mergedAsset);
  }

  return normalized;
}

export function isDownloadableUrl(url: string): boolean {
  return /^https?:/i.test(url);
}

/** Relative download path under the user's Downloads folder. */
export function downloadPathFor(recordId: string, fileRecord: FileRecord): string {
  return `PrompTrace/${recordId}/${fileRecord.filename}`;
}

function isDataUrl(url: string): boolean {
  return /^data:/i.test(url);
}
