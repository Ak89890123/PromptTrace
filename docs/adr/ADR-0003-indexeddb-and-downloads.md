# ADR-0003：使用 IndexedDB + chrome.downloads

## Status

Superseded by [ADR-0005](ADR-0005-indexeddb-canonical-media-previews.md). This file records the historical v1 decision only; it is not the current runtime contract.

Accepted（2026-06-12）

## Context

需要保存兩類資料：(1) 結構化資料 — record、asset、分類樹、model preset、tag、檔案索引；(2) 媒體檔案 — 圖片與（部分可下載的）影片。

候選方案：

- 結構化：chrome.storage.local（簡單但無 index、5MB 級配額）vs IndexedDB（有 index、可放大量文字與 data URL）。
- 媒體：File System Access API（需使用者每次授權、MV3 service worker 支援差）vs OPFS（檔案藏在瀏覽器內部，使用者看不到）vs chrome.downloads（檔案落在使用者看得到的 Downloads 資料夾）。

## Decision

- **結構化資料用 IndexedDB**（7 個 stores、version 1 migration、明確 indexes）。chrome.storage.local 只放輕量 UI settings。
- **媒體用 chrome.downloads** 下載到固定子資料夾 `Downloads/PrompTrace/{recordId}/`，用 FileRecord 追蹤 downloadId / localPath / 狀態，刪除時用 `downloads.removeFile`。

## Consequences

- ✅ Library 查詢（分類、model、角色、時間）有 index 支撐。
- ✅ 檔案在使用者自己的 Downloads 資料夾，可直接用檔案總管管理，不被 extension 綁架。
- ✅ `downloads.removeFile` 讓「刪 Record 連動刪檔」成為可能，且只限 extension 自己下載的檔案。
- ❌ 無法寫入任意資料夾（接受：是安全邊界，不是缺陷）。
- ❌ blob / 串流 / DRM 影片拿不到 URL，無法下載（接受：以 Error Card + 只保存來源 fallback 處理，README 明確不承諾）。
- ❌ 使用者手動移動檔案後 localPath 失效（接受：標記 file_not_found，提示手動處理）。
