# PromptTrace

**PromptTrace 是一個 local-first Chrome Extension，讓你在 AI 工作流中選取文字、圖片、影片，標記為 Input / Input Reference / Negative / Output，並保存成可搜尋、可預覽、可複製、可匯出、可連動刪除本地檔案的 Prompt Asset Library。**

不是 LLM 工具、不是 prompt 生成器、不是下載器、沒有後端、沒有帳號、沒有雲端同步。

## Problem

使用 ChatGPT、Claude、Midjourney、Runway 等多個 AI 平台時，Prompt、Reference、Negative 與 Output 散落在聊天紀錄、截圖、Notion 與下載資料夾。事後很難知道哪個檔案對應哪組 Prompt、哪個模型、哪個分類。

## Before / After Workflow

**Before：** 手動複製 Input → 手動複製 Output → 右鍵另存圖片 → 自己建資料夾命名 → 貼到 Notion → 之後找不到對應關係。

**After：**

1. 反白文字 → 選取處直接浮出角色按鈕（或按自訂快捷鍵 Alt+1～4 立即加入）；圖片 / 影片用右鍵選單。
2. 頁面出現角色顏色框線；滑鼠靠近頁面右緣，玻璃質感漂浮面板自動展開顯示本次選取。
3. 在面板中調整角色、按 ✓ → 選填分類（可多層、可自訂）→ 選填 Model → 保存。
4. 文字進 IndexedDB，媒體下載到 `Downloads/PromptTrace/`，Library 中可搜尋、預覽、複製、匯出、刪除。

## Features

- **召喚鍵工作流**：反白文字（或游標移到圖片 / 影片上）→ 按召喚鍵（預設 Alt+S）→ 就地浮出該對象合法的角色選項（圖片 / 影片不會出現 Negative）
- **瀏覽器層級快捷鍵**：召喚鍵走 `chrome.commands`，優先權高於網頁按鍵處理、不被網站吃掉，可在 `chrome://extensions/shortcuts` 重綁；Settings 另有頁面內備用鍵與錄製器
- **右緣漂浮面板**：滑鼠靠近頁面右邊緣自動展開 iOS 玻璃質感面板，session 管理與保存 wizard 都在頁面內完成（Chrome side panel 保留為備用）
- 文字 / 圖片 / 影片 capture session，含 overlay 框線（顏色依角色變化）
- 角色規則：文字可四種角色；圖片與影片只能 Input / Output（Negative 按鈕 disabled）
- 重複 / 重疊選取偵測：Conflict Card（取代或取消）
- 兩步 wizard：分類（選填、多層、可快速新增）→ Model（選填 / Unknown / Not applicable / Custom）
- Library Dashboard：搜尋、分類 / Model / 角色篩選、預覽、notes、tags、補充資產（貼文字、拖放或上傳圖片 / 影片）
- Copy Input Bundle / Copy Output Bundle / Copy Full Record，含 Floating Copy Tray fallback
- Markdown / JSON export
- 刪除 Record 時可選擇是否連同本地下載檔案刪除
- Settings：分類樹管理、Model preset 管理、角色顏色、overlay / tray 開關、匯出偏好
- 影片無法下載時顯示 Error Card，可 fallback 只保存來源——流程不會 crash

## Architecture

```
Content Script  ──選取/框線──▶  Background Service Worker  ──IndexedDB──▶  Library / Settings
     ▲                              │  session state、contextMenus、
     └──── overlay 訊息 ◀───────────┘  chrome.downloads、錯誤映射
                 Side Panel（session UI、wizard、Error/Conflict Card）
```

- `src/core/`：domain entities、enums、validation、session、overlap、export、copy bundle、error / conflict model（純 TS，無 Chrome API，可單元測試）
- `src/storage/`：IndexedDB（version 1 migration）、repositories、seed、commit service
- `src/ui/`：role colors、settings store、共用 hooks / CSS
- `entrypoints/`：background、content、sidepanel、library、settings（WXT）

詳見 [docs/architecture.md](docs/architecture.md)。

## Tech Stack

WXT · TypeScript · React · Chrome Extension Manifest V3 · IndexedDB · chrome.storage / contextMenus / downloads / sidePanel · Vitest

## Setup

```bash
npm install
npm run dev      # 開發模式（自動 reload）
npm run build    # 產出 .output/chrome-mv3
npm test         # unit + integration tests
```

## Load in Chrome

1. `npm run build`
2. 打開 `chrome://extensions`，開啟「開發人員模式」。
3. 「載入未封裝項目」→ 選 `.output/chrome-mv3` 資料夾。
4. 點 extension 圖示開啟 Side Panel。

## Usage

1. 在任何網頁反白文字 → 按召喚鍵（預設 **Alt+S**）→ 選取處浮出角色選項，點一下即加入（也可在 Settings 改成反白後自動出現，或用右鍵選單）。
2. 圖片 / 影片 → 游標移上去按召喚鍵（只會出現合法角色），或右鍵 → **PromptTrace：加入圖片 / 加入影片**。
3. 滑鼠移到頁面右緣 → 漂浮面板展開，可調整角色（圖片 / 影片不能選 Negative）、移除項目。
4. 按 **✓ 保存** → Step 1 選分類（可不選）→ Step 2 選 Model（可不選）。
5. 開 **Library** 搜尋、預覽、複製 bundle、匯出 Markdown / JSON、刪除。
6. 在 **Settings** 自訂快捷鍵、工具列按鈕、觸發方式、角色顏色與開關。

## Permissions Explanation

| 權限 | 用途 |
| --- | --- |
| `<all_urls>` / `activeTab` / `scripting` | 讀取你主動選取的文字與右鍵選到的媒體 URL、畫 overlay 框線。不讀其他內容。 |
| `contextMenus` | 提供右鍵「加入 PromptTrace」選單。 |
| `downloads` | 把媒體下載到 `Downloads/PromptTrace/`；刪除 Record 時可選擇刪除這些檔案。 |
| `storage` | 保存設定（角色顏色、匯出偏好）。 |
| `sidePanel` | 顯示 capture session 與 wizard。 |
| `clipboardWrite` | Copy Bundle 功能。 |

## Local-first Privacy Note

- 所有資料（Prompt 文字、metadata、檔案索引）保存在本機：IndexedDB + `Downloads/PromptTrace/`。
- 不上傳任何資料、不呼叫任何 LLM API、不蒐集 analytics、無帳號、無雲端。
- 本地檔案路徑只存在本機資料庫中，匯出時可在 Settings 關閉「包含檔案路徑」。

## Testing

```bash
npm test
```

- Unit：role / asset / category tree / model 驗證、duplicate-overlap 偵測、Markdown / JSON export、copy bundle、error / conflict 映射、session state。
- Integration（fake-indexeddb）：seed、commit session、FileRecord 建立、下載失敗狀態、delete cascade。
- 手動 E2E：見 [tests/e2e/manual-e2e.md](tests/e2e/manual-e2e.md) 與 [docs/demo/demo-script.md](docs/demo/demo-script.md)。

## Known Limitations

- **不是所有影片都能下載。** blob URL、MediaSource 串流、DRM 內容、需登入授權的媒體都拿不到可下載 URL；此時顯示 Error Card，可選擇只保存來源頁連結。
- 圖片下載也可能因跨域、登入、防盜鏈失敗；失敗會標記 FileRecord 為 failed，可重試。
- 重疊選取偵測在 DOM 劇烈變動（如虛擬列表）後可能失準，會退化為文字包含比對。
- 刪除本地檔案依賴 `chrome.downloads.removeFile`，只能刪 extension 自己下載的檔案；使用者手動移動過的檔案會回報 `file_not_found`。
- 僅支援 Chrome（MV3）。Side panel 在部分 Chrome 版本需手動允許。
- 文字 + 圖片混合複製不一定被目標網站接受；fallback 是文字先複製、媒體放 Copy Tray 逐項處理。

## Roadmap

- 區段內快取縮圖、Library 虛擬捲動
- Range-anchor 重建（更穩定的 overlay 重疊偵測）
- 匯出整個 Library（批次 Markdown / JSON）
- Firefox 支援評估

## License

MIT — 見 [LICENSE](LICENSE)。

本專案參考了 Open Prompt Manager、Obsidian Web Clipper、MarkDownload、Image Downloader、TagStudio、TagSpaces 的**概念**（capture UX、Markdown export、asset library、tagging），未複製任何程式碼；所有程式碼皆為本 repo 原創。

---

## 開發日誌

### 2026-06-13 收工

**做了什麼：**
- V0.1.0：WXT + MV3 完整骨架——IndexedDB v1（7 stores）、background service worker（contextMenus / downloads / sidePanel）、content script、side panel、library dashboard、settings 頁面、Markdown / JSON export、copy bundle
- V0.2.0：UI 大改——iOS glassmorphism 樣式、頁面右緣 14px 不可見觸發帶 + 玻璃質感浮動面板（hover 自動展開）、`core/hotkeys.ts` 按鍵錄製器
- V0.3.0：召喚鍵邏輯重設計——改成單一召喚鍵（預設 Alt+S）透過 `chrome.commands` 觸發（瀏覽器層級，不被網頁吃掉）→ 就地浮出角色選項；圖片 / 影片自動過濾掉 Negative；Settings 移除 per-role hotkey，只保留單一 summonHotkey 錄製器
- 建立 `tests/e2e/harness/`：`test.html` + `chrome-stub.js` 用於本地 visual QA

**踩到的坑：**
- Windows 上 `npm install` 需要 `NODE_OPTIONS=--use-system-ca`（corporate CA 問題）
- `tsconfig.json` 必須 `extends: "./.wxt/tsconfig.json"` 才能讓 WXT 型別宣告生效
- browse tool 在此 Windows 環境下 daemon 會被 kill，無法完成 visual QA

**下次方向：**
- **主要 Bug**：content script 的浮動 UI（邊緣面板 + 選取工具列）沒有出現在 Chrome 中
  - 最可能原因 A：MV3 content script 不注入載入前已開啟的分頁 → 載入擴充功能後對頁面按 **F5** 再測試
  - 最可能原因 B：`createShadowRootUi` 建立失敗（shadow host 沒 append 到 DOM）→ 檢查 `entrypoints/content/index.tsx` 的 `main()` 是否有 console.error
  - 最可能原因 C：CSS `cssInjectionMode: 'ui'` 失敗 → UI render 但不可見
  - 驗證方法：載入後 F5，開 DevTools Console 看是否有 `[PromptTrace]` 或 error，再看 Elements 是否有 `<prompttrace-ui>` shadow host
- 確認後視情況修 bug 或完成 visual QA
