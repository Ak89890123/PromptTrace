import type { Asset, LibraryRecord, RecordCategory, Tag } from '../core/domain/entities';
import type { ParsedPromptTraceBackup } from '../core/backup/archive';
import { dataUrlToBlob, isDataUrl } from '../core/media/dataUrl';
import { openDb, STORES, tx } from './db';

export type PreparedRestoreData = {
  records: LibraryRecord[];
  assets: Asset[];
  tags: Tag[];
  categories: RecordCategory[];
};

function assertUnique(ids: string[], errorCode: string): void {
  if (new Set(ids).size !== ids.length) throw new Error(errorCode);
}

function validateReferences(data: PreparedRestoreData): void {
  assertUnique(data.records.map((item) => item.id), 'PROMPTTRACE_RESTORE_DUPLICATE_RECORD_ID');
  assertUnique(data.assets.map((item) => item.id), 'PROMPTTRACE_RESTORE_DUPLICATE_ASSET_ID');
  assertUnique(data.tags.map((item) => item.id), 'PROMPTTRACE_RESTORE_DUPLICATE_TAG_ID');
  assertUnique(data.categories.map((item) => item.id), 'PROMPTTRACE_RESTORE_DUPLICATE_CATEGORY_ID');
  const recordIds = new Set(data.records.map((record) => record.id));
  for (const asset of data.assets) {
    if (!recordIds.has(asset.recordId)) throw new Error('PROMPTTRACE_RESTORE_ASSET_RECORD_MISSING');
  }
  for (const tag of data.tags) {
    if (!recordIds.has(tag.recordId)) throw new Error('PROMPTTRACE_RESTORE_TAG_RECORD_MISSING');
  }
}

/**
 * Restore only library metadata and canonical previews in one transaction.
 * The caller must finish all archive validation and media canonicalization
 * before invoking this function.
 */
export async function restorePreparedBackup(data: PreparedRestoreData): Promise<void> {
  validateReferences(data);
  const db = await openDb();
  try {
    await tx(
      db,
      [STORES.recordCategories, STORES.libraryRecords, STORES.assets, STORES.tags],
      'readwrite',
      (transaction) => {
        const categories = transaction.objectStore(STORES.recordCategories);
        const records = transaction.objectStore(STORES.libraryRecords);
        const assets = transaction.objectStore(STORES.assets);
        const tags = transaction.objectStore(STORES.tags);
        for (const category of data.categories) categories.add(category);
        for (const record of data.records) records.add(record);
        for (const asset of data.assets) assets.add(asset);
        for (const tag of data.tags) tags.add(tag);
      },
    );
  } catch (error) {
    if (error instanceof DOMException && (error.name === 'ConstraintError' || error.name === 'AbortError')) {
      throw new Error('PROMPTTRACE_RESTORE_ID_CONFLICT');
    }
    throw error;
  }
}

export type RestoreCanonicalizeMedia = (asset: Asset, source: Blob) => Promise<string>;

/** Convert a parsed v1/v2 archive into a zero-or-one-write restore payload. */
export async function prepareBackupRestore(
  parsed: ParsedPromptTraceBackup,
  canonicalize: RestoreCanonicalizeMedia,
): Promise<{ data: PreparedRestoreData; restoredMedia: number }> {
  const rawAssets = parsed.data.assets;
  const assets: Asset[] = rawAssets.map((asset) => ({
    ...asset,
    originalUrl: asset.originalUrl && /^https?:/i.test(asset.originalUrl) ? asset.originalUrl : undefined,
    previewRef: undefined,
    previewLeaseUntil: undefined,
    previewClaimToken: undefined,
  }));
  const mediaByAssetId = new Map(parsed.data.media.map((entry) => [entry.assetId, entry]));
  const fileRecordById = new Map((parsed.data.fileRecords ?? []).map((fileRecord) => [fileRecord.id, fileRecord]));
  if (mediaByAssetId.size !== parsed.data.media.length) throw new Error('PROMPTTRACE_RESTORE_DUPLICATE_MEDIA_ASSET_ID');
  const assetById = new Map(rawAssets.map((asset) => [asset.id, asset]));
  for (const entry of parsed.data.media) {
    const referencedAsset = assetById.get(entry.assetId);
    if (!referencedAsset || referencedAsset.recordId !== entry.recordId) {
      throw new Error('PROMPTTRACE_RESTORE_MEDIA_REFERENCE_MISSING');
    }
    if (entry.fileRecordId && !fileRecordById.has(entry.fileRecordId)) {
      throw new Error('PROMPTTRACE_RESTORE_MEDIA_FILE_RECORD_MISSING');
    }
  }
  let restoredMedia = 0;

  for (const asset of assets) {
    if (asset.assetType === 'text') continue;
    const entry = mediaByAssetId.get(asset.id);
    const legacyEntry = entry?.fileRecordId ? entry : undefined;
    const rawAsset = rawAssets.find((candidate) => candidate.id === asset.id)!;
    const inlineSource = rawAsset.originalUrl && isDataUrl(rawAsset.originalUrl)
      ? rawAsset.originalUrl
      : rawAsset.previewRef && isDataUrl(rawAsset.previewRef)
        ? rawAsset.previewRef
        : undefined;
    const archiveFile = entry ? parsed.files.get(entry.path) : undefined;
    const mediaFile = archiveFile
      ? entry?.mimeType
        ? new Blob([await archiveFile.arrayBuffer()], { type: entry.mimeType })
        : archiveFile
      : inlineSource
        ? dataUrlToBlob(inlineSource)
        : undefined;
    if (entry && !mediaFile) throw new Error('PROMPTTRACE_RESTORE_MEDIA_FATAL');
    if (mediaFile) {
      try {
        asset.previewRef = await canonicalize(asset, mediaFile);
        asset.previewStatus = 'ready';
        asset.previewUpdatedAt = new Date().toISOString();
        restoredMedia += 1;
      } catch (error) {
        if (parsed.manifest.version === 2) {
          throw new Error('PROMPTTRACE_RESTORE_MEDIA_FATAL');
        }
        if (!legacyEntry || fileRecordById.has(legacyEntry.fileRecordId!)) {
          asset.previewStatus = 'failed';
          asset.previewErrorCode = error instanceof Error ? error.message : String(error);
        } else {
          throw new Error('PROMPTTRACE_RESTORE_MEDIA_FATAL');
        }
      }
    } else if (asset.originalUrl) {
      asset.previewStatus = undefined;
    }
  }

  return {
    data: {
      records: parsed.data.records,
      assets,
      tags: parsed.data.tags ?? [],
      categories: parsed.data.categories ?? [],
    },
    restoredMedia,
  };
}
