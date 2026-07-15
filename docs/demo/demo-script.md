# PrompTrace Demo Script

事前準備：`npm run build` → `chrome://extensions` 載入 `.output/chrome-mv3` → 點 extension 圖示開 Side Panel。

## Demo 1：文字工作流

1. 開任意文章頁（例如 Wikipedia）。
2. 反白一段段落 → 右鍵 → **PrompTrace：加入選取文字**。頁面出現灰色（Pending）框線、Side Panel 出現 Text item。
3. 在 Side Panel 點 **Input Reference** → 框線變紫色。
4. 再反白另一段 → 右鍵加入 → 標記 **Input** → 框線變青色。
5. 按 **✓ 保存** → Step 1 選「生文」（或快速新增自訂分類）→ Step 2 選 Not applicable → 保存。
6. 點「在 Library 中查看」確認 record。

## Demo 2：圖片工作流

1. 開任意有圖片的頁面。
2. 右鍵圖片 → **PrompTrace：加入圖片**。注意 Negative 按鈕是 disabled 的（tooltip 顯示原因）。
3. 標記 **Input** → 按 ✓ → 分類選「生圖」→ Model 選 Custom 輸入任意名稱 → 保存。
4. 等待 Library/Gallery 顯示本機 WebP preview 與 `ready` 狀態；不會建立 Downloads 檔案。
5. 重新載入 Library，確認 preview 仍可顯示。
6. 讓來源 URL 失效或切換頁面，確認 IndexedDB preview 仍可用。

## Demo 3：影片失敗 fallback

1. 開使用 blob / 串流播放器的影片網站（多數影音平台）。
2. 右鍵影片 → **PrompTrace：加入影片**。
3. 若拿不到 URL → Side Panel 顯示 **Error Card（MEDIA_URL_NOT_FOUND）**，含可能原因與建議。
4. 點 **只保存來源** → session 出現 source-only video asset。
5. 標記 Input/Output → 保存 → Library 顯示 GIF/still preview 或 source fallback。全程不 crash。

## Demo 4：重複 / 重疊選取

1. 反白一段文字加入。
2. 再反白完全相同文字加入 → 不新增、原框線閃爍、Conflict Card 提示重複。
3. 反白與原選取部分重疊的範圍 → Conflict Card 提供「用新範圍取代 / 取消新選取」。

## Demo 5：Library 操作

1. 開 Library → 用搜尋框找關鍵字、用分類 / Model / 角色下拉篩選。
2. 點 record → 修改標題、分類或模型。
3. 修改某 asset 的角色（注意圖片的 Negative 選項 disabled）。
4. 產生摘要，確認摘要區顯示結果或錯誤狀態。

## Demo 6：備份與還原

1. 到 Settings → **備份與還原** → **匯出紀錄庫 ZIP**，下載包含 v2 manifest、`records.json`、SHA-256 metadata 與 canonical media 檔的備份包。
2. 用 **匯入紀錄庫 ZIP** 選剛剛的備份包 → 先驗證/轉碼，再以單一 transaction 還原 Record、Asset 與 IndexedDB preview；不建立 Downloads 媒體檔。

## Demo 7：刪除連動

1. 按 **刪除 Record** → record、assets、preview state、tags 與 legacy FileRecord metadata 從 IndexedDB 消失。
2. 確認既有檔案不會被刪除、搬移或修改。
