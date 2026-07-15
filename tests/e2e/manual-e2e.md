# Manual E2E Test Script

每次發版前手動跑一遍。前置：`npm run build`、Chrome 載入 `.output/chrome-mv3`。

## Flow 1：文字工作流

| # | 步驟 | 預期 |
| --- | --- | --- |
| 1 | 開文章頁，反白一段文章 → 右鍵 → 加入選取文字 | Side Panel 出現 Pending Text item；頁面不加框線 |
| 2 | 點 Input Reference | item 移到 Input Reference 區；頁面不加框線 |
| 3 | 再反白一段指令 → 右鍵加入 | 第二個 item 出現 |
| 4 | 點 Input | item 角色更新；頁面不加框線 |
| 5 | 按 ✓ 保存 | 出現 Step 1 分類 wizard |
| 6 | 選「生文」或快速新增自訂分類 | 可下一步 |
| 7 | Model 選「不填」 | 保存成功，session 清空 |
| 8 | 開 Library | record 存在，Input / Input Reference 內容正確 |
| 9 | 開 record detail | 顯示摘要、角色內容與本機 preview 狀態；不顯示下載位置按鈕 |

## Flow 2：圖片工作流

| # | 步驟 | 預期 |
| --- | --- | --- |
| 1 | 右鍵圖片 → 加入圖片 | Side Panel 出現 Image item，含縮圖；Negative 按鈕 disabled 且有說明 tooltip |
| 2 | 點 Input | item 角色更新；頁面不加框線 |
| 3 | ✓ → 分類選「生圖」→ Model 選 Custom 輸入名稱 | 保存成功 |
| 4 | 等待 preview job 完成 | Asset 狀態變為 `ready`，沒有 Downloads 檔案副作用 |
| 5 | 重新載入 Library / extension page | IndexedDB WebP preview 仍顯示 |
| 6 | 讓來源 URL 失效 | 已保存的本機 preview 仍顯示；若生成失敗則顯示來源 fallback |

## Flow 3：影片失敗工作流

| # | 步驟 | 預期 |
| --- | --- | --- |
| 1 | 在串流影片網站右鍵影片 → 加入影片 | 拿不到 URL 時出現 Error Card（MEDIA_URL_NOT_FOUND），含原因與建議 |
| 2 | 點「只保存來源」 | session 出現 source-only video asset |
| 3 | 標記 Output → ✓ → 不選分類不選 Model → 保存 | record 建立成功 |
| 4 | Library 開 record | 顯示 GIF/still preview 或來源 fallback |
| 5 | 全程 | 無 crash、無自動下載錯誤 |

## Flow 4：衝突處理

| # | 步驟 | 預期 |
| --- | --- | --- |
| 1 | 反白文字加入兩次（相同範圍） | 不新增；Conflict Card：DUPLICATE_SELECTION |
| 2 | 反白部分重疊的範圍加入 | Conflict Card：OVERLAPPING_SELECTION，含取代 / 取消 |
| 3 | 選「用新範圍取代」 | 舊 item 移除、新 item 進 session |
| 4 | 對同一圖片右鍵加入兩次 | DUPLICATE_SELECTION |

## Flow 5：刪除只修改 IndexedDB

| # | 步驟 | 預期 |
| --- | --- | --- |
| 1 | 刪除 record | record、assets、preview state、tags 與 legacy FileRecord metadata 消失 |
| 2 | 檢查既有本機檔案 | 不刪除、搬移或修改任何既有檔案 |

## Flow 6：X 取消

| # | 步驟 | 預期 |
| --- | --- | --- |
| 1 | 加入多個 asset 後按 ✕ 取消 session | session 清空、Library 無新 record、無下載發生 |

## Flow 7：Settings

| # | 步驟 | 預期 |
| --- | --- | --- |
| 1 | 新增子分類（父選「生文」） | 分類樹縮排顯示；wizard 與 Library 篩選可見 |
| 2 | 停用一個內建分類 | wizard 不再顯示它 |
| 3 | 新增自訂 model → 回 capture 流程 | Step 2 可選到 |
| 4 | 改 Input 角色顏色 | 後續角色標記使用新顏色 |
| 5 | 備份與還原 → 匯出紀錄庫 ZIP | 下載 v2 ZIP，包含 manifest、`records.json`、SHA-256 metadata 與 canonical media |
| 6 | 備份與還原 → 匯入剛剛的 ZIP | 驗證/轉碼後以單一 transaction 還原到 IndexedDB，不建立 Downloads 媒體檔 |
