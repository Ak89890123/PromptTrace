import type { Asset, FileRecord, LibraryRecord, ModelPreset, RecordCategory, Tag } from '../domain/entities';
import { createZip, readZip, type ZipEntry } from './zip';

export const PROMPTTRACE_BACKUP_VERSION = 1;
export const PROMPTTRACE_MANIFEST_PATH = 'prompttrace-manifest.json';
export const PROMPTTRACE_RECORDS_PATH = 'records.json';

export type BackupMediaEntry = {
  assetId: string;
  fileRecordId: string;
  recordId: string;
  path: string;
  filename: string;
  mimeType?: string;
  source: 'original' | 'preview' | 'data-url';
};

export type PromptTraceBackupData = {
  records: LibraryRecord[];
  assets: Asset[];
  fileRecords: FileRecord[];
  tags: Tag[];
  categories: RecordCategory[];
  modelPresets: ModelPreset[];
  media: BackupMediaEntry[];
};

export type PromptTraceBackupManifest = {
  format: 'prompttrace-backup';
  version: typeof PROMPTTRACE_BACKUP_VERSION;
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
  return `prompttrace-backup-${date.toISOString().slice(0, 10)}.zip`;
}

export async function createPromptTraceBackupZip(data: PromptTraceBackupData, mediaFiles: Map<string, Blob>): Promise<Blob> {
  const manifest: PromptTraceBackupManifest = {
    format: 'prompttrace-backup',
    version: PROMPTTRACE_BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    counts: {
      records: data.records.length,
      assets: data.assets.length,
      mediaFiles: mediaFiles.size,
    },
  };
  const entries: ZipEntry[] = [
    {
      path: PROMPTTRACE_MANIFEST_PATH,
      data: JSON.stringify(manifest, null, 2),
    },
    {
      path: PROMPTTRACE_RECORDS_PATH,
      data: JSON.stringify(data, null, 2),
    },
  ];
  for (const [path, file] of mediaFiles) entries.push({ path, data: file });
  return createZip(entries);
}

export async function parsePromptTraceBackupZip(file: Blob): Promise<ParsedPromptTraceBackup> {
  const files = await readZip(file);
  const manifestFile = files.get(PROMPTTRACE_MANIFEST_PATH);
  const recordsFile = files.get(PROMPTTRACE_RECORDS_PATH);
  if (!manifestFile || !recordsFile) throw new Error('PROMPTTRACE_BACKUP_MISSING_METADATA');

  const manifest = JSON.parse(await manifestFile.text()) as PromptTraceBackupManifest;
  if (manifest.format !== 'prompttrace-backup' || manifest.version !== PROMPTTRACE_BACKUP_VERSION) {
    throw new Error('PROMPTTRACE_BACKUP_UNSUPPORTED_VERSION');
  }
  const data = JSON.parse(await recordsFile.text()) as PromptTraceBackupData;
  if (!Array.isArray(data.records) || !Array.isArray(data.assets) || !Array.isArray(data.fileRecords)) {
    throw new Error('PROMPTTRACE_BACKUP_INVALID_RECORDS');
  }
  return { manifest, data, files };
}

export function sanitizeBackupFileRecord(fileRecord: FileRecord): FileRecord {
  return {
    ...fileRecord,
    localPath: undefined,
    downloadId: undefined,
    downloadStatus: fileRecord.downloadStatus === 'not_required' ? 'not_required' : 'pending',
    updatedAt: new Date().toISOString(),
  };
}
