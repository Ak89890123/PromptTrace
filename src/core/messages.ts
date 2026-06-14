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
    modelPresetId?: string | null;
    modelProvider?: string;
    modelName?: string;
    modelVersion?: string;
    modelLabel?: string;
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
};

/** A saved record, slimmed for the in-page gallery. */
export type GalleryRecord = {
  id: string;
  title?: string;
  categoryName?: string;
  modelLabel?: string;
  createdAt: string;
  assets: GalleryAsset[];
};

/** Content script → background: list saved records for the in-page gallery. */
export type ListRecordsMessage = {
  type: 'library/listRecords';
  payload: Record<string, never>;
};

export type ListRecordsResult = { records: GalleryRecord[] };

export type ExtensionMessage =
  | CreatePendingAssetMessage
  | AssignAssetRoleMessage
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
  | FlashOverlayMessage
  | TaxonomyGetMessage
  | TaxonomyQuickAddCategoryMessage
  | ListRecordsMessage;

export function sendMessage<T = unknown>(message: ExtensionMessage): Promise<T> {
  return chrome.runtime.sendMessage(message);
}
