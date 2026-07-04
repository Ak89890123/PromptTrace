# PrompTrace Agent Instructions

## Project Structure & Module Organization

PrompTrace is a local-first WXT Chrome extension using TypeScript, React, Manifest V3, IndexedDB, `chrome.storage`, context menus, downloads, and clipboard APIs. It has no backend, account system, cloud sync, LLM API calls, or analytics.

- `entrypoints/background.ts`: service worker, context menus, capture session source of truth, download tracking, message routing, and library mutation actions.
- `entrypoints/content/`: content script, shadow-root UI, overlay frames, selection/media capture, and the right-edge in-page panel/gallery.
- `entrypoints/popup/`, `entrypoints/library/`, `entrypoints/settings/`: extension pages for quick settings, library browsing, and detailed settings.
- `src/core/`: pure TypeScript domain logic, validation, capture/session reducers, overlap detection, exports, copy bundle composition, and error/conflict models. Prefer keeping Chrome APIs out of this layer.
- `src/storage/`: IndexedDB schema, repositories, seed data, and commit/delete services.
- `src/ui/`: shared UI settings, role colors, hooks, and base CSS.
- `tests/unit`, `tests/integration`, `tests/e2e`: Vitest unit/integration tests and Playwright extension harness tests.
- `docs/adr/`: architecture decisions; update or add ADRs when changing durable storage, privacy, backend, or extension platform assumptions.

`docs/architecture.md` is useful for data-flow orientation, but verify current behavior against source and README because some older notes may still mention the removed Chrome side panel.

## Build, Test, and Development Commands

Use the scripts in `package.json`; do not invent alternate command paths.

- `npm install`: install dependencies and run WXT prepare.
- `npm run dev`: start WXT development mode with extension reload support.
- `npm run build`: build the Chrome MV3 extension into `.output/chrome-mv3`.
- `npm run zip`: package the extension through WXT.
- `npm run compile`: run `tsc --noEmit`.
- `npm test`: run Vitest unit and integration tests.
- `npm run test:e2e`: build the extension and run Playwright against the real `.output/chrome-mv3` extension.

After changing manifest, background, content script, popup, library, settings, storage, or WXT config behavior, run at least `npm run compile` and the relevant Vitest tests. Use `npm run test:e2e` for browser behavior, shadow DOM UI, popup, clipboard, or extension injection changes.

## Coding Style & Naming Conventions

- The repo is strict TypeScript with ESM and React JSX. Preserve existing imports through the `@` alias.
- Keep domain logic in `src/core` pure and testable; route Chrome API access through entrypoints or storage services.
- Keep error and conflict handling separate: technical failures belong to the error model, user operation collisions belong to the conflict model.
- Keep role rules centralized in `src/core/domain/validation.ts`; do not duplicate asset-role constraints in UI components.
- Preserve the local-first privacy contract. Do not introduce network calls, telemetry, account state, or cloud sync without an explicit ADR and user approval.
- Avoid placing machine-specific paths, browser profile paths, secrets, or local download paths in source or docs.

## Testing Guidelines

- Add or update Vitest tests for validation, session reducers, overlap detection, export/copy bundle logic, storage commits, and error/conflict mapping.
- Use `fake-indexeddb` patterns already present in integration tests for IndexedDB behavior.
- Use the Playwright e2e harness for extension UI and Chrome API workflows. It runs a local fixture server at `http://127.0.0.1:5599`.
- For real Chrome manual checks, rebuild with `npm run build`, reload `.output/chrome-mv3` in `chrome://extensions`, and refresh already-open target pages so the content script injects.

## Security & Configuration Tips

- Treat `Downloads/PrompTrace/`, IndexedDB, and exported Markdown/JSON as local user data. Do not upload or log captured content.
- `chrome.downloads.removeFile` can only remove files the extension downloaded; preserve fallback/error behavior when editing delete flows.
- Some media URLs are not downloadable (`blob:`, MediaSource, DRM, authenticated or cross-origin URLs). Keep source-only fallback paths intact.
- Host-page CSP can affect content-script-rendered remote media; prefer existing preview/cache behavior over assuming remote thumbnails always load.
- `.output/`, `.wxt/`, `.codegraph/`, `node_modules/`, `test-results/`, and Playwright reports are generated local artifacts and should stay out of commits.

## Commit & Pull Request Guidelines

- Keep changes scoped by layer: core/storage logic, background routing, content UI, extension pages, and tests should be easy to review independently.
- Mention which commands were run, especially `npm run compile`, `npm test`, `npm run build`, and `npm run test:e2e`.
- For storage schema changes, describe the `DB_VERSION` migration and any backward-compatibility behavior.
- For permission or manifest changes, explain the user-visible privacy and Chrome permission impact.
