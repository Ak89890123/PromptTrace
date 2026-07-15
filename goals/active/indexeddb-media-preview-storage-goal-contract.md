---
type: goal-contract
schema_version: 1
id: indexeddb-media-preview-storage
title: PromptTrace 媒體預覽統一儲存於 IndexedDB
status: ready
created: 2026-07-14
updated: 2026-07-14
completed:
owner: codex
file_mode: single-file
project: PromptTrace
paths:
  contract: goals/active/indexeddb-media-preview-storage-goal-contract.md
review:
  required: true
  verdict: PASS
tags:
  - indexeddb
  - media-preview
  - local-first
  - storage
---

## Contract

目標：把自動產生的媒體預覽統一保存於擴充功能的本機 IndexedDB，讓一般擷取與預覽生成不再於 `Downloads/PrompTrace/` 建立檔案，也不會要求使用者選擇下載位置。

下一次實作的明確交付內容：

- 圖片擷取沿用目前的精簡 WebP 預覽，並保存於 IndexedDB。
- 影片擷取沿用目前的精簡 GIF 預覽與靜態圖片 fallback，並保存於 IndexedDB。
- 自動擷取路徑不為這些預覽呼叫 `chrome.downloads.download`、建立媒體 `FileRecord`，或建立 Downloads 子資料夾。
- 紀錄庫、網頁內圖庫、垃圾桶、備份／匯出流程與紀錄刪除仍能顯示及管理本機預覽。
- 使用者主動執行的「匯出 ZIP」維持獨立操作，仍可建立使用者明確要求的 ZIP 檔案；本合約不新增 PromptTrace 原檔下載功能。
- 新版與舊版備份中的預覽媒體都直接還原到 IndexedDB，不建立 `FileRecord`、Chrome 下載紀錄或 `Downloads/PrompTrace/` 檔案。

最低變更量的優先方案是沿用既有 `Asset.previewRef` 持久化路徑。除非實作證據顯示現有格式無法滿足正確性、配額、備份或效能需求，否則不要求新增二進位 store 或提升 `DB_VERSION`。

## Scope

範圍內：

- 將產生的圖片 WebP 預覽與影片 GIF／靜態預覽寫入 IndexedDB。
- 從擷取提交流程移除圖片預覽的自動下載排程。
- 保留目前固定的精簡／低畫質編碼行為，不恢復低、中、高畫質選項。
- 遠端圖片與影片只自動保存壓縮預覽；不另外抓取或保存原始二進位檔。
- 新擷取的 Data URL／貼上媒體在 commit 前先驗證並轉成固定低畫質 WebP 或 GIF／靜態預覽；成功後只保存 `previewRef`，不重複保存原始 Data URL。既有 DB 中的舊 Data URL 保持可讀且不強制重寫。
- 來源存在時保留遠端 `originalUrl` 中繼資料，讓來源註記與使用者自行開啟來源網址在有效期間仍可使用；這不構成 PromptTrace 原檔下載功能。
- 只要擴充功能資料庫仍存在，即使來源網址失效，已生成的預覽仍須可用。
- 更新提交、預覽持久化、顯示、刪除、備份與匯出相容性的測試。
- 修改或由新 ADR 取代 `docs/adr/ADR-0001-local-first-extension.md` 與 `docs/adr/ADR-0003-indexeddb-and-downloads.md` 的舊媒體決策，明確記錄「預覽存 IndexedDB、只有使用者主動匯出才建立檔案」的新架構。
- 為非同步預覽生成保存 durable `pending`／`processing`／`ready`／`failed` 狀態與最後錯誤；service worker 或瀏覽器重啟後能恢復同一次未完成工作，不把恢復視為新的捕捉或自動重試。
- 預覽完成或失敗後通知紀錄庫、網頁內圖庫與垃圾桶更新狀態，不要求使用者手動重新整理。

範圍外：

- 自動抓取並將遠端圖片或影片原始二進位檔存入 IndexedDB；使用者直接提供的 Data URL／貼上媒體屬明確相容例外。
- 雲端儲存、同步、帳號、遙測、分析，或除了抓取來源以產生本機預覽之外的網路服務。
- 新增預覽畫質設定，或將既有紀錄重新編碼為多種畫質。
- 刪除、搬移或重新管理已存在於 `Downloads/PrompTrace/` 的實體檔案；紀錄刪除只處理 IndexedDB 資料。
- 移除 ZIP 匯出功能，或新增 PromptTrace 原檔下載功能。
- 保證在解除安裝擴充功能、刪除瀏覽器設定檔、手動清除擴充功能資料或瀏覽器儲存損壞後仍可復原。

## Success Criteria And Rubric

只有全部必要條件都成立時，實作才算通過：

1. 擷取可下載的遠端圖片後，產生可持久保存的本機 WebP 預覽，但不建立下載紀錄、`FileRecord` 或 `Downloads/PrompTrace/` 檔案。
2. 擷取可下載的遠端影片後，產生可持久保存的本機 GIF 預覽或靜態 fallback，但不建立已下載的影片或預覽檔案。
3. 一般自動擷取與預覽生成不會開啟下載位置視窗。
4. 重新載入擴充功能頁面並重啟瀏覽器後，IndexedDB 中的預覽仍可顯示。
5. 遠端 `originalUrl` 後續失效時，已生成的預覽仍可顯示。
6. 帶有既有下載檔中繼資料的舊紀錄仍可讀取；遷移、永久刪除與自動垃圾桶清理都不刪除、搬移或修改任何既有實體檔案。
7. 刪除紀錄時只移除 IndexedDB 中的 Record、Asset、preview state 與 legacy `FileRecord` metadata，不呼叫 `chrome.downloads.removeFile`。
8. 備份與還原能保留資料庫預覽；若受大小或格式限制，必須回報可處理的錯誤，不得靜默遺失媒體。
9. 紀錄庫、網頁內面板與垃圾桶優先使用已持久化的本機預覽；預覽生成失敗時仍保留目前的僅來源 fallback。
10. 編譯、聚焦測試、完整 Vitest、建置及相關 extension e2e／手動檢查均留下可重現證據。
11. 新版 v2 備份往返及舊版 v1 備份匯入均直接重建 `previewRef`，不建立新 `FileRecord`、Chrome 下載紀錄或 Downloads 媒體檔案；v1 原始媒體先轉碼為低畫質預覽，原始二進位不寫入 DB。
12. 預覽生成於 commit、service worker reload 或瀏覽器重啟中斷時，會恢復同一個 durable job；若抓取、解碼、轉碼或 DB 寫入確定失敗，該次捕捉立即標記 failed，不進行隱藏式自動重試。使用者再次捕捉才是新的獨立嘗試。
13. 預覽成功寫入後二秒內，已開啟的紀錄庫、網頁內圖庫與垃圾桶會收到更新並顯示預覽或最新狀態。
14. Data URL 圖片、Data URL 影片、遠端圖片、遠端影片及不可下載來源各自具有明確且經測試的儲存結果。
15. 自動路徑的 `chrome.downloads.download` 呼叫次數為零；使用者主動匯出 ZIP 另行驗收，不算自動下載。
16. Commit 以單筆 Record 為原子單位；備份 restore 在全部驗證、轉碼與 ID 衝突檢查通過後，以單一跨 store transaction 完成，任何失敗皆零寫入。
17. 新 capture/import 的 Data URL 通過 MIME、格式與 decoded-byte 上限驗證；既有超限資料保持可讀，但不會在新備份還原時未經轉碼重新寫入。
18. 移除 `downloads` 權限後，自動擷取、刪除、垃圾桶清理與 v1/v2 還原仍全部通過；ZIP 匯出繼續使用使用者主動觸發的瀏覽器下載連結。
19. v1 `source: data-url` 與 v2 media 在寫入前都經過同一 canonical preview pipeline；備份 metadata 中不存在任何 Data URL `originalUrl`／`previewRef`，原始 Data URL bytes 絕不持久化。

評分規則：

- PASS：十九項條件全部通過、ADR 與相關文件已更新，而且沒有任何自動預覽或刪除路徑進入 `chrome.downloads`。
- NEEDS_EVIDENCE：行為看似正確，但缺少持久化、來源失效、備份／還原、瀏覽器重啟或回歸證據。
- FAIL：任何自動擷取建立媒體檔案／下載紀錄、詢問儲存位置、遺失既有紀錄、靜默遺失預覽，或引入雲端／網路持久化。

## Constraints And Assumptions

- 維持 PromptTrace 的 local-first 隱私合約。IndexedDB 是瀏覽器設定檔中的本機儲存，不是雲端儲存。
- 大型媒體值存於 IndexedDB，不使用 `chrome.storage.local`。
- 以目前固定預覽規格為基準：圖片使用精簡 WebP，影片使用精簡 GIF 並提供靜態 fallback。
- 生成的預覽是衍生媒體，不是原始檔封存副本。
- 第一版沿用 base64 data URL 形式的 `Asset.previewRef` 作為 IndexedDB 中的 canonical preview representation。
- WebP 二進位上限為每個預覽 2 MiB；GIF 二進位上限沿用 3 MiB，轉為 data URL 後必須在寫入前再次檢查大小。第一版單筆 Record 的預覽總量上限為 20 MiB；超限時縮小／降級為靜態預覽，仍失敗則標記 failed 並顯示可理解錯誤。
- Data URL input allowlist：image asset 僅接受 `image/png`、`image/jpeg`、`image/webp`、`image/gif`，decoded input 上限 20 MiB；video asset 僅接受 `video/mp4`、`video/webm`，decoded input 上限 50 MiB。輸入可為合法 base64 或 percent-encoded Data URL，但持久化輸出統一為 base64。MIME 必須與 asset type 相符，畸形或超限 input 在寫入前拒絕。
- IndexedDB 寫入原子性：新 commit 先完成 Data URL 驗證／轉碼，再以單一 transaction 寫入該 Record、全部 Assets 與 preview jobs；備份 restore 先在 transaction 外完成全檔驗證與媒體轉碼，再以只涵蓋 records、assets、tags、categories 的單一 write transaction 完成 ID 再檢查與寫入。restore 絕不寫入 `fileRecords` store；v1 `fileRecordId` 僅能在 preflight 記憶體中用來對應 media entry。`QuotaExceededError`、constraint error 或任何寫入失敗皆 abort，不留下半筆 Record、孤兒 Asset 或部分還原資料。
- Restore ID 政策：preflight 可提早發現衝突，但 write transaction 內必須再次 `get()` 檢查。Record、Asset、Tag 一律使用 no-overwrite `add()`；任何既有 ID 或 archive 內重複 ID 都使整次 transaction abort。Category 若同 ID，僅在 `parentId`、`name`、`slug`、`color`、`icon`、`isBuiltin`、`isActive`、`sortOrder` 標準化後完全相同時重用，忽略 `createdAt`／`updatedAt`；內容不同則 abort。重複匯入同一 archive 會因 Record／Asset ID 衝突而安全拒絕。
- Preview 狀態欄位至少包含 `previewStatus`、`previewErrorCode`、`previewLeaseUntil`、`previewClaimToken`、`previewUpdatedAt`。狀態機為 `pending → processing → ready` 或 `pending／processing → failed`；不保存或累計隱藏式 retry 次數。
- `pending` 與 Asset 在同一 commit transaction 建立。背景 worker 以 assetId 為唯一 job key，在同一 IndexedDB transaction claim job、產生新的不可猜測 `previewClaimToken`、設為 `processing` 並取得 60 秒 lease；處理超過 20 秒時每 20 秒在 transaction 內驗證 token 並續租。ready／failed 寫入必須在單一 transaction 中重新讀取 Asset，只有 token 相符且 lease 仍有效的 worker 才能 compare-and-set 結果。已有 `previewRef`／`ready` 的 job 為冪等 no-op；過期 worker 的結果必須丟棄，不得覆寫。service worker 中斷造成的過期 lease在下次掃描時由新 token reclaim，代表恢復同一次工作，不算處理失敗或再次捕捉。
- Job 掃描入口固定為 commit 完成後、service worker 初始化／`runtime.onStartup`，以及任一 PromptTrace UI 開啟時。狀態改變後送出 `media/previewChanged` runtime message；已開啟的 Library、網頁內圖庫與垃圾桶依 assetId／recordId 更新，目標為成功持久化後二秒內顯示。
- Preview 失敗不靜默：保留遠端來源 fallback 與 `previewErrorCode`，並送出 `media/previewChanged` failed 事件；右側漂浮欄在對應捕捉項目顯示「捕捉失敗」。Data URL input 因為在 commit 前同步轉碼，失敗時該 asset 不寫入 DB，並在同一次右側捕捉流程顯示「捕捉失敗」。不提供隱藏式自動重試；使用者重新捕捉會建立新的 Asset／job。
- 新版備份格式固定為 `PROMPTTRACE_BACKUP_VERSION = 2`。Export 建立 `records.json` 前，必須從每個 Asset metadata 移除所有 Data URL `originalUrl` 與 `previewRef`，只允許保留合法 HTTP(S) `originalUrl` 中繼資料；每個 canonical preview 只在 `media/{recordId}/{assetId}.{ext}` 保存一次，manifest media entry 以 assetId、recordId、path、MIME、decoded byte size 與 SHA-256 對應。v2 不建立或匯出 synthetic `FileRecord`。
- v2 restore 先驗證 manifest、path、MIME、size 與 SHA-256，再把每個 media file 送入與新 capture 相同的 canonical preview pipeline：image 一律輸出固定低畫質 WebP，video 一律輸出固定低畫質 GIF 或靜態 fallback；即使輸入看似已是 WebP／GIF，也必須經 pipeline 驗證並產生 canonical output 後，才能轉為 base64 `previewRef` 寫入 DB。任何 v2 media 缺失、hash／MIME／size 不符或 canonicalization 失敗都屬 fatal archive error，整包零寫入拒絕。
- v1 restore 在 preflight 時先移除 assets 中內嵌的所有 Data URL `originalUrl`／`previewRef`，但保留合法 HTTP(S) `originalUrl` 中繼資料；v1 `fileRecordId` 只作 media lookup，不持久化。對存在且結構合法的 `source: original`、`source: preview` 與 `source: data-url` 不作直存或 pass-through，全部依 asset type 送入同一 canonical preview pipeline，輸出固定低畫質 WebP、GIF 或靜態 fallback 後才可寫入 `previewRef`。v1 manifest／records 結構錯誤、unsafe path、media entry 指向不存在的 Asset或引用的 media file 缺失屬 fatal archive error，整包拒絕；media file 存在但單檔不支援、無法解碼／轉碼或超限屬 recoverable media error，不保存原始 bytes，該 Asset 以 `failed` 與錯誤碼匯入。所有 recoverable error 分支都不得把原始 Data URL 或 media bytes 寫入任何 Asset 欄位或 store。
- v1/v2 restore 都不還原 media `FileRecord`。既有本機 DB 中的 legacy `FileRecord` 可保持可讀，但紀錄刪除只刪除其 DB metadata，不操作對應實體檔案。
- `downloads` permission 在實作完成時移除。所有 runtime `chrome.downloads.download`、`removeFile`、`search`、`show`／`showDefaultFolder` 路徑一併移除；Settings 的「開啟下載資料夾」、Library 的檔案位置／下載狀態／重試控制及其他依賴 Downloads 的 UI 全部移除。legacy `FileRecord` 僅作 DB 內唯讀相容 metadata，不再顯示或驅動檔案操作。ZIP 匯出沿用使用者點擊後以 object URL + `<a download>` 產生單一 ZIP，不需要 `chrome.downloads` permission。
- 瀏覽器管理的儲存具有持久性，但不等同於使用者自行持有的檔案系統備份；UI 與文件不得暗示兩者等價。
- 對無法存取、需驗證、`blob:`、MediaSource、DRM、已過期或跨來源媒體，保留僅來源 fallback。
- 保留無關的工作樹變更及既有下載檔案。

## Execution Plan

1. 盤點現有圖片／影片的提交、預覽生成、下載、`FileRecord`、顯示、刪除、備份與還原路徑。
2. 先新增聚焦測試，證明目標中的純資料庫預覽行為與舊紀錄相容性。
3. 停止為新擷取的圖片預覽建立自動媒體 `FileRecord` 與待下載工作。
4. 為圖片 WebP 與影片 GIF／靜態生成工作加入具 lease 的 durable 狀態機、同次工作中斷恢復、冪等 claim 及 UI 更新通知；確定失敗時立即標記該次捕捉失敗，不自動重試。
5. 將備份格式升級為 v2；實作 v2 單一預覽副本、hash 驗證與原子 restore，並將 v1 `original`／`preview`／`data-url` 媒體依 fatal／recoverable 規則轉成 DB preview 或 failed Asset，絕不持久化 v1 `FileRecord`。
6. 將 commit 與 restore 改為明確的 IndexedDB multi-store transactions；write transaction 內重新檢查 ID，Record／Asset／Tag 使用 `add()`，並加入衝突、重複匯入、quota、TOCTOU 與 rollback 測試。
7. 讓永久刪除與垃圾桶清理只刪 DB；移除全部 runtime `chrome.downloads.*`、相關資料夾／位置／下載狀態／重試 UI 及 `downloads` permission，既有實體檔案保持不動。
8. 驗證刪除、垃圾桶、備份／匯出、還原、Data URL normalization、僅來源 fallback、配額失敗與來源失效行為。
9. 修改或以新 ADR supersede ADR-0001、ADR-0002 與 ADR-0003，並更新所有仍承諾 Downloads 行為的文件與測試說明。
10. 執行必要驗證，並在合約標為 ready 或 completed 前完成架構／資料完整性審查。

復原與回滾：

- 在相容性證據足以支持獨立淘汰前，保留舊版 `FileRecord` metadata 的讀取；刪除只移除 DB metadata，不再操作實體檔案。
- 如果純資料庫路徑造成預覽持久化回歸，只回滾新的擷取路由；不得刪除或重寫既有 IndexedDB 紀錄或下載檔案。
- 任何 schema migration 在執行前，都必須定義正向遷移、回滾限制、備份相容性與失敗行為。
- 回滾不得重新啟用自動下載、降版 IndexedDB schema、刪除已成功保存的 `previewRef`，或讓舊版程式靜默誤讀新版備份。
- 若 v2 備份已發布，回滾版本必須明確拒絕未知版本，不得把 v2 當 v1 解讀；不得因回滾重新加入 `downloads` permission 或 `removeFile`。

## Required Evidence

- `npm run compile`
- 針對提交階段圖片／影片行為與儲存持久化的聚焦 Vitest。
- `npm test`
- `npm run build`
- 在可行範圍內以 `npm run test:e2e` 驗證擷取、重新載入及擴充功能 UI；否則記錄明確阻礙並提供可重現的手動證據。
- 手動或自動證明圖片與影片擷取不會建立 Chrome 下載紀錄，也不會建立 `Downloads/PrompTrace/` 媒體檔案。
- 證明重新載入與重啟瀏覽器後，WebP 與 GIF／靜態預覽仍可顯示。
- 證明來源網址失效後，預覽仍可顯示。
- 新版備份往返與舊版備份匯入證據，確認只重建 DB 預覽且沒有下載副作用。
- v1 `source: original`／`preview`／`data-url` 各自轉換結果，以及 v2 SHA-256、MIME、path、size 驗證證據。
- v1 三種 source 與 v2 media 全部進入同一 canonical preview pipeline，且 exported/restored Asset metadata 不含 Data URL `originalUrl`／`previewRef` 的證據。
- Commit 與整體 restore transaction 的 rollback、transaction 內 ID 再檢查、`add()` no-overwrite、並行 TOCTOU、重複匯入及零部分寫入證據。
- Data URL allowlist、MIME/asset-type mismatch、畸形資料、decoded input 上限與既有超限資料可讀性證據。
- 模擬 service worker 中斷與瀏覽器重啟後恢復同一次工作，以及單次抓取／轉碼失敗、`QuotaExceededError` 立即標記「捕捉失敗」且不自動重試的證據。
- 模擬 lease 過期後舊 worker 與新 worker 同時完成，確認 claim token fencing 只允許目前 lease owner 寫入 ready／failed，舊結果被丟棄。
- WebP／GIF 單檔上限、單筆 Record 上限及大量紀錄庫／ZIP 體積量測。
- 預覽成功後二秒內自動更新紀錄庫、網頁內圖庫與垃圾桶的證據。
- 更新 README、所有語言版本 README、`docs/architecture.md`、ADR-0001／0002／0003（或 superseding ADR）、privacy、demo、manual e2e、權限說明及 manifest 的 diff／審查證據。
- `downloads` permission 已移除，且 ZIP 匯出、自動擷取、DB 刪除、垃圾桶清理與 v1/v2 restore 均通過的證據。
- 專案內 runtime `chrome.downloads.*` 搜尋結果為零，且下載資料夾、檔案位置、下載狀態與下載重試 UI 已移除的證據。

## Owner, Routing, And Review Gate

主要實作 owner：主 Codex agent，或日後接收此合約的 repository agent。

必要 reviewer：獨立工程 reviewer，重點檢查儲存相容性與資料完整性。若 Chrome 權限或 release 行為改變，另加入 security／release review。

在 reviewer 回傳 `PASS` 前，合約維持 `review_pending`。由於這會改變 repository 已接受的媒體儲存架構，僅通過測試不足以跨過審查門檻。

## Escalation Rules

遇到以下情況必須停止並詢問使用者：

- 擴大範圍，自動儲存圖片或影片原始二進位檔；
- 刪除或遷移既有下載檔案；
- 新增 Chrome 權限、雲端目的地、帳號、遙測或外部服務；
- 以不向後相容的方式變更備份格式；
- 加入使用者可見的畫質設定；
- 新增 PromptTrace 原檔下載功能，或對明確匯出行為做出超過「與自動預覽持久化分離」所需範圍的改動。

如果 IndexedDB 配額、效能或備份大小阻礙可靠的預覽持久化，必須保留草案並提出有量測依據的替代方案，不得靜默退回自動下載到檔案系統。

## Deferred Decisions

- 是否在未來版本把 data URL `previewRef` 遷移為 IndexedDB `Blob`／object URL；第一版不做。
- UI 是否顯示資料庫用量並提供本機預覽清理控制；除非實測證明必要，第一版不做。
- 是否為舊版下載預覽檔提供 opt-in 匯入／清理工具；本合約中保持不動。

## Independent Review History

- 2026-07-14：獨立工程審核 verdict `FAIL`。缺漏包括備份還原仍可能下載、Data URL 政策、durable preview job、配額／原子性、UI 刷新、ADR-0001 一致性及不存在的原檔下載承諾。
- 2026-07-14：依使用者澄清修訂合約；核心目標固定為圖片與影片預覽只存 IndexedDB，自動流程不落地 Downloads，並允許修改或 supersede 既有 ADR。等待再次獨立審核。
- 2026-07-14：第二次獨立工程審核 verdict `FAIL`。阻礙為 v1 media 轉換、commit/restore 原子性、Data URL 邊界、legacy file deletion／downloads permission、durable job 狀態機細節與文件清單。
- 2026-07-14：使用者授權底層技術決策並確認刪除只處理 DB；合約補上 backup v2、v1 轉碼、multi-store transaction、Data URL allowlist、durable lease job、移除 downloads permission 及完整文件清單。僅剩 failed preview 的 UI 呈現待決。
- 2026-07-14：使用者決定不採隱藏式三次重試。service worker 中斷只恢復同一次 job；真正失敗時立即在右側漂浮欄標記「捕捉失敗」，重新捕捉才建立下一次獨立嘗試。UI 決策已完成，等待新的獨立審核授權。
- 2026-07-14：第三次 HIGH effort 獨立工程審核 verdict `FAIL`。剩餘阻礙為 restore/FileRecord 與 fatal/recoverable 矛盾、transaction 外 ID check 的 TOCTOU、lease 缺少 fencing，以及移除 permission 後殘留的 Downloads UI。
- 2026-07-14：依 reviewer 最小修改修訂：restore 絕不寫 FileRecord、明確 fatal/recoverable matrix、transaction 內 `add()`／ID 再檢查、claim token fencing／續租／CAS，以及移除所有 runtime `chrome.downloads.*` 與相依 UI。等待新的獨立審核授權。
- 2026-07-14：第四次 HIGH effort 獨立工程審核 verdict `FAIL`，唯一阻礙為 v1/v2 Data URL 仍可能未經固定低畫質 canonicalization 直接保存。
- 2026-07-14：合約已要求 v1 `original`／`preview`／`data-url` 與 v2 media 全部通過同一 canonical preview pipeline；export/restore metadata 移除所有 Data URL `originalUrl`／`previewRef`，recoverable error 也不得保存原始 bytes。等待新的獨立審核授權。
- 2026-07-14：第五次 HIGH effort 獨立工程審核 verdict `PASS`。確認 canonical pipeline、metadata 清理、restore 不寫 FileRecord、transaction no-overwrite、claim-token fencing，以及移除 Downloads runtime／UI／permission 均已形成唯一且可驗收的合約；狀態改為 `ready`。

## Progress Log

- 2026-07-14：依已確認方向建立合約：自動 WebP 與 GIF／靜態預覽存於 IndexedDB；一般擷取不建立下載資料夾檔案，也不詢問儲存位置。
