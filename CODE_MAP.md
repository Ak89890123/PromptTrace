# PromptTrace Code Map

## Scope
- Local-first WXT Chrome MV3 extension for capturing prompts, references, outputs, and local media metadata into a searchable library.
- No backend, account system, cloud sync, analytics, or LLM API calls.

## Entry Points
- `entrypoints/background.ts`: service worker, context menus, capture session state, downloads, file tracking, and message routing.
- `entrypoints/content/`: injected page UI, shadow-root panel/gallery, overlay frames, selection/media capture, and prompt copy/fill helpers.
- `entrypoints/library/`: local library dashboard, filtering, record detail editing, export, deletion, and copy actions.
- `entrypoints/settings/`: detailed settings page for interaction, language, display, category management, and local file folder access.
- `entrypoints/popup/`: toolbar popup for quick toggles and links into Library/Settings.

## Core Modules
- `src/core/`: pure TypeScript domain logic, validation, session reducers, overlap detection, export, copy bundle composition, and error/conflict models.
- `src/storage/`: IndexedDB schema, repositories, seed data, commit/delete services, and file record handling.
- `src/ui/`: shared UI settings, role colors, taxonomy hooks, and UI text/i18n helpers.

## Verification
- `npm run compile`: TypeScript check.
- `npm test`: Vitest unit and integration tests.
- `npm run build`: WXT production build into `.output/chrome-mv3`.
- `npm run test:e2e`: WXT build plus Playwright extension harness.

## Local Notes
- Generated folders such as `.output/`, `.wxt/`, `node_modules/`, test reports, and Playwright results should stay out of commits.
- On this Windows setup, sandboxed `npm test` may fail before tests run with `spawn EPERM`; rerun with approval so Vitest can spawn esbuild.
- `npm run build` rewrites `.output/chrome-mv3`; if sandboxed cleanup hits `EPERM`, rerun with approval.
