# PromptTrace Demo Script

事前準備：`npm run build` → `chrome://extensions` 載入 `.output/chrome-mv3` → 點 extension 圖示開 Side Panel。

## Demo 1：文字工作流

1. 開任意文章頁（例如 Wikipedia）。
2. 反白一段段落 → 右鍵 → **PromptTrace：加入選取文字**。頁面出現灰色（Pending）框線、Side Panel 出現 Text item。
3. 在 Side Panel 點 **Input Reference** → 框線變紫色。
4. 再反白另一段 → 右鍵加入 → 標記 **Input** → 框線變青色。
5. 按 **✓ 保存** → Step 1 選「生文」（或快速新增自訂分類）→ Step 2 選 Not applicable → 保存。
6. 點「在 Library 中查看」確認 record。

## Demo 2：圖片工作流

1. 開任意有圖片的頁面。
2. 右鍵圖片 → **PromptTrace：加入圖片**。注意 Negative 按鈕是 disabled 的（tooltip 顯示原因）。
3. 標記 **Input** → 按 ✓ → 分類選「生圖」→ Model 選 Custom 輸入任意名稱 → 保存。
4. 確認 `Downloads/PromptTrace/{recordId}/` 出現圖片檔。
5. Library 中該 record 顯示圖片 preview 與下載狀態 completed。
6. 按 **Copy Input Bundle**：文字（含本地路徑）進剪貼簿。

## Demo 3：影片失敗 fallback

1. 開使用 blob / 串流播放器的影片網站（多數影音平台）。
2. 右鍵影片 → **PromptTrace：加入影片**。
3. 若拿不到 URL → Side Panel 顯示 **Error Card（MEDIA_URL_NOT_FOUND）**，含可能原因與建議。
4. 點 **只保存來源** → session 出現 source-only video asset。
5. 標記 Input/Output → 保存 → Library 顯示影片 file card（來源頁連結）。全程不 crash。

## Demo 4：重複 / 重疊選取

1. 反白一段文字加入。
2. 再反白完全相同文字加入 → 不新增、原框線閃爍、Conflict Card 提示重複。
3. 反白與原選取部分重疊的範圍 → Conflict Card 提供「用新範圍取代 / 取消新選取」。

## Demo 5：Library 操作

1. 開 Library → 用搜尋框找關鍵字、用分類 / Model / 角色下拉篩選。
2. 點 record → 修改標題、notes、新增 tags。
3. 在右欄貼一段文字選角色按「新增文字」；把一張本機圖片拖進頁面 → 變成 asset。
4. 修改某 asset 的角色（注意圖片的 Negative 選項 disabled）。

## Demo 6：Copy Bundle 與 Export

1. 在 record detail 按 **Copy Full Record** → 含媒體時出現 Floating Copy Tray，可逐張複製連結。
2. 按 **Export Markdown** / **Export JSON** → 下載對應檔案，未填分類 / Model 時顯示 Uncategorized / Not specified。

## Demo 7：刪除連動

1. 按 **刪除 Record** → 出現兩個選項。
2. 選 **連同本地檔案刪除** → `Downloads/PromptTrace/{recordId}/` 內由 extension 下載的檔案被刪除，record 從 Library 消失。
3. 若檔案已被手動移走 → 不 crash，提示手動處理。
