export type ErrorType =
  | 'MEDIA_URL_NOT_FOUND'
  | 'MEDIA_DOWNLOAD_FAILED'
  | 'DOWNLOAD_PERMISSION_DENIED'
  | 'DOWNLOAD_INTERRUPTED'
  | 'FILE_DELETE_FAILED'
  | 'FILE_NOT_FOUND'
  | 'STORAGE_WRITE_FAILED'
  | 'CLIPBOARD_WRITE_FAILED';

export type CaptureError = {
  id: string;
  errorType: ErrorType;
  /** Where it happened, e.g. 'content-script', 'background/download', 'library'. */
  location: string;
  sourceUrl?: string;
  /** The pending asset or asset this error relates to, if any. */
  assetId?: string;
  message: string;
  probableCause: string;
  suggestedAction: string;
  /** Whether the "save source only" fallback makes sense for this error. */
  canSaveSourceOnly: boolean;
  canRetry: boolean;
  occurredAt: string;
};

export const ERROR_INFO: Record<
  ErrorType,
  { message: string; probableCause: string; suggestedAction: string }
> = {
  MEDIA_URL_NOT_FOUND: {
    message: '無法取得媒體的可下載 URL。',
    probableCause: '影片/圖片使用 blob、MediaSource 串流、DRM，或由 player 動態組合。',
    suggestedAction: '可改為只保存來源頁面連結，或改用網站提供的下載功能。',
  },
  MEDIA_DOWNLOAD_FAILED: {
    message: '媒體下載失敗。',
    probableCause: '跨域限制、需要登入授權、或伺服器拒絕直接下載。',
    suggestedAction: '可重試，或只保存來源連結。',
  },
  DOWNLOAD_PERMISSION_DENIED: {
    message: '瀏覽器拒絕了下載。',
    probableCause: 'Chrome 下載權限被使用者或政策封鎖。',
    suggestedAction: '檢查 Chrome 的下載設定後重試。',
  },
  DOWNLOAD_INTERRUPTED: {
    message: '下載中斷。',
    probableCause: '網路中斷、檔案來源失效，或使用者取消了下載。',
    suggestedAction: '可重試下載。',
  },
  FILE_DELETE_FAILED: {
    message: '無法刪除本地檔案。',
    probableCause: '檔案被佔用、已被移動，或瀏覽器沒有刪除權限。',
    suggestedAction: '請手動刪除該檔案；Record 內仍會保留檔案資訊。',
  },
  FILE_NOT_FOUND: {
    message: '找不到本地檔案。',
    probableCause: '檔案已被移動、重新命名或刪除。',
    suggestedAction: '可從 Library 移除此檔案紀錄，或手動確認檔案位置。',
  },
  STORAGE_WRITE_FAILED: {
    message: '寫入本地資料庫失敗。',
    probableCause: 'IndexedDB 配額不足或瀏覽器儲存異常。',
    suggestedAction: '清理瀏覽器儲存空間後重試。',
  },
  CLIPBOARD_WRITE_FAILED: {
    message: '寫入剪貼簿失敗。',
    probableCause: '目標內容格式不被支援，或頁面缺少剪貼簿權限。',
    suggestedAction: '改用 Floating Copy Tray 逐項複製。',
  },
};

export function createCaptureError(
  errorType: ErrorType,
  location: string,
  extras: Partial<Pick<CaptureError, 'sourceUrl' | 'assetId' | 'canSaveSourceOnly' | 'canRetry'>> = {},
): CaptureError {
  const info = ERROR_INFO[errorType];
  return {
    id: crypto.randomUUID(),
    errorType,
    location,
    message: info.message,
    probableCause: info.probableCause,
    suggestedAction: info.suggestedAction,
    canSaveSourceOnly: extras.canSaveSourceOnly ?? false,
    canRetry: extras.canRetry ?? true,
    sourceUrl: extras.sourceUrl,
    assetId: extras.assetId,
    occurredAt: new Date().toISOString(),
  };
}

/** Map a chrome.downloads interrupt reason / error string to our error model. */
export function mapDownloadError(reason: string | undefined): ErrorType {
  const r = (reason ?? '').toUpperCase();
  if (r.includes('FORBIDDEN') || r.includes('UNAUTHORIZED') || r.includes('USER_BLOCKED')) {
    return 'DOWNLOAD_PERMISSION_DENIED';
  }
  if (r.includes('INTERRUPT') || r.includes('NETWORK') || r.includes('USER_CANCELED') || r.includes('CRASH')) {
    return 'DOWNLOAD_INTERRUPTED';
  }
  return 'MEDIA_DOWNLOAD_FAILED';
}
