import type { AssetRole, AssetType } from './domain/enums';
import type { CaptureSessionState } from './capture/session';

/**
 * Message contract between content script, background, popup and pages.
 * All messages go through chrome.runtime.sendMessage / onMessage.
 */

export type CreatePendingAssetMessage = {
  type: 'capture/createPendingAsset';
  payload: {
    tabId?: number;
    pageUrl: string;
    pageTitle: string;
    assetType: AssetType;
    textContent?: string;
    originalUrl?: string;
    /** Pre-assigned role (selection toolbar / hotkey capture). */
    role?: AssetRole | null;
    /** Pending-asset id of an existing item whose DOM range intersects. */
    domOverlapWith?: string | null;
    capturedAt: string;
  };
};

export type AssignAssetRoleMessage = {
  type: 'capture/assignAssetRole';
  payload: { pendingAssetId: string; role: AssetRole };
};

export type AddManualCaptureAssetMessage = {
  type: 'capture/addManualAsset';
  payload: {
    assetType: Extract<AssetType, 'text' | 'image'>;
    role: AssetRole;
    textContent?: string;
    originalUrl?: string;
    pageUrl: string;
    pageTitle: string;
    capturedAt: string;
  };
};

export type RemoveAssetMessage = {
  type: 'capture/removeAsset';
  payload: { pendingAssetId: string };
};

export type ClearCaptureSessionMessage = {
  type: 'capture/clearSession';
  payload: Record<string, never>;
};

export type SetWizardStageMessage = {
  type: 'capture/setWizardStage';
  payload: { stage: CaptureSessionState['wizardStage'] };
};

export type CommitCaptureSessionMessage = {
  type: 'capture/commitSession';
  payload: {
    categoryId?: string | null;
    title?: string;
  };
};

export type ResolveConflictMessage = {
  type: 'capture/resolveConflict';
  payload: { conflictId: string; resolution: 'replace' | 'cancel' };
};

export type DismissErrorMessage = {
  type: 'capture/dismissError';
  payload: { errorId: string; action: 'retry' | 'save_source_only' | 'cancel' };
};

export type GetSessionMessage = {
  type: 'capture/getSession';
  payload: Record<string, never>;
};

/** Background → content (in-page edge panel) broadcast after every state change. */
export type SessionUpdatedMessage = {
  type: 'capture/sessionUpdated';
  payload: { state: CaptureSessionState };
};

/** Library page → background: retry/delete a downloaded file. */
export type RetryDownloadMessage = {
  type: 'media/retryDownload';
  payload: { fileRecordId: string };
};

export type DeleteRecordFilesMessage = {
  type: 'media/deleteRecordFiles';
  payload: { recordId: string };
};

/** Background → all: a file record changed (download progress etc). */
export type FileRecordChangedMessage = {
  type: 'media/fileRecordChanged';
  payload: { fileRecordId: string };
};

/** Content script / popup → background: open an extension page from extension context. */
export type OpenExtensionPageMessage = {
  type: 'navigation/openExtensionPage';
  payload: {
    page: 'library' | 'settings';
    hash?: string;
  };
};

/** Content script → background: highlight request was handled. */
export type FlashOverlayMessage = {
  type: 'overlay/flash';
  payload: { pendingAssetId: string };
};

/** Content script → background: fetch categories + model presets for the in-page wizard. */
export type TaxonomyGetMessage = {
  type: 'taxonomy/get';
  payload: Record<string, never>;
};

export type TaxonomyQuickAddCategoryMessage = {
  type: 'taxonomy/quickAddCategory';
  payload: { name: string };
};

/** A saved asset, slimmed for the in-page gallery. */
export type GalleryAsset = {
  role: AssetRole;
  assetType: AssetType;
  textContent?: string;
  originalUrl?: string;
  /** Durable local data: URL thumbnail; survives remote URL expiry / page CSP. */
  previewRef?: string;
};

/** A saved record, slimmed for the in-page gallery. */
export type GalleryRecord = {
  id: string;
  title?: string;
  summary?: string;
  categoryId?: string | null;
  categoryName?: string;
  createdAt: string;
  assets: GalleryAsset[];
};

/** Content script → background: list saved records for the in-page gallery. */
export type ListRecordsMessage = {
  type: 'library/listRecords';
  payload: Record<string, never>;
};

export type ListRecordsResult = { records: GalleryRecord[] };

/** Content script → background: delete a saved record (cascade + local files). */
export type DeleteRecordMessage = {
  type: 'library/deleteRecord';
  payload: { recordId: string };
};

/** Content script → background: re-tag a saved record's category. */
export type UpdateRecordMetaMessage = {
  type: 'library/updateRecordMeta';
  payload: {
    recordId: string;
    categoryId?: string | null;
  };
};

export type AddRecordTextAssetMessage = {
  type: 'library/addRecordTextAsset';
  payload: {
    recordId: string;
    textContent: string;
    role: AssetRole;
  };
};

export type AddRecordMediaAssetMessage = {
  type: 'library/addRecordMediaAsset';
  payload: {
    recordId: string;
    assetType: 'image';
    originalUrl: string;
    previewRef?: string;
    role: AssetRole;
  };
};

export type SummarizeRecordMessage = {
  type: 'summary/summarizeRecord';
  payload: { recordId: string };
};

export type RunAutoSummaryMessage = {
  type: 'summary/runAuto';
  payload: Record<string, never>;
};

export type ExtensionMessage =
  | CreatePendingAssetMessage
  | AssignAssetRoleMessage
  | AddManualCaptureAssetMessage
  | RemoveAssetMessage
  | ClearCaptureSessionMessage
  | SetWizardStageMessage
  | CommitCaptureSessionMessage
  | ResolveConflictMessage
  | DismissErrorMessage
  | GetSessionMessage
  | SessionUpdatedMessage
  | RetryDownloadMessage
  | DeleteRecordFilesMessage
  | FileRecordChangedMessage
  | OpenExtensionPageMessage
  | FlashOverlayMessage
  | TaxonomyGetMessage
  | TaxonomyQuickAddCategoryMessage
  | ListRecordsMessage
  | DeleteRecordMessage
  | UpdateRecordMetaMessage
  | AddRecordTextAssetMessage
  | AddRecordMediaAssetMessage
  | SummarizeRecordMessage
  | RunAutoSummaryMessage;

export function sendMessage<T = unknown>(message: ExtensionMessage): Promise<T> {
  return chrome.runtime.sendMessage(message);
}
