# PrompTrace

**PrompTrace 是一個 local-first Chrome 擴充功能，用來擷取、標記、整理、複製、摘要、匯出、還原與刪除 AI prompt 工作流素材。**

它適合常在 AI 聊天工具、生圖工具、生影工具、參考網頁與本機檔案之間來回工作的使用者。PrompTrace 讓你把主動選取的文字、圖片、影片保存成結構化紀錄，之後可以追蹤哪個輸入、參考、排除條件與輸出是同一組。

PrompTrace **不是** LLM 客戶端、不是 prompt 生成器、不是雲端同步服務、不是帳號系統、不是 analytics 工具，也不是一般用途下載器。

<p>
  <a href="README.md">English</a> ·
  <a href="README.zh-TW.md">繁體中文</a> ·
  <a href="README.zh-CN.md">简体中文</a>
</p>

## 解決的問題

AI 工作常常把重要素材分散在聊天紀錄、截圖、下載資料夾、筆記與分頁裡。多做幾輪後，很難回答：

- 這張輸出圖是哪段 prompt 生成的？
- 當時用了哪張圖或哪段影片當參考？
- 哪個 negative prompt 或排除條件有效？
- 這個素材原本來自哪個網頁？
- 能不能不用翻五個舊分頁就快速重用 prompt？

PrompTrace 會把這些分散的素材整理成可搜尋的本機紀錄庫。

## 核心工作流

1. 在網頁上反白文字，按召喚快捷鍵，選擇角色。
2. 游標移到圖片或影片上，或用右鍵選單，把媒體保存為參考或輸出。
3. 滑鼠移到頁面右側邊緣，打開玻璃質感漂浮面板。
4. 檢查本次 capture session，選擇分類後保存到本機紀錄庫。
5. 在 Library 搜尋、預覽、複製、摘要、匯出、還原或刪除紀錄。

## 功能

- **角色化擷取**：把素材保存為 Input、Input Reference、Negative、Output。
- **智慧角色限制**：文字可使用所有角色；圖片與影片只能作為 Input Reference 或 Output。
- **召喚快捷鍵**：在反白文字或游標所在媒體旁顯示保存按鈕。
- **右鍵選單擷取**：透過瀏覽器 context menu 保存選取文字、圖片與影片。
- **右側漂浮面板**：不用離開當前頁面即可擷取與瀏覽保存紀錄。
- **頁內 Gallery**：瀏覽保存紀錄、按分類篩選、拖曳卡片換分類、複製 prompt 欄位。
- **Library Dashboard**：搜尋紀錄、分類篩選、預覽輸入與輸出、調整角色、產生摘要、管理紀錄。
- **垃圾桶與保留時間**：紀錄可移到垃圾桶、還原、立即永久刪除，或依設定天數自動清理。
- **選用摘要功能**：使用自己的 API key 與摘要 provider。摘要功能為選用且由使用者設定。
- **備份與還原**：把本機紀錄庫匯出 / 匯入成 ZIP，包含 metadata 與可取得的媒體檔。
- **Local-first 儲存**：紀錄與固定格式的精簡媒體預覽保存在 IndexedDB，設定保存在 chrome.storage；舊版下載中繼資料仍可讀取。

## 架構

```text
Content Script  ── 選取 / 頁內 UI ──▶ Background Service Worker
      ▲                                      │
      │                                      ├─ IndexedDB repositories
      │                                      ├─ chrome.storage settings
      │                                      ├─ IndexedDB canonical media previews
      │                                      └─ 排程摘要 / 垃圾桶清理
      │
      └── 右側漂浮面板 / Gallery

Extension pages: Popup · Library · Settings · Trash
```

主要資料夾：

| 路徑 | 用途 |
| --- | --- |
| `entrypoints/background.ts` | Service worker、訊息路由、右鍵選單、下載、alarms、摘要與垃圾桶任務。 |
| `entrypoints/content/` | Content script、shadow-root UI、漂浮面板、文字 / 媒體擷取。 |
| `entrypoints/popup/` | 工具列 popup，用於快速設定與導航。 |
| `entrypoints/library/` | 完整本機紀錄庫 dashboard。 |
| `entrypoints/settings/` | 詳細設定、分類、角色顏色、備份還原、摘要設定。 |
| `entrypoints/trash/` | 可還原的垃圾桶頁面與保留時間設定。 |
| `src/core/` | 純 TypeScript domain logic、validation、summary、exports、backup、errors、conflicts。 |
| `src/storage/` | IndexedDB schema、repositories、seed data、commit / delete services。 |
| `src/ui/` | 共用 UI 設定、角色顏色、hooks、tokens、base CSS、共用 wordmark。 |

## 技術棧

WXT · TypeScript · React · Chrome Extension Manifest V3 · IndexedDB · chrome.storage · chrome.contextMenus · Vitest · Playwright

## 開發安裝

```bash
npm install
npm run dev
```

## 建置並載入 Chrome

```bash
npm run build
```

接著：

1. 打開 `chrome://extensions`。
2. 開啟「開發人員模式」。
3. 點「載入未封裝項目」。
4. 選擇 `.output/chrome-mv3`。
5. 如果原本已經開著網頁，重新整理分頁後 content script 才會生效。

## 常用指令

```bash
npm run compile      # TypeScript 檢查
npm test             # Unit + integration tests
npm run build        # 建置未封裝 Chrome MV3 extension
npm run zip          # 透過 WXT 打包 extension zip
npm run test:e2e     # 建置並執行 Playwright extension tests
```

## 發布流程

`CD` GitHub Actions workflow 會打包 extension，並可送交 Chrome Web Store 審核。

- `npm run zip` 會透過 WXT 建立 Chrome extension ZIP。
- `CD` GitHub Actions workflow 可執行 compile、test、package，並把 ZIP 上傳成 workflow artifact。
- 推送 `v0.3.0` 這類 version tag 會建立 GitHub Release，接著上傳同一份已測試的 ZIP 並送交 Chrome Web Store 審核。
- 手動執行 workflow 時，只有啟用 `publish_to_chrome` 才會送審；預設對象為 `trustedTesters`，選擇 `default` 才會送往公開使用者。
- 發布 job 使用受保護的 GitHub environment `chrome-web-store`。第一次發布前，請設定 environment variable `CHROME_EXTENSION_ID`，以及 secrets `CHROME_CLIENT_ID`、`CHROME_CLIENT_SECRET`、`CHROME_REFRESH_TOKEN`。
- 若每次送審都要人工確認，請在 `chrome-web-store` environment 加入 required reviewers。商店審核與實際 rollout 仍由 Chrome Web Store Developer Dashboard 控制。

## 權限說明

| 權限 | PrompTrace 使用原因 |
| --- | --- |
| `contextMenus` | 加入使用者主動觸發的 PrompTrace 右鍵動作，用於保存選取文字、圖片或影片。 |
| `storage` | 儲存 UI 偏好、角色顏色、快捷鍵、摘要設定、垃圾桶保留天數等設定。 |
| `alarms` | 執行本機排程任務，例如選用摘要檢查與垃圾桶清理。 |
| `activeTab` | 在使用者觸發動作後與目前分頁互動。 |
| `scripting` | 把已打包的 PrompTrace content script 與 UI 注入使用者使用的頁面。 |
| `clipboardWrite` | 使用者點擊複製時，把保存的 prompt 文字寫入剪貼簿。 |
| Host permissions | 讓 PrompTrace 能在使用者選擇使用的網站上處理使用者主動選取的內容。 |

## 隱私

PrompTrace 採 local-first 設計。

- Captured records 保存在使用者瀏覽器本機。
- 使用者設定保存在 `chrome.storage`。
- 固定格式的精簡媒體預覽保存在 IndexedDB；新流程不會建立或修改本機媒體檔案。
- 不販售使用者資料。
- 不使用廣告 analytics。
- 不使用遠端可執行程式碼。
- 只有在使用者主動啟用並設定摘要 provider 時，選定紀錄文字才可能送到使用者設定的 provider 以產生摘要。

隱私權政策：[docs/privacy.html](docs/privacy.html)

Chrome Web Store 可使用的公開隱私權政策網址：

```text
https://ak89890123.github.io/PromptTrace/privacy.html
```

## 已知限制

- 部分媒體無法下載，例如 blob URL、MediaSource 串流、DRM 保護媒體、需要授權的媒體、防盜鏈來源。
- 遠端媒體 URL 過期時，PrompTrace 會盡可能保留 metadata 與可用預覽。
- 舊版下載中繼資料只讀；新擷取、刪除、垃圾桶清理、備份與還原都不會碰觸檔案系統。
- 重新載入未封裝 extension 後，既有分頁需要重新整理才會套用新的 content script。
- 目前主要支援 Chrome。

## 文件

- [Privacy Policy](docs/privacy.html)
- [Changelog](CHANGELOG.md)

## License

MIT — 見 [LICENSE](LICENSE)。
