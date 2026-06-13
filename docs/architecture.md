# PromptTrace Architecture

## 系統架構

```
┌────────────────────────── Browser tab ──────────────────────────┐
│  Content Script (entrypoints/content.ts)                        │
│   - contextmenu 追蹤（最後右鍵的元素 / selection range）          │
│   - overlay frame 繪製、角色顏色更新、flash、清除                 │
│   - DOM range 重疊偵測 → domOverlapWith                          │
└───────────────▲──────────────────────────┬──────────────────────┘
                │ overlay/* 訊息            │ capture/createPendingAsset
┌───────────────┴──────────────────────────▼──────────────────────┐
│  Background Service Worker (entrypoints/background.ts)          │
│   - contextMenus 註冊與 srcUrl capture                           │
│   - CaptureSession state（單一事實來源）+ broadcast              │
│   - duplicate / overlap 判定（src/core/capture/overlap.ts）      │
│   - commit → src/storage/commitSession.ts                       │
│   - chrome.downloads.download + onChanged 狀態追蹤               │
│   - downloads.removeFile（刪檔 prototype）、錯誤映射             │
└───────▲──────────────────────▲──────────────────┬───────────────┘
        │ sessionUpdated        │ messages          │ IndexedDB
┌───────┴────────┐   ┌─────────┴─────────┐   ┌─────▼──────────────┐
│  Side Panel    │   │ Library Dashboard │   │ IndexedDB v1       │
│  session UI    │   │ Settings Page     │   │ 7 stores + indexes │
│  2-step wizard │   │ （直接讀寫 DB）    │   └────────────────────┘
└────────────────┘   └───────────────────┘
```

## 模組責任

| 模組 | 責任 |
| --- | --- |
| `src/core/domain` | entities、enums、role 規則、分類樹 / model 驗證、safeFilename |
| `src/core/capture` | session state reducer、duplicate / overlap 偵測（純函式） |
| `src/core/export` | Markdown / JSON export |
| `src/core/copy-bundle` | Input / Output / Full Record bundle 組合 + tray fallback 判定 |
| `src/core/errors` | Error model（技術錯誤）與 Conflict model（使用者操作衝突），嚴格分離 |
| `src/storage` | IndexedDB 開啟 + version 1 migration、repositories、seed、commit service |
| `src/ui` | role colors、DisplaySettings（chrome.storage.local）、共用 hooks / CSS |
| `entrypoints/background` | contextMenus、session 單一事實來源、downloads、訊息路由 |
| `entrypoints/content` | overlay frame、選取 capture、DOM overlap |
| `entrypoints/sidepanel` | session 顯示、角色指定、X / ✓、wizard、Error / Conflict Card |
| `entrypoints/library` | record list / detail、篩選搜尋、補資產、copy / export / delete |
| `entrypoints/settings` | 分類樹管理、model presets、顏色、開關、匯出偏好、權限說明 |

## 資料流

1. **Capture**：使用者右鍵 → background 收到 contextMenus.onClicked → 文字走 content script 取得 selection + overlap 資訊；媒體直接用 `info.srcUrl`（無 srcUrl → Error Card）。
2. **Session**：background 把 PendingAsset 加進 in-memory session，broadcast `capture/sessionUpdated` 給 side panel 與 content script（畫框）。
3. **Role**：side panel 發 `capture/assignAssetRole` → background 驗證 role 規則（圖/影 Negative → Conflict）→ 更新 state → content script 改框色。
4. **Commit**：wizard 兩步後發 `capture/commitSession` → `commitSessionToLibrary()` 寫入 LibraryRecord / Asset / FileRecord → background 對每個 pending download 呼叫 `chrome.downloads.download`。
5. **Download tracking**：`downloads.onChanged` → 依 downloadId 找 FileRecord → completed（補 localPath / mime / size）或 failed（Error Card + 可重試）。
6. **Library**：extension page 與 service worker 同 origin，直接讀寫同一個 IndexedDB。

## IndexedDB Schema（version 1）

| Store | keyPath | Indexes |
| --- | --- | --- |
| recordCategories | id | parentId, isActive, sortOrder |
| modelPresets | id | categoryId, isActive, sortOrder |
| libraryRecords | id | categoryId, modelPresetId, createdAt, updatedAt |
| assets | id | recordId, assetType, role, capturedAt |
| fileRecords | id | assetId, downloadId, downloadStatus, deleteStatus |
| tags | id | recordId, name |
| exportRecords | id | recordId |

Migration 在 `src/storage/db.ts` 的 `migrate(db, oldVersion)`；未來 schema 變更 bump `DB_VERSION` 並加 if-block。

## Message Contract

定義於 `src/core/messages.ts`（`ExtensionMessage` union）：

- `capture/createPendingAsset`、`capture/assignAssetRole`、`capture/removeAsset`
- `capture/clearSession`、`capture/setWizardStage`、`capture/commitSession`
- `capture/resolveConflict`、`capture/dismissError`、`capture/getSession`
- `capture/sessionUpdated`（broadcast）
- `media/retryDownload`、`media/deleteRecordFiles`、`media/fileRecordChanged`

另有 background → content 的 `overlay/*` 訊息（captureSelection、markMedia、assetAdded、roleChanged、removeFrame、replaceFrame、clearAll、flash），屬於 content script 的內部協議。

## Download Flow

```
commit → FileRecord(status: pending)
       → chrome.downloads.download({ url, filename: PromptTrace/{recordId}/{assetId前8}-{safe} })
       → status: downloading
       → onChanged complete  → status: completed（補 localPath）
       → onChanged interrupted / error → status: failed → Error Card（重試 / 只保存來源）
blob:/MediaSource URL → 不嘗試下載 → source-only asset（record 照常建立）
```

## Delete Flow

1. 只刪 Record：`deleteRecordCascade()` 在單一 transaction 刪 record + assets + fileRecords + tags。
2. 連同檔案：先發 `media/deleteRecordFiles` → background 對每個有 downloadId 的 FileRecord 呼叫 `downloads.removeFile`，失敗標 `delete_failed` / `file_not_found`，再 cascade 刪資料。檔案刪除失敗不會阻止資料刪除，但會提示手動處理。

## Error Model vs Conflict Model

- **Error**（`CaptureError`）：技術失敗（下載、儲存、剪貼簿）。卡片含錯誤類型、位置、來源 URL、可能原因、建議、重試 / 只保存來源 / 取消。
- **Conflict**（`CaptureConflict`）：使用者操作衝突（重複選取、重疊選取、角色不允許）。卡片含原 / 新選取 preview 與「取代 / 取消」。
- 兩者型別、UI 卡片、處理路徑完全分離。

## Trade-offs

- **Session state 放 background in-memory**：單一事實來源、訊息簡單；代價是 MV3 service worker 被回收時未 commit 的 session 會遺失（可接受：session 本來就是暫存）。
- **Library / Settings 直接讀 IndexedDB** 而不是全部走訊息：減少樣板，extension pages 與 SW 同 origin 安全；代價是寫入路徑有兩條（commit 走 SW、補充編輯走 page）。
- **拖放 / 上傳的本地媒體存成 data URL**（IndexedDB 內）：避免要求任意檔案系統權限；代價是大檔案會佔配額，UI 有提示。
- **overlap 偵測雙層**：DOM range 比對（準）+ 正規化文字包含比對（DOM 失效時的 fallback）。
