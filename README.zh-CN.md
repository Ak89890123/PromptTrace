# PrompTrace

**PrompTrace 是一个 local-first Chrome 扩展，用来采集、标记、整理、复制、摘要、导出、恢复与删除 AI prompt 工作流素材。**

它适合经常在 AI 聊天工具、图像生成工具、视频生成工具、参考网页与本地文件之间来回工作的用户。PrompTrace 让你把主动选择的文字、图片、视频保存为结构化记录，之后可以追踪哪个输入、参考、排除条件与输出属于同一组。

PrompTrace **不是** LLM 客户端、不是 prompt 生成器、不是云同步服务、不是账号系统、不是 analytics 工具，也不是通用下载器。

<p>
  <a href="README.md">English</a> ·
  <a href="README.zh-TW.md">繁體中文</a> ·
  <a href="README.zh-CN.md">简体中文</a>
</p>

## 解决的问题

AI 工作常常把重要素材分散在聊天记录、截图、下载文件夹、笔记与标签页里。多做几轮后，很难回答：

- 这张输出图是哪段 prompt 生成的？
- 当时用了哪张图或哪段视频当参考？
- 哪个 negative prompt 或排除条件有效？
- 这个素材原本来自哪个网页？
- 能不能不用翻五个旧标签页就快速重用 prompt？

PrompTrace 会把这些分散的素材整理成可搜索的本地记录库。

## 核心工作流

1. 在网页上选中文字，按召唤快捷键，选择角色。
2. 鼠标移到图片或视频上，或使用右键菜单，把媒体保存为参考或输出。
3. PrompTrace 会在页面上用角色颜色边框标记已保存内容。
4. 鼠标移到页面右侧边缘，打开玻璃质感浮动面板。
5. 检查本次 capture session，选择分类后保存到本地记录库。
6. 在 Library 中搜索、预览、复制、摘要、导出、恢复或删除记录。

## 功能

- **角色化采集**：把素材保存为 Input、Input Reference、Negative、Output。
- **智能角色限制**：文字可使用所有角色；图片与视频只能作为 Input Reference 或 Output。
- **召唤快捷键**：在选中文字或鼠标所在媒体旁显示保存按钮。
- **右键菜单采集**：通过浏览器 context menu 保存选中文字、图片与视频。
- **右侧浮动面板**：不用离开当前页面即可采集与浏览保存记录。
- **页内 Gallery**：浏览保存记录、按分类筛选、拖拽卡片换分类、复制 prompt 栏位。
- **Library Dashboard**：搜索记录、分类筛选、预览输入与输出、调整角色、生成摘要、管理记录。
- **垃圾桶与保留时间**：记录可移到垃圾桶、恢复、立即永久删除，或按设置天数自动清理。
- **可选摘要功能**：使用自己的 API key 与摘要 provider。摘要功能为可选并由用户设置。
- **备份与恢复**：把本地记录库导出 / 导入为 ZIP，包含 metadata 与可取得的媒体文件。
- **Local-first 存储**：记录保存在 IndexedDB，设置保存在 chrome.storage，下载媒体放在浏览器 Downloads 文件夹。

## 架构

```text
Content Script  ── 选择 / overlay / 页内 UI ──▶ Background Service Worker
      ▲                                      │
      │                                      ├─ IndexedDB repositories
      │                                      ├─ chrome.storage settings
      │                                      ├─ chrome.downloads media files
      │                                      └─ 定时摘要 / 垃圾桶清理
      │
      └── 右侧浮动面板 / Gallery

Extension pages: Popup · Library · Settings · Trash
```

主要文件夹：

| 路径 | 用途 |
| --- | --- |
| `entrypoints/background.ts` | Service worker、消息路由、右键菜单、下载、alarms、摘要与垃圾桶任务。 |
| `entrypoints/content/` | Content script、shadow-root UI、浮动面板、overlay 边框、文字 / 媒体采集。 |
| `entrypoints/popup/` | 工具栏 popup，用于快速设置与导航。 |
| `entrypoints/library/` | 完整本地记录库 dashboard。 |
| `entrypoints/settings/` | 详细设置、分类、角色颜色、备份恢复、摘要设置。 |
| `entrypoints/trash/` | 可恢复的垃圾桶页面与保留时间设置。 |
| `src/core/` | 纯 TypeScript domain logic、validation、summary、exports、backup、errors、conflicts。 |
| `src/storage/` | IndexedDB schema、repositories、seed data、commit / delete services。 |
| `src/ui/` | 共享 UI 设置、角色颜色、hooks、tokens、base CSS、共享 wordmark。 |

详见 [docs/architecture.md](docs/architecture.md)。

## 技术栈

WXT · TypeScript · React · Chrome Extension Manifest V3 · IndexedDB · chrome.storage · chrome.contextMenus · chrome.downloads · Vitest · Playwright

## 开发安装

```bash
npm install
npm run dev
```

## 构建并加载到 Chrome

```bash
npm run build
```

接着：

1. 打开 `chrome://extensions`。
2. 开启「开发者模式」。
3. 点击「加载已解压的扩展程序」。
4. 选择 `.output/chrome-mv3`。
5. 如果原本已经打开网页，刷新标签页后 content script 才会生效。

## 常用命令

```bash
npm run compile      # TypeScript 检查
npm test             # Unit + integration tests
npm run build        # 构建未打包 Chrome MV3 extension
npm run zip          # 通过 WXT 打包 extension zip
npm run test:e2e     # 构建并运行 Playwright extension tests
```

## 发布流程

此 repo 会打包 extension，但**不会自动提交到 Chrome Web Store 审核**。

- `npm run zip` 会通过 WXT 创建 Chrome extension ZIP。
- `CD` GitHub Actions workflow 可执行 compile、test、package，并把 ZIP 上传为 workflow artifact。
- 推送 `v0.3.0` 这类 version tag 会创建 GitHub Release 并附上 packaged ZIP。
- Chrome Web Store 提交审核仍需在 Developer Dashboard 手动上传与提交。

## 权限说明

| 权限 | PrompTrace 使用原因 |
| --- | --- |
| `contextMenus` | 添加用户主动触发的 PrompTrace 右键动作，用于保存选中文字、图片或视频。 |
| `downloads` | 把用户选择的媒体下载到 PrompTrace 文件夹；永久删除时尽可能移除 extension 创建的文件。 |
| `storage` | 存储 UI 偏好、角色颜色、快捷键、摘要设置、垃圾桶保留天数等设置。 |
| `alarms` | 执行本地定时任务，例如可选摘要检查与垃圾桶清理。 |
| `activeTab` | 在用户触发动作后与当前标签页交互。 |
| `scripting` | 把已打包的 PrompTrace content script 与 UI 注入用户使用的页面。 |
| `clipboardWrite` | 用户点击复制时，把保存的 prompt 文字写入剪贴板。 |
| Host permissions | 让 PrompTrace 能在用户选择使用的网站上处理用户主动选择的内容。 |

## 隐私

PrompTrace 采用 local-first 设计。

- Captured records 保存在用户浏览器本地。
- 用户设置保存在 `chrome.storage`。
- 下载媒体保存在浏览器 Downloads 文件夹。
- 不出售用户数据。
- 不使用广告 analytics。
- 不使用远程可执行代码。
- 只有在用户主动启用并设置摘要 provider 时，选定记录文字才可能发送到用户设置的 provider 以生成摘要。

隐私政策：[docs/privacy.html](docs/privacy.html)

Chrome Web Store 可使用的公开隐私政策网址：

```text
https://ak89890123.github.io/PromptTrace/privacy.html
```

## 已知限制

- 部分媒体无法下载，例如 blob URL、MediaSource 串流、DRM 保护媒体、需要授权的媒体、防盗链来源。
- 远程媒体 URL 过期时，PrompTrace 会尽可能保留 metadata 与可用预览。
- `chrome.downloads.removeFile` 只能移除 extension 创建且 Chrome 仍能识别的下载文件。
- 重新加载未打包 extension 后，已有标签页需要刷新才会套用新的 content script。
- 目前主要支持 Chrome。

## 文档

- [Architecture](docs/architecture.md)
- [Privacy Policy](docs/privacy.html)
- [Demo Script](docs/demo/demo-script.md)
- [Architecture Decision Records](docs/adr/)
- [Changelog](CHANGELOG.md)

## License

MIT — 见 [LICENSE](LICENSE)。
