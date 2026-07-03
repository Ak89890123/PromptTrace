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
3. 在面板中調整角色、按 ✓ → 選填分類與 Model metadata → 保存。
4. 文字進 IndexedDB，媒體下載到 `Downloads/PromptTrace/`，Library 中可搜尋、預覽、複製、匯出、刪除。

## Features

- **召喚鍵工作流**：反白文字（或游標移到圖片 / 影片上）→ 按召喚鍵（預設 Alt+S）→ 就地浮出該對象合法的角色選項（圖片 / 影片只會有 Input Reference / Output）
- **瀏覽器層級快捷鍵**：召喚鍵走 `chrome.commands`，優先權高於網頁按鍵處理、不被網站吃掉，可在 `chrome://extensions/shortcuts` 重綁；Settings 另有頁面內備用鍵與錄製器
- **右緣漂浮面板**：滑鼠靠近頁面右邊緣自動展開 iOS 玻璃質感面板，session 管理與保存 wizard 都在頁面內完成（不再使用 Chrome side panel）
- **頁內 Gallery**：沒有待保存項目時，靠近右緣即浮出可捲動、可一鍵複製的 INPUT / OUTPUT prompt 庫（圖書館簡便版）
- **設定彈出框**：點擊工具列圖示開啟概略設定（快速開關 + 角色出現方式 / 召喚鍵），細項設定另開本地網頁
- 文字 / 圖片 / 影片 capture session，含 overlay 框線（顏色依角色變化）
- 角色規則：文字可四種角色；圖片與影片只能 Input Reference / Output
- 重複 / 重疊選取偵測：Conflict Card（取代或取消）
- 兩步 wizard：分類（選填、可快速新增）→ Model metadata（選填 / 自動偵測 / 自訂）
- Library Dashboard：搜尋、分類篩選、預覽、摘要、角色調整、檔案狀態與刪除
- Settings 備份與還原：匯出 / 匯入整個紀錄庫 ZIP，含標準 JSON 與可取得的媒體檔
- 刪除 Record 時可選擇是否連同本地下載檔案刪除
- Settings：語言、互動方式、分類管理、角色顏色、overlay / tray 開關與本地檔案資料夾入口
- 影片無法下載時顯示 Error Card，可 fallback 只保存來源——流程不會 crash

## Architecture

```
Content Script  ──選取/框線──▶  Background Service Worker  ──IndexedDB──▶  Library / Settings
     ▲   │ 頁內漂浮面板          │  session state、contextMenus、
     │   │ session UI、wizard、   │  chrome.downloads、錯誤映射、
     └───┘ Gallery、錯誤卡        └──  library/listRecords
                 Popup（概略設定，點工具列圖示開啟）
```

- `src/core/`：domain entities、enums、validation、session、overlap、export / backup、error / conflict model（純 TS，無 Chrome API，可單元測試）
- `src/storage/`：IndexedDB（version 1 migration）、repositories、seed、commit service
- `src/ui/`：role colors、settings store、共用 hooks / CSS
- `entrypoints/`：background、content、popup、library、settings（WXT）

詳見 [docs/architecture.md](docs/architecture.md)。

## Tech Stack

WXT · TypeScript · React · Chrome Extension Manifest V3 · IndexedDB · chrome.storage / contextMenus / downloads · Vitest

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
4. 點 extension 圖示開啟設定彈出框（內含 Library / 詳細設定連結）。

## Usage

1. 在任何網頁反白文字 → 按召喚鍵（預設 **Alt+S**）→ 選取處浮出角色選項，點一下即加入（也可在 Settings 改成反白後自動出現，或用右鍵選單）。
2. 圖片 / 影片 → 游標移上去按召喚鍵（只會出現合法角色），或右鍵 → **PromptTrace：加入圖片 / 加入影片**。
3. 滑鼠移到頁面右緣 → 漂浮面板展開，可調整角色（圖片 / 影片不能選 Negative）、移除項目。
4. 按 **✓ 保存** → Step 1 選分類（可不選）→ Step 2 確認 Model metadata（可不選）。
5. 開 **Library** 搜尋、預覽、產生摘要、調整分類 / 模型 / 角色、刪除。
6. 在 **Settings** 自訂語言、觸發方式、工具列按鈕、分類、角色顏色與開關，或匯出 / 匯入整個紀錄庫 ZIP。

## Permissions Explanation

| 權限 | 用途 |
| --- | --- |
| `<all_urls>` / `activeTab` / `scripting` | 讀取你主動選取的文字與右鍵選到的媒體 URL、畫 overlay 框線。不讀其他內容。 |
| `contextMenus` | 提供右鍵「加入 PromptTrace」選單。 |
| `downloads` | 把媒體下載到 `Downloads/PromptTrace/`；刪除 Record 時可選擇刪除這些檔案。 |
| `storage` | 保存設定（角色顏色、匯出偏好）。 |
| `clipboardWrite` | 頁內 Gallery 複製 prompt / 圖片。 |

## Local-first Privacy Note

- 所有資料（Prompt 文字、metadata、檔案索引）保存在本機：IndexedDB + `Downloads/PromptTrace/`。
- 不上傳任何資料、不呼叫任何 LLM API、不蒐集 analytics、無帳號、無雲端。
- 本地檔案路徑只存在本機資料庫中，匯出時可在 Settings 關閉「包含檔案路徑」。

## Testing

```bash
npm test
```

- Unit：role / asset / category / model metadata 驗證、duplicate-overlap 偵測、Markdown / JSON export、backup zip、copy bundle、error / conflict 映射、session state。
- Integration（fake-indexeddb）：seed、commit session、FileRecord 建立、下載失敗狀態、delete cascade。
- 手動 E2E：見 [tests/e2e/manual-e2e.md](tests/e2e/manual-e2e.md) 與 [docs/demo/demo-script.md](docs/demo/demo-script.md)。

## Known Limitations

- **不是所有影片都能下載。** blob URL、MediaSource 串流、DRM 內容、需登入授權的媒體都拿不到可下載 URL；此時顯示 Error Card，可選擇只保存來源頁連結。
- 圖片下載也可能因跨域、登入、防盜鏈失敗；失敗會標記 FileRecord 為 failed，可重試。
- 重疊選取偵測在 DOM 劇烈變動（如虛擬列表）後可能失準，會退化為文字包含比對。
- 刪除本地檔案依賴 `chrome.downloads.removeFile`，只能刪 extension 自己下載的檔案；使用者手動移動過的檔案會回報 `file_not_found`。
- 僅支援 Chrome（MV3）。擷取 UI 為頁內注入的 content script，載入擴充前已開啟的分頁需 F5 重整才會生效。
- Gallery 圖片縮圖以原始 URL best-effort 顯示，URL 失效時自動隱藏（content script 讀不到本地下載路徑）。
- 備份 ZIP 只能收進 extension 目前可取得的媒體 bytes；已過期遠端 URL 或只能從本機路徑讀取的舊檔，可能只保留 metadata。

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

### 2026-07-01 收工

**做了什麼：**（commit `6f7195b`）
- 初始化 repo-local agent guidance：新增 `AGENTS.md`，並把 `.codegraph/` 加入 ignore；CodeGraph 已可用。
- 修右側 P / gallery 浮窗體驗：overlay root 改成 0x0 fixed，避免頁面右側多出一條 scrollbar；Gallery 支援 hover-open、釘選、關閉與 Escape；右鍵選單去掉 emoji。
- Popup 增加 `P 邊欄高度` reset，滑出控制框後立即消失。
- Library 改為工作台布局：左 filter、中央大卡片、右側 detail inspector；detail 改為點擊 / focus 固定選取，不再 hover 到哪張右邊就跳哪張；空狀態區分「尚無紀錄」與「沒有符合篩選」。
- Settings 改寬版布局：互動設定與分類並排、Model Presets 全寬表格化、顯示 / 匯出並排、權限說明全寬；分類 icon 移除，只保留顏色。
- 原廠分類收斂為 4 個：生文 / 生圖 / 生影 / 生音樂，並提供「重置原廠分類」。
- 修 content panel 的 Library / Settings 導航：改由 background 開 extension page，避免 `ERR_BLOCKED_BY_CLIENT`。
- 補 `src/ui/base.css` surface / stroke / radius / shadow token，讓後續統一 UI 有基礎。

**驗證：**
- `npm run compile`
- `npm run build`
- Playwright 載入 `.output/chrome-mv3` 檢查 Library / Settings 真 extension 頁面截圖。

**下次方向：**
- 用真資料 profile 看 Library 卡片與右側 detail 的視覺密度；必要時微調卡片比例與 output 圖片優先級。
- 對 content panel 的釘選 / 關閉 / Escape 做一輪 e2e 或手動 Chrome 驗證。
- Settings 下一輪可把 taxonomy / model presets 收成 Advanced，進一步降低第一屏壓力。

### 2026-06-18 收工

**做了什麼：**（commit 本次一坨；主題：gallery/擷取 UX 打磨，讓「攜帶 prompt」真的站得住）
- **OUTPUT 圖片不再空白（根治 CSP / 限時 URL）**：commit 時背景 SW 趁簽名 URL 還活著抓 bytes，用 OffscreenCanvas 縮成 768px webp dataURL 存進 `asset.previewRef`（`background.ts cacheAssetPreview`）。Gallery／Library 改 `previewRef ?? originalUrl`。解掉 2026-06-16「下次方向②」的 ChatGPT-CSP 縮圖空白。
- **下載靜默**：`chrome.downloads.download({ saveAs: promptDownloadLocation === true })`，預設 false 壓過 Chrome 全域「下載前詢問」；Settings 加開關。
- **OUTPUT 點擊放大**：非 modal 浮窗（`Lightbox`），靠左、等比縮放、留 480px 給右側 gallery、滑離 gallery 自動消失。提到 PanelApp root 渲染（避開 `.pt-glass` 的 backdrop-filter containing block 把 `position:fixed` 困住）。
- **卡片右鍵 編輯/刪除**：編輯=左側飛出 `CardEditor`（重選分類＋model，不再卡片內捲動）；刪除=選單原地確認（拿掉 `window.confirm` 的螢幕中央彈窗）。背景加 `library/deleteRecord` / `library/updateRecordMeta`。
- **智慧預設**：擷取 wizard 依 output assetType ✨ 標亮建議分類（`builtin-image-gen` 等）。
- **快捷鍵召喚修正**：`elementsFromPoint` 穿透 ChatGPT 生成圖上的 overlay，右鍵後也抓得到；預設改 `Shift+Z`；加打字保護（無選取/無媒體時不攔截可打印鍵）。
- **Toolbar 不再往左跳**：`pt-pop` keyframe 把 `translateX(-50%)` 焊進每一格。
- **右緣 P tab 可調高度**：popup 滑桿（`edgeTabTop`）；面板改「位移不縮高」留在畫面內並覆蓋 tab；hover-dock 的 `padding-right` 讓邊緣間隙也算 hover 區（不閃跳）；tab transition 拿掉 transform（收合不上下跳）。

**踩到的坑：**
- `position:fixed` 會被祖先的 `backdrop-filter`／`transform` 變成 containing block 困住 → 浮窗類（lightbox）要提到 `.pt-glass` 外層渲染。
- `document` capture 階段的 click 監聽 + shadow DOM event retarget → 會在按鈕 onClick 前關掉選單（編輯/刪除沒反應）；改用 React 樹內透明 backdrop。
- 高面板（86vh）在 100vh 內幾乎無移動空間：硬縮高會變「一小欄 sliver」→ 改成固定高 + clamp 位移。
- `chrome.downloads` 的 `saveAs:false` 才壓得住全域「詢問位置」；省略會跟隨全域設定。

**下次方向：**
- ⚠️ **先 reload 擴充**（`.output/chrome-mv3/`）讓背景 SW + content script 新邏輯生效，再測：下載不跳框 / 右鍵編輯刪除 / P 高度滑桿 / 浮窗。
- 未驗的真站項：previewRef 對**真 ChatGPT 生成圖**的 fetch（browse 不穩、e2e 用 mock，邏輯已驗但沒對線上跑）；若空白看 SW fetch/CSP log。
- 已知小邊角：卡片極少（面板內容 < 86vh）+ P 拉到最頂/底極端時，hover 覆蓋可能差一點 → 真遇到再給面板加 min-height。
- 待辦 feature：純圖牆 `image-wall` gallery 模式（多模式可切換、純文字卡優雅降級）——使用者要先生圖填真實資料再調欄數（見 memory [[ui-preferences]] 14）。

### 2026-06-16 收工

**做了什麼：**（commits `4133de5` / `f31d79e` / `26f1e96`）
- **Playwright e2e harness**（取代 Windows 上不可靠的 gstack `browse` daemon）：`playwright.config.ts` + `tests/e2e/`，載入已 build 擴充、穿透 shadow DOM、grant clipboard 權限。每次 run 單一自含行程、無 daemon 即無被 kill 問題。5 個 spec：injection / capture+overlay 巢狀捲動 / **dismiss（工具列捲動消失回歸測試）** / popup 持久化 / clipboard 複製。`npm run test:e2e`（build + 跑）。
- **面板拆分**：原本右上角「一格兩用」拆成 **CapturePanel（右上、僅擷取中）** + **GalleryPanel（右側中間、純 hover、滑開即收、tab 與面板同高不跳位）**。
- **下載檔副檔名修正**：來源 URL 結尾 `/content`（ChatGPT/Gemini 圖）會存成無副檔名打不開檔；`mediaFilename()` 依 assetType 補 `.png`/`.mp4`。
- **模型自動偵測**：`src/core/capture/detectProvider.ts`（4 unit test）依擷取頁 hostname 認 GPT/Claude/Gemini/…；wizard Model 步驟最上方一鍵「✨ 偵測自頁面」。
- **Wizard `✕ 取消`**：兩步 footer 都可一鍵跳出（離開 wizard、保留已擷取項目）。
- **卡片左右兩欄 + `cardLayout` 設定**：頁內 Gallery 與 Library 列表卡片都顯示「左 Input·Reference｜右 Output」；設定欄可切「左右顯示 / 只顯示 Output」，即時生效。
- **召喚鍵 authoritative**：移除 manifest 寫死的 `Alt+S`（`suggested_key`），設定裡的頁內召喚鍵變成唯一主鍵。
- **工具列捲動消失 bug 修正**：選取工具列的 scroll 監聽改 capture 階段，巢狀容器（ChatGPT pane）捲動也會消失。

**踩到的坑：**
- `browse` daemon 在這台 Windows **間歇性**被 kill（log 顯示 4/26 曾成功），且 headless 對 MV3 content-script/shadow/clipboard/CSP 本來就驗不準 → 改用 Playwright e2e（見 memory [[feedback-browse-tool-windows]]）。
- `chrome.commands` 的瀏覽器層級快捷鍵**無法**由擴充設定改寫（只能使用者去 `chrome://extensions/shortcuts`），所以「設定裡的召喚鍵」過去只是頁內 fallback，與 Alt+S 兩條獨立路徑 → 使用者誤以為改了沒用。
- content script 內 `<img src=遠端>` 受**宿主頁 CSP** 管轄，ChatGPT 真站縮圖很可能空白（預期限制非 bug）。

**下次方向：**
- ⚠️ **先重新載入擴充一次**（`chrome://extensions` reload `.output/chrome-mv3/`），讓「移除 Alt+S」的新 manifest 生效；之後只有設定裡的召喚鍵會作用。
- **剩下只能手動 F5 驗的視覺/真站項**（e2e 用本地 fixture 測不到）：① 圖示變橘 P + 點出 popup ② **真 ChatGPT 的 Gallery 圖片縮圖**（大機率空白＝CSP 限制；要修得改存本地 thumbnail dataURL，見下）③ 圖片 summon 工具列只剩 Input Reference / Output。
- 可選 feature：Gallery 圖片縮圖改存**本地 thumbnail dataURL**（根治 CSP/限時 URL 失效）；ChatGPT 串流內容長高時 overlay 飄移要加 `ResizeObserver`。

### 2026-06-14 收工

**做了什麼：**（commit `9d367c6`）
- 移除 Chrome side panel（連 entrypoint + `sidePanel` 權限），改用 browser-action **popup** 當「概略設定」（4 快速開關 + 角色出現方式 / 召喚鍵 + Library / 詳細設定連結）；點工具列圖示不再開側欄。
- Branding：新增 P icon（`public/icon/{16..128}.png` + manifest `icons`/`action.default_icon`），UI 內 ✦ 全換成 logo（content script 用 inline data URI `entrypoints/content/logo.ts` 避免破圖；popup 用 `/icon/128.png`）。
- 角色規則：圖片與影片只能 Input Reference / Output（移除 Input、Negative）；同步更新 `validation.ts` + 測試 + `ROLE_NOT_ALLOWED_MESSAGE`。
- Overlay 追蹤修復：scroll listener 改 **capture 階段** + `requestAnimationFrame`，能追內層捲動容器（ChatGPT），不再黏 viewport。
- Edge panel UX：有項目時常駐不收、空時移開瞬間收（移除 350ms 延遲）、hover 觸發限可見圓框 tab（移除全高隱形帶）、開啟時頂部對齊、wizard 時面板變窄（232px）。
- Wizard 重寫：分類 / Model 改窄直向一鍵清單（分類 → Model → 入庫），移除 `<select>` 與「下一步」。
- 飄浮 **Gallery**：沒有待存項目時 hover 右緣 → 可捲動、可複製的 INPUT / OUTPUT prompt 庫（新增 `library/listRecords` 訊息 + background handler；content script 讀不到擴充 IndexedDB 故走 background 撈）。

**踩到的坑：**
- content script 在 shadow DOM 載入圖片需 `web_accessible_resources`（`chrome.runtime.getURL`）；為零破圖風險改用 inline data URI。
- WXT 會從 popup 的 `<title>` 自動推導 `action.default_title` / `default_popup`，覆蓋 `wxt.config` 裡手寫的 `default_title`。
- 所有改動只跑過 `tsc` / `build` / 56 tests，**Windows 無法用 browse 自動驗 Chrome 行為**。

**下次方向：**
- **全部改動尚未在 Chrome 實機驗證**。先：移除舊擴充 → 重新載入 `.output/chrome-mv3/` → 對頁面按 F5，逐項驗：
  - 工具列圖示變橘 P；點圖示出現設定彈出框（非側欄）
  - content script 仍會注入（EdgePanel 現在是唯一擷取 UI、無 fallback）：Console 看 `[PromptTrace]`、Elements 找 `<prompttrace-ui>`
  - Gallery：空狀態 hover 右緣浮出、點 prompt 會複製（注意 `navigator.clipboard` 是否被該頁擋）
  - overlay 追蹤：ChatGPT 框選後捲動，框跟著文字移動
  - 圖片 / 影片 summon 工具列只剩 Input Reference / Output、無破方框
- 未決：使用者提過「保存選種類在右上角」——目前保存流程仍在擷取面板內（有待存項目時顯示），若要移位再處理。
- 邊角：ChatGPT 串流內容長高（非捲動）時 overlay 可能飄，要根治需加 `ResizeObserver`；Gallery 圖片縮圖常失效時可考慮存 thumbnail dataURL。

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
