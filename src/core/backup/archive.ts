import type { Asset, FileRecord, LibraryRecord, RecordCategory, Tag } from '../domain/entities';
import { isDataUrl } from '../media/dataUrl';
import { createZip, readZip, type ZipEntry } from './zip';

export const PROMPTTRACE_BACKUP_VERSION = 2;
export const PROMPTTRACE_MANIFEST_PATH = 'promptrace-manifest.json';
export const LEGACY_PROMPTTRACE_MANIFEST_PATH = 'prompttrace-manifest.json';
export const PROMPTTRACE_RECORDS_PATH = 'records.json';
const PROMPTTRACE_MEDIA_PATH_ROOT = 'media';
const BACKUP_PATH_SEGMENT_FORBIDDEN = /[<>:"/\\|?*\u0000-\u001f]/;
const WINDOWS_RESERVED_FILENAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

export type BackupMediaEntry = {
  assetId: string;
  recordId: string;
  path: string;
  mimeType?: string;
  byteSize?: number;
  sha256?: string;
  /** v1 compatibility fields. They are never emitted by v2 exports. */
  fileRecordId?: string;
  filename?: string;
  source?: 'original' | 'preview' | 'data-url';
};

export type PromptTraceBackupData = {
  records: LibraryRecord[];
  assets: Asset[];
  tags: Tag[];
  categories: RecordCategory[];
  media: BackupMediaEntry[];
  /** Present only in v1 archives; v2 never writes synthetic FileRecords. */
  fileRecords?: FileRecord[];
};

export type PromptTraceBackupManifest = {
  format: 'promptrace-backup' | 'prompttrace-backup';
  version: 1 | 2;
  exportedAt: string;
  counts: {
    records: number;
    assets: number;
    mediaFiles: number;
  };
};

export type ParsedPromptTraceBackup = {
  manifest: PromptTraceBackupManifest;
  data: PromptTraceBackupData;
  files: Map<string, Blob>;
};

export function backupFilename(date = new Date()): string {
  return `promptrace-backup-${date.toISOString().slice(0, 10)}.zip`;
}

function assertSafeBackupPathSegment(value: string, errorCode: string): void {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value !== value.trim() ||
    value === '.' ||
    value === '..' ||
    BACKUP_PATH_SEGMENT_FORBIDDEN.test(value) ||
    WINDOWS_RESERVED_FILENAME.test(value) ||
    /[. ]$/.test(value)
  ) {
    throw new Error(errorCode);
  }
}

/** Legacy helper retained for reading v1 metadata; it no longer drives downloads. */
export function promptTraceBackupMediaDownloadFilename(entry: BackupMediaEntry): string {
  assertSafeBackupPathSegment(entry.recordId, 'PROMPTTRACE_BACKUP_INVALID_MEDIA_RECORD_ID');
  assertSafeBackupPathSegment(entry.filename ?? '', 'PROMPTTRACE_BACKUP_INVALID_MEDIA_FILENAME');
  return `PrompTrace/${entry.recordId}/${entry.filename}`;
}

export function promptTraceBackupMediaPath(entry: Pick<BackupMediaEntry, 'recordId' | 'assetId' | 'mimeType'>): string {
  assertSafeBackupPathSegment(entry.recordId, 'PROMPTTRACE_BACKUP_INVALID_MEDIA_RECORD_ID');
  assertSafeBackupPathSegment(entry.assetId, 'PROMPTTRACE_BACKUP_INVALID_MEDIA_ASSET_ID');
  const extension = entry.mimeType === 'image/gif' ? 'gif' : 'webp';
  return `${PROMPTTRACE_MEDIA_PATH_ROOT}/${entry.recordId}/${entry.assetId}.${extension}`;
}

function assertNoDataUrls(assets: Asset[]): void {
  for (const asset of assets) {
    if (isDataUrl(asset.originalUrl) || isDataUrl(asset.previewRef)) {
      throw new Error('PROMPTTRACE_BACKUP_DATA_URL_IN_METADATA');
    }
  }
}

function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (value) => value.toString(16).padStart(2, '0')).join('');
}

export async function sha256Blob(blob: Blob): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()));
}

function validateV1Media(data: PromptTraceBackupData): void {
  if (!Array.isArray(data.fileRecords)) throw new Error('PROMPTTRACE_BACKUP_INVALID_RECORDS');
  if (new Set(data.media.map((entry) => entry.assetId)).size !== data.media.length) throw new Error('PROMPTTRACE_BACKUP_DUPLICATE_MEDIA_ASSET_ID');
  for (const entry of data.media) {
    const asset = data.assets.find((candidate) => candidate.id === entry.assetId);
    if (!asset || asset.recordId !== entry.recordId) throw new Error('PROMPTTRACE_BACKUP_INVALID_MEDIA_REFERENCE');
    promptTraceBackupMediaDownloadFilename(entry);
    const expectedPath = `${PROMPTTRACE_MEDIA_PATH_ROOT}/${entry.recordId}/${entry.filename}`;
    if (entry.path !== expectedPath) throw new Error('PROMPTTRACE_BACKUP_INVALID_MEDIA_PATH');
  }
}

function validateV2Media(data: PromptTraceBackupData): void {
  if (new Set(data.media.map((entry) => entry.assetId)).size !== data.media.length) throw new Error('PROMPTTRACE_BACKUP_DUPLICATE_MEDIA_ASSET_ID');
  for (const entry of data.media) {
    const asset = data.assets.find((candidate) => candidate.id === entry.assetId);
    if (!asset || asset.recordId !== entry.recordId) throw new Error('PROMPTTRACE_BACKUP_INVALID_MEDIA_REFERENCE');
    const expectedPath = promptTraceBackupMediaPath(entry);
    if (entry.path !== expectedPath) throw new Error('PROMPTTRACE_BACKUP_INVALID_MEDIA_PATH');
    if (!entry.mimeType || !Number.isSafeInteger(entry.byteSize) || (entry.byteSize ?? -1) < 0 || !/^[a-f0-9]{64}$/i.test(entry.sha256 ?? '')) {
      throw new Error('PROMPTTRACE_BACKUP_INVALID_MEDIA_MANIFEST');
    }
    const allowedMime = asset.assetType === 'image' ? entry.mimeType === 'image/webp' : entry.mimeType === 'image/gif' || entry.mimeType === 'image/webp';
    if (!allowedMime) throw new Error('PROMPTTRACE_BACKUP_NON_CANONICAL_MEDIA');
  }
}

export async function createPromptTraceBackupZip(data: PromptTraceBackupData, mediaFiles: Map<string, Blob>): Promise<Blob> {
  if (!Array.isArray(data.records) || !Array.isArray(data.assets) || !Array.isArray(data.media)) {
    throw new Error('PROMPTTRACE_BACKUP_INVALID_RECORDS');
  }
  if (mediaFiles.size !== data.media.length) throw new Error('PROMPTTRACE_BACKUP_MEDIA_COUNT_MISMATCH');
  const mediaAssetIds = new Set(data.media.map((entry) => entry.assetId));
  for (const asset of data.assets) {
    if (asset.assetType !== 'text' && asset.previewRef && isDataUrl(asset.previewRef) && !mediaAssetIds.has(asset.id)) {
      throw new Error('PROMPTTRACE_BACKUP_MEDIA_MISSING');
    }
  }
  const media = [] as BackupMediaEntry[];
  for (const entry of data.media) {
    const path = promptTraceBackupMediaPath(entry);
    const file = mediaFiles.get(path);
    if (!file) throw new Error('PROMPTTRACE_BACKUP_MEDIA_MISSING');
    const mimeType = entry.mimeType ?? file.type;
    const normalized = { ...entry, path, mimeType, byteSize: file.size, sha256: await sha256Blob(file) };
    media.push(normalized);
  }
  const v2Data: PromptTraceBackupData = {
    records: data.records,
    assets: data.assets.map((asset) => ({
      ...asset,
      originalUrl: asset.originalUrl && /^https?:/i.test(asset.originalUrl) ? asset.originalUrl : undefined,
      previewRef: undefined,
      previewStatus: asset.previewRef ? 'ready' : asset.previewStatus,
      previewLeaseUntil: undefined,
      previewClaimToken: undefined,
    })),
    tags: data.tags ?? [],
    categories: data.categories ?? [],
    media,
  };
  validateV2Media(v2Data);
  const manifest: PromptTraceBackupManifest = {
    format: 'promptrace-backup',
    version: 2,
    exportedAt: new Date().toISOString(),
    counts: { records: v2Data.records.length, assets: v2Data.assets.length, mediaFiles: media.length },
  };
  const entries: ZipEntry[] = [
    { path: PROMPTTRACE_MANIFEST_PATH, data: JSON.stringify(manifest, null, 2) },
    { path: PROMPTTRACE_RECORDS_PATH, data: JSON.stringify(v2Data, null, 2) },
  ];
  for (const entry of media) entries.push({ path: entry.path, data: mediaFiles.get(entry.path)! });
  return createZip(entries);
}

export async function parsePromptTraceBackupZip(file: Blob): Promise<ParsedPromptTraceBackup> {
  const files = await readZip(file);
  const manifestFile = files.get(PROMPTTRACE_MANIFEST_PATH) ?? files.get(LEGACY_PROMPTTRACE_MANIFEST_PATH);
  const recordsFile = files.get(PROMPTTRACE_RECORDS_PATH);
  if (!manifestFile || !recordsFile) throw new Error('PROMPTTRACE_BACKUP_MISSING_METADATA');

  const manifest = JSON.parse(await manifestFile.text()) as PromptTraceBackupManifest;
  if (
    (manifest.format !== 'promptrace-backup' && manifest.format !== 'prompttrace-backup') ||
    (manifest.version !== 1 && manifest.version !== 2)
  ) {
    throw new Error('PROMPTTRACE_BACKUP_UNSUPPORTED_VERSION');
  }
  const data = JSON.parse(await recordsFile.text()) as PromptTraceBackupData;
  if (!Array.isArray(data.records) || !Array.isArray(data.assets) || !Array.isArray(data.media)) {
    throw new Error('PROMPTTRACE_BACKUP_INVALID_RECORDS');
  }
  if (
    manifest.counts?.records !== data.records.length ||
    manifest.counts?.assets !== data.assets.length ||
    manifest.counts?.mediaFiles !== data.media.length
  ) {
    throw new Error('PROMPTTRACE_BACKUP_COUNTS_MISMATCH');
  }
  if (manifest.version === 1) validateV1Media(data);
  else {
    if (data.fileRecords) throw new Error('PROMPTTRACE_BACKUP_UNEXPECTED_FILE_RECORDS');
    assertNoDataUrls(data.assets);
    validateV2Media(data);
    for (const entry of data.media) {
      const mediaFile = files.get(entry.path);
      if (!mediaFile) throw new Error('PROMPTTRACE_BACKUP_MEDIA_MISSING');
      if (mediaFile.size !== entry.byteSize! || await sha256Blob(mediaFile) !== entry.sha256?.toLowerCase()) {
        throw new Error('PROMPTTRACE_BACKUP_MEDIA_HASH_MISMATCH');
      }
    }
  }
  return { manifest, data, files };
}

/** v1 compatibility helper; v2 has no FileRecord metadata to sanitize. */
export function sanitizeBackupFileRecord(fileRecord: FileRecord): FileRecord {
  return {
    ...fileRecord,
    localPath: undefined,
    downloadId: undefined,
    downloadStatus: fileRecord.downloadStatus === 'not_required' ? 'not_required' : 'pending',
    updatedAt: new Date().toISOString(),
  };
}
