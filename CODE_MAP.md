# PrompTrace Code Map

## Product Shape
- PrompTrace is a local-first Chrome MV3 extension for capturing prompt workflow assets as Input, Input Reference, Negative, and Output.
- It has no backend, account system, analytics, or cloud sync. Optional BYOK prompt summaries can call OpenAI, Gemini, Claude, or OpenRouter only after the user enables them.
- User data stays in IndexedDB, `chrome.storage`, and extension-managed downloads under `Downloads/PrompTrace/`.

## Main Entrypoints
- `entrypoints/background.ts`: service worker, context menus, capture session state, download tracking, extension-page navigation messages, and library mutation routes.
- `entrypoints/content/`: injected shadow-root UI for selection toolbar, capture panel, right-edge gallery, card editor, lightbox, and overlay frames.
- `entrypoints/popup/`: toolbar popup for quick settings and links to Library / Settings.
- `entrypoints/library/`: full-page local record browser with left filters, central record cards, and right detail inspector.
- `entrypoints/settings/`: detailed settings for language, interaction/display controls, categories, local files, backup/restore, and BYOK summary provider/API key/system prompt/token usage.

## Core And Storage
- `src/core/`: pure TypeScript domain logic, validation, capture reducers, hotkeys, export/backup archive helpers, copy bundle, summary provider adapters, conflict, and error models. Keep Chrome APIs out of this layer.
- `src/storage/`: IndexedDB schema, repositories, seed data, commit/delete services, and file record handling.
- `src/ui/`: shared settings hooks, role colors, taxonomy hooks, base CSS, and lightweight design tokens.

## UI Notes
- Extension pages share `src/ui/base.css`; content script uses shadow-safe `pt-*` styles in `entrypoints/content/style.css`.
- The current design direction is dark, quiet, glass-like, and utility-first. Cyan should be used mainly for active/focus states and primary affordances.
- Library detail selection is click/focus-pinned, not hover-driven. Hover can be a shortcut, but durable detail state should be explicit.
- Right-edge gallery supports hover-open plus pin/close/Escape for comfort.

## Commands
- `npm run compile`: TypeScript check.
- `npm run build`: build Chrome MV3 extension into `.output/chrome-mv3`.
- `npm test`: Vitest unit and integration tests.
- `npm run test:e2e`: build extension and run Playwright extension harness.

## Verification Notes
- Use `npm run compile` after touching TypeScript/React.
- Use `npm run build` after touching manifest, background, content, popup, library, settings, storage, or WXT behavior.
- Use Playwright or manual Chrome reload of `.output/chrome-mv3` for content script, popup, extension-page navigation, and shadow DOM behavior.

## Generated And Local Artifacts
- `.output/`, `.wxt/`, `.codegraph/`, `node_modules/`, `test-results/`, Playwright reports, and `.tmp/` are generated local artifacts and should stay out of commits.
- `.tmp/` is safe to delete after visual QA; it is used for temporary screenshots, Playwright profiles, and design preview scratch files.
- On this Windows setup, sandboxed `npm test` may fail before tests run with `spawn EPERM`; rerun with approval so Vitest can spawn esbuild.
- `npm run build` rewrites `.output/chrome-mv3`; if sandboxed cleanup hits `EPERM`, rerun with approval.

## Tool Readiness
- CodeGraph is initialized in `.codegraph/` and was usable in this repo on 2026-07-01.
- Codebase Memory has an existing project entry for this workspace, but source-of-truth behavior should still be verified against current code.
