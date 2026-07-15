# PrompTrace Architecture

## 系統架構

```text
Browser tab / content script
  └─ capture session messages ─▶ Background service worker
                                  ├─ role/conflict validation
                                  ├─ atomic Record + Asset commit
                                  ├─ durable IndexedDB preview-job claim/lease
                                  ├─ image WebP / video GIF-or-still canonicalization
                                  └─ previewChanged broadcast ─▶ Library / Gallery / Trash

Extension pages (Library / Settings / Trash)
  └─ direct IndexedDB reads and writes on the same extension origin

IndexedDB v2
  ├─ libraryRecords / assets / tags / categories
  ├─ assets.previewRef: canonical local data URL
  └─ legacy fileRecords: read-only compatibility metadata
```

## 模組責任

| 模組 | 責任 |
| --- | --- |
| `src/core/domain` | entities、enums、role 規則與資料驗證 |
| `src/core/media` | Data URL allowlist/byte limits、low/medium/high canonical preview profiles、video frame helpers |
| `src/core/backup` | v2 ZIP manifest/hash validation 與 v1 archive parsing |
| `src/storage` | IndexedDB migration、atomic commit、preview lease fencing、restore transaction |
| `entrypoints/background` | context menus、capture session、preview worker、訊息路由與更新通知 |
| `entrypoints/content` | overlay、選取 capture、右側 Gallery 與 in-page UI |
| `entrypoints/library` | library list/detail、搜尋、角色與紀錄編輯 |
| `entrypoints/settings` | 本機設定、v2 backup export/import、分類管理 |
| `entrypoints/trash` | restore-able trash、retention 與永久 DB deletion |

## Capture 與 preview data flow

1. 使用者擷取文字、圖片或影片；background 以 in-memory session 保存待提交資產。
2. Commit 前，Data URL 經 MIME、格式與 decoded-byte 上限驗證，並透過 canonical pipeline 產生 WebP 或 GIF/still preview；原始 Data URL 不進入 DB。
3. Remote HTTP(S) media 只把來源 URL、`previewStatus: pending` 與捕捉當下的 `previewQuality` 寫入 Asset。Record 與全部 Assets 由單一 IndexedDB transaction 原子提交，絕不建立新 `FileRecord`。
4. Service worker 以 Asset `previewStatus`、`previewClaimToken` 與 60 秒 lease claim job。成功或失敗都以 compare-and-set transaction 寫回；stale worker 無法覆寫新 owner。
5. worker reload/startup 會 reclaim 過期 processing job；確定失敗的 job 進入 `failed`，不做隱藏式自動重試。
6. `media/previewChanged` 通知已開啟的 Library、in-page Gallery 與 Trash 更新畫面；preview 失敗時仍保留可用的來源 URL fallback。

## IndexedDB Schema（version 2）

| Store | 用途 |
| --- | --- |
| `recordCategories`, `modelPresets`, `libraryRecords`, `tags`, `exportRecords` | 既有 metadata stores |
| `assets` | 內容與 canonical preview；`previewQuality` 固定該資產的編碼 preset，`previewStatus` 提供 job index |
| `fileRecords` | v1 legacy download metadata，只讀相容；新流程不寫入 |

`src/storage/db.ts` 以 `DB_VERSION = 2` 建立 `assets.previewStatus` index，並保留 legacy database name migration。所有新 commit 使用 `add()`，restore 也使用 no-overwrite `add()`，ID 或 quota/constraint 失敗會讓 transaction abort。

## Backup / restore

- v2 `records.json` 不含 Data URL `originalUrl` 或 `previewRef`，canonical preview 只在 `media/{recordId}/{assetId}.{webp|gif}` 出現一次。
- 每個 v2 media entry 有 MIME、decoded byte size 與 SHA-256；parse 會先完整驗證 archive，再做 restore。
- v1 archive 可讀取 `original`、`preview`、`data-url` 與 legacy `FileRecord` metadata；media bytes 進同一 canonical pipeline，不會重建 FileRecord 或本機檔案。
- restore 先完成所有 ID/reference、media hash、canonicalization 與 conflict preflight，再以單一跨-store transaction 寫入 Record、Asset、Tag、Category。
- ZIP export 是使用者主動觸發的瀏覽器下載連結，不是 media capture 的自動下載路徑。

## Delete / privacy boundary

永久刪除與 Trash purge 只刪 IndexedDB 中的 Record、Asset、Tag、preview state 與 legacy FileRecord metadata；不呼叫 `chrome.downloads.*`，不刪除、搬移或修改既有檔案。Manifest 不再要求 `downloads` permission。

## Error model vs conflict model

- Error：fetch、decode、encode、Data URL、IndexedDB 或 clipboard 等技術失敗；preview failed 仍保留 source fallback。
- Conflict：duplicate selection、overlap、role 不允許與 restore ID collision 等使用者操作衝突。
- 兩者型別、UI 卡片與處理路徑分離。
