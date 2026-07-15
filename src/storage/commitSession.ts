import type { Asset, LibraryRecord, PendingAsset } from '../core/domain/entities';
import type { CommitCaptureSessionMessage } from '../core/messages';
import { isDataUrl, validateCanonicalPreviewRef } from '../core/media/dataUrl';
import { DEFAULT_MEDIA_QUALITY, normalizeMediaQuality, type MediaQuality } from '../core/media/quality';
import { commitRecordAndAssets } from './repositories';

/**
 * Filename for a downloaded media asset, guaranteeing a usable extension.
 * Many LLM image URLs end in `/content` (no extension), which Windows then
 * saves as an unopenable extensionless file — fall back to the asset type.
 */
export type CommitResult = {
  record: LibraryRecord;
  assets: Asset[];
  /** Downloadable media that should receive a durable local preview. */
  pendingPreviews: { assetId: string; assetType: 'image' | 'video'; url: string }[];
  /** Media assets without a usable URL (source-only fallback). */
  sourceOnlyAssets: Asset[];
};

/**
 * Turn a capture session into a LibraryRecord + Assets.
 * New captures never create FileRecords or browser downloads. Remote media is
 * represented by a durable preview job on the Asset itself.
 */
export async function commitSessionToLibrary(
  pendingAssets: PendingAsset[],
  meta: CommitCaptureSessionMessage['payload'],
  mediaQuality: MediaQuality = DEFAULT_MEDIA_QUALITY,
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
  const assets: Asset[] = [];
  const pendingPreviews: CommitResult['pendingPreviews'] = [];
  const sourceOnlyAssets: Asset[] = [];
  const normalizedAssets = mergeSameRoleTextAssets(pendingAssets);

  for (let i = 0; i < normalizedAssets.length; i++) {
    const p = normalizedAssets[i];
    const rawDataUrl = p.originalUrl && isDataUrl(p.originalUrl) ? p.originalUrl : undefined;
    if (rawDataUrl && !p.previewRef) throw new Error('MEDIA_DATA_URL_NOT_CANONICAL');
    const preview = p.previewRef && p.assetType !== 'text'
      ? validateCanonicalPreviewRef(p.previewRef, p.assetType)
      : undefined;
    const remoteUrl = p.originalUrl && !rawDataUrl && isDownloadableUrl(p.originalUrl) ? p.originalUrl : undefined;
    const hasRemoteSource = Boolean(remoteUrl);
    const previewStatus = preview
      ? 'ready'
      : hasRemoteSource && !p.sourceOnly
        ? 'pending'
        : undefined;
    const asset: Asset = {
      id: crypto.randomUUID(),
      recordId: record.id,
      assetType: p.assetType,
      role: p.role ?? 'input',
      textContent: p.textContent,
      // Data URLs are input transport only. The canonical preview is the
      // persisted representation; raw bytes never remain in originalUrl.
      originalUrl: rawDataUrl ? undefined : p.originalUrl,
      previewRef: p.assetType !== 'text' ? p.previewRef : undefined,
      previewStatus,
      previewUpdatedAt: preview ? now : undefined,
      previewQuality: p.assetType !== 'text' ? normalizeMediaQuality(mediaQuality) : undefined,
      pageUrl: p.pageUrl,
      pageTitle: p.pageTitle,
      orderIndex: i,
      capturedAt: p.capturedAt,
    };
    assets.push(asset);

    if (p.assetType !== 'text') {
      if (hasRemoteSource && !p.sourceOnly && !preview) {
        pendingPreviews.push({ assetId: asset.id, assetType: p.assetType, url: remoteUrl! });
      } else if (!preview) {
        sourceOnlyAssets.push(asset);
      }
    }
  }

  await commitRecordAndAssets(record, assets);
  return { record, assets, pendingPreviews, sourceOnlyAssets };
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
