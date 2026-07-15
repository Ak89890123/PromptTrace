# ADR-0001：V1 採用 local-first Chrome Extension

## Status

Media persistence details are superseded by [ADR-0005](ADR-0005-indexeddb-canonical-media-previews.md).

Accepted（2026-06-12）

## Context

PrompTrace 的核心價值是「在 AI 工作流發生的當下，把 Prompt 與資產的對應關係留住」。capture 行為發生在瀏覽器頁面內（反白、右鍵），資料的敏感度高（使用者的 prompt 可能包含私有工作流、未發表內容）。

可選方案：(a) Chrome Extension + 本機儲存；(b) Web App + 後端；(c) 桌面 App。

## Decision

V1 做 local-first Chrome Extension（Manifest V3）：

- capture 需要 DOM 層級的整合（selection、context menu、overlay），只有 extension 做得到。
- 所有資料留在本機（IndexedDB + Downloads 資料夾），無隱私顧慮、無合規負擔。
- 不需要帳號與同步即可交付完整工作流。

## Consequences

- ✅ 零伺服器成本、零資料外洩面、安裝即用。
- ✅ 媒體下載可重用 Chrome 的下載基礎設施（含使用者可見的下載歷史）。
- ❌ 資料綁定單一瀏覽器 profile；跨裝置同步是未來的事（明確 non-goal）。
- ❌ MV3 service worker 生命週期限制：capture session 是暫存的 in-memory state。
- ❌ 只支援 Chrome；多瀏覽器是 non-goal。
