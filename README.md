# PrompTrace

**PrompTrace is a local-first Chrome extension for capturing, labeling, organizing, copying, summarizing, exporting, restoring, and deleting prompt workflow assets.**

It is built for people who move between AI chat tools, image generators, video tools, reference pages, and local files. PrompTrace lets you intentionally save selected text, images, and videos as structured records, then trace which input, reference, negative prompt, and output belonged together.

PrompTrace is **not** an LLM client, prompt generator, cloud sync service, account system, analytics tool, or general-purpose downloader.

<p>
  <a href="README.md">English</a> ·
  <a href="README.zh-TW.md">繁體中文</a> ·
  <a href="README.zh-CN.md">简体中文</a>
</p>

## What it solves

AI work often leaves useful material scattered across chat history, screenshots, downloads, notes, and tabs. After a few iterations, it becomes hard to answer:

- Which output came from which prompt?
- Which image or video was used as a reference?
- Which negative prompt or exclusion instruction worked?
- Where did this saved asset come from?
- Can I quickly reuse this prompt without opening five old pages?

PrompTrace turns those scattered assets into a searchable local library.

## Core workflow

1. Select text on a page, press the summon hotkey, and choose a role.
2. Hover over an image or video, or use the context menu, to save media as a reference or output.
3. PrompTrace draws role-colored frames on saved page content.
4. Move your mouse to the right edge of the page to open the floating glass panel.
5. Review the capture session, choose a category, and save it to the local library.
6. Search, preview, copy, summarize, export, restore, or delete records from the Library.

## Features

- **Role-based capture**: save assets as Input, Input Reference, Negative, or Output.
- **Smart role rules**: text can use all roles; images and videos are limited to Input Reference or Output.
- **Summon hotkey**: show save buttons near selected text or hovered media.
- **Context menu capture**: save selected text, images, and videos from the browser context menu.
- **Right-edge floating panel**: capture and browse saved prompt records without leaving the page.
- **In-page gallery**: browse saved records, filter by category, drag cards between categories, and copy prompt columns.
- **Library dashboard**: search records, filter categories, preview inputs and outputs, edit roles, generate summaries, and manage records.
- **Trash with retention**: move records to Trash, restore them, delete immediately, or auto-purge after the configured retention period.
- **Optional summaries**: bring your own API key and summary provider. Summaries are optional and user-configured.
- **Backup and restore**: export/import the local library as a ZIP, including metadata and available media files.
- **Local-first storage**: records, configurable low/medium/high canonical previews, and legacy-compatible metadata live in IndexedDB; settings live in chrome.storage.

## Architecture

```text
Content Script  ── selection / overlay / page UI ──▶ Background Service Worker
      ▲                                             │
      │                                             ├─ IndexedDB repositories
      │                                             ├─ chrome.storage settings
      │                                             ├─ IndexedDB canonical media previews
      │                                             └─ scheduled summary / trash tasks
      │
      └── Right-edge floating panel / gallery

Extension pages: Popup · Library · Settings · Trash
```

Key folders:

| Path | Purpose |
| --- | --- |
| `entrypoints/background.ts` | Service worker, message routing, context menus, durable preview jobs, alarms, summary and trash jobs. |
| `entrypoints/content/` | Content script, shadow-root UI, floating panel, overlay frames, selection/media capture. |
| `entrypoints/popup/` | Browser-action popup for quick settings and navigation. |
| `entrypoints/library/` | Full local library dashboard. |
| `entrypoints/settings/` | Detailed settings, categories, role colors, backup/restore, summary settings. |
| `entrypoints/trash/` | Restore-able trash page with retention controls. |
| `src/core/` | Pure TypeScript domain logic, validation, summary, exports, backup, errors, conflicts. |
| `src/storage/` | IndexedDB schema, repositories, seed data, commit and delete services. |
| `src/ui/` | Shared UI settings, role colors, hooks, tokens, base CSS, shared wordmark. |

See [docs/architecture.md](docs/architecture.md) for a deeper overview.

## Tech stack

WXT · TypeScript · React · Chrome Extension Manifest V3 · IndexedDB · chrome.storage · chrome.contextMenus · Vitest · Playwright

## Install for development

```bash
npm install
npm run dev
```

## Build and load in Chrome

```bash
npm run build
```

Then:

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select `.output/chrome-mv3`.
5. Refresh any already-open web pages before testing the content script.

## Common commands

```bash
npm run compile      # TypeScript check
npm test             # Unit + integration tests
npm run build        # Build unpacked Chrome MV3 extension
npm run zip          # Package extension zip through WXT
npm run test:e2e     # Build and run Playwright extension tests
```

## Release process

This repository packages the extension but does **not** automatically submit it to the Chrome Web Store.

- `npm run zip` creates a Chrome extension ZIP through WXT.
- The `CD` GitHub Actions workflow can compile, test, package, and upload the ZIP as a workflow artifact.
- Version tags such as `v0.3.0` create a GitHub Release with the packaged ZIP.
- Chrome Web Store submission is manual from the Developer Dashboard.

## Permissions

| Permission | Why PrompTrace uses it |
| --- | --- |
| `contextMenus` | Adds user-triggered PrompTrace actions to save selected text, images, or videos. |
| `storage` | Stores extension settings such as UI preferences, role colors, hotkeys, summary settings, and trash retention days. |
| `alarms` | Runs local scheduled tasks such as optional summary checks and trash cleanup. |
| `activeTab` | Interacts with the current active tab after a user action. |
| `scripting` | Injects packaged PrompTrace content scripts and UI into pages where the user uses the extension. |
| `clipboardWrite` | Copies saved prompt text to the clipboard when the user clicks copy actions. |
| Host permissions | Allows PrompTrace to work on user-selected content across websites where the user chooses to use it. |

## Privacy

PrompTrace is designed as a local-first extension.

- Captured records are stored locally in the browser.
- User settings are stored in `chrome.storage`.
- Canonical media previews are stored in IndexedDB using the low/medium/high quality selected when each asset is captured; original URLs remain source metadata when available, and original media files are not downloaded.
- The extension does not sell user data.
- The extension does not use advertising analytics.
- The extension does not use remote executable code.
- Optional summaries may send selected record text to the user-configured summary provider only when the user enables and configures that feature.

Privacy policy: [docs/privacy.html](docs/privacy.html)

Public privacy policy URL for Chrome Web Store review:

```text
https://ak89890123.github.io/PromptTrace/privacy.html
```

## Known limitations

- Some media cannot be previewed, such as blob URLs, MediaSource streams, DRM-protected media, authenticated media, or anti-hotlinking sources; the source URL is retained when available.
- If a remote media URL expires, PrompTrace keeps metadata and available previews where possible.
- Existing legacy download metadata remains readable, but new capture, delete, trash cleanup, backup, and restore do not touch the file system.
- Existing tabs must be refreshed after reloading the unpacked extension.
- Chrome is the primary supported browser target.

## Documentation

- [Architecture](docs/architecture.md)
- [Privacy Policy](docs/privacy.html)
- [Demo Script](docs/demo/demo-script.md)
- [Architecture Decision Records](docs/adr/)
- [Changelog](CHANGELOG.md)

## License

MIT — see [LICENSE](LICENSE).
