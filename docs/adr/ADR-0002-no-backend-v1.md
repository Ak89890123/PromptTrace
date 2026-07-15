# ADR-0002：V1 不做後端

## Status

Media persistence details are superseded by [ADR-0005](ADR-0005-indexeddb-canonical-media-previews.md).

Accepted（2026-06-12）

## Context

Prompt 資產庫「看起來」適合上雲：同步、分享、團隊協作。但 V1 的成功標準是 workflow-grade 的單人工作流（capture → 標記 → 保存 → 回顧 → 複用），而不是平台。

## Decision

V1 完全不做後端：無 server、無雲端 DB、無登入、無 analytics、無 LLM API。

理由：

1. 後端會把交付週期從週拉到月（auth、infra、合規），而核心工作流完全不需要它。
2. Prompt 內容是高敏感資料；不收集是最強的隱私保證，也是與既有雲端 prompt 工具的差異化。
3. IndexedDB + chrome.downloads 已能滿足 V1 的全部儲存需求（見 ADR-0003）。

## Consequences

- ✅ 隱私敘事乾淨：「資料不離開你的電腦」可以直接寫進 README。
- ✅ 不需要付費 / 帳號 / abuse 防護等整套平台工程。
- ❌ 無跨裝置同步、無團隊共享（皆為明確 non-goal，未來可用匯出檔交換）。
- ❌ 資料備份責任在使用者（Markdown / JSON export 提供逃生門）。
