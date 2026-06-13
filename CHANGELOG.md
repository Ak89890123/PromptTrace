# Changelog

## 0.3.0 — 2026-06-12

按鍵邏輯重做：單一召喚鍵 → 依對象過濾的角色選項。

- **召喚鍵流程**：反白文字（或游標移到圖片 / 影片上）→ 按召喚鍵 → 就地跳出「該對象合法的」角色選項；圖片 / 影片不會出現 Negative 按鈕
- **瀏覽器層級快捷鍵（chrome.commands）**：預設 Alt+S，優先權高於網頁按鍵處理（不會被網站吃掉），可在 `chrome://extensions/shortcuts` 重新綁定；頁面內另有可自訂的備用召喚鍵
- **移除每角色一鍵的設計**（Alt+1～4），改為單一召喚鍵 + 選項過濾
- **角色規則放寬**：圖片 / 影片現在可標記 Input Reference（風格參考圖是真實工作流），僅 Negative 仍被禁止
- **鍵盤擷取圖片 / 影片**：游標懸停在媒體上按召喚鍵即可加入，不必右鍵
- **右緣 hover 修正**：整條右緣加 14px 隱形感應帶，滑到右邊緣任意位置即展開面板（先前只有中央 30px 小耳朵）
- 媒體在無可用 URL 時的鍵盤擷取也走 Error Card + 只保存來源

## 0.2.0 — 2026-06-12

UI / 互動全面改版。

- **頁面內漂浮面板**：滑鼠靠近頁面右緣自動展開的玻璃面板（可固定 📌），包含完整 session 管理 + 兩步 wizard，不必再開 Chrome side panel（side panel 保留為備用入口）
- **反白即出現角色按鈕**：選取文字後就地浮出 Input / Input Reference / Negative / Output 玻璃按鈕，點一下直接以該角色加入 session
- **自訂快捷鍵**：每個角色可設定直接擷取快捷鍵（預設 Alt+1～4，反白後按鍵即加入）；工具列可改為「按召喚鍵才出現」模式；Settings 內建按鍵錄製器
- **工具列按鈕可自訂**：顯示哪幾顆角色按鈕（2–4 顆）可在 Settings 勾選
- **iOS 玻璃質感視覺**：所有 UI（漂浮面板、工具列、Side Panel、Library、Settings）改為 glassmorphism——半透明深色玻璃、backdrop blur + saturate、柔光邊框、漸層背景
- 新增 background taxonomy 訊息通道（頁面內 wizard 取得分類 / model）
- 新增 hotkey 解析 / 匹配 / 錄製工具 + 8 個單元測試（總計 56 tests）

## 0.1.0 — 2026-06-12

Initial V1 build.

- Capture session：文字（反白 + 右鍵）、圖片 / 影片（右鍵 context menu）
- 角色標記：Input / Input Reference / Negative / Output（圖片 / 影片禁用 Negative）
- Overlay frame：角色顏色框線、flash、X / commit 清除
- 重複 / 重疊選取偵測 + Conflict Card
- 兩步 wizard：多層分類（選填、可自訂、可快速新增）→ Model（選填 / Unknown / N.A. / Custom）
- IndexedDB v1（7 stores）+ 內建分類 / model preset seed
- 媒體下載到 Downloads/PromptTrace/{recordId}/、FileRecord 狀態追蹤、失敗 Error Card + 只保存來源 fallback
- Library Dashboard：搜尋、分類 / Model / 角色篩選、preview、notes、tags、補充資產（文字 / 拖放 / 上傳）
- Copy Input / Output / Full Record Bundle + Floating Copy Tray fallback
- Markdown / JSON export（可設定是否含 source / file path）
- 刪除 Record（可選連動刪除本地檔案）
- Settings：分類樹、model presets、角色顏色、overlay / tray 開關、匯出偏好、權限說明
- Vitest unit + integration tests、手動 E2E script、architecture docs、3 篇 ADR
