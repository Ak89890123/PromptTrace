import type { AssetRole, AssetType, DeleteStatus, DownloadStatus } from './enums';

export type RecordCategory = {
  id: string;
  parentId?: string | null;
  name: string;
  slug?: string;
  color?: string;
  icon?: string;
  isBuiltin: boolean;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type ModelPreset = {
  id: string;
  categoryId?: string | null;
  provider?: string;
  modelName: string;
  modelVersion?: string;
  alias?: string;
  isActive: boolean;
  isDefault: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type LibraryRecord = {
  id: string;
  categoryId?: string | null;
  modelPresetId?: string | null;

  modelProvider?: string;
  modelName?: string;
  modelVersion?: string;
  modelLabel?: string;

  title?: string;
  notes?: string;
  sourcePageUrl?: string;
  sourcePageTitle?: string;

  createdAt: string;
  updatedAt: string;
};

export type Asset = {
  id: string;
  recordId: string;
  assetType: AssetType;
  role: AssetRole;

  textContent?: string;
  originalUrl?: string;
  previewRef?: string;

  pageUrl?: string;
  pageTitle?: string;

  orderIndex: number;
  capturedAt: string;
};

export type FileRecord = {
  id: string;
  assetId: string;

  filename: string;
  localPath?: string;
  downloadId?: number;

  mimeType?: string;
  fileSize?: number;

  downloadStatus: DownloadStatus;
  deleteStatus: DeleteStatus;

  downloadedAt?: string;
  updatedAt: string;
};

export type Tag = {
  id: string;
  recordId: string;
  name: string;
};

export type ExportRecordEntry = {
  id: string;
  recordId: string;
  format: 'markdown' | 'json';
  exportedAt: string;
};

/** A capture-session asset that has not been committed to the library yet. */
export type PendingAsset = {
  id: string;
  assetType: AssetType;
  role: AssetRole | null; // null = pending (not yet classified)
  textContent?: string;
  originalUrl?: string;
  pageUrl: string;
  pageTitle: string;
  tabId?: number;
  capturedAt: string;
  /** Set when media capture failed but the user chose to keep the source. */
  sourceOnly?: boolean;
};
