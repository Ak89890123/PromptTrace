# ADR-0004: BYOK LLM prompt summary

## Status

Accepted (2026-07-02)

## Context

PromptTrace currently preserves a local-first privacy model: captured prompt records stay in the browser profile and local downloads, with no backend, account, telemetry, or LLM API calls by default. The next feature goal is to help users understand saved prompts faster by generating a short Chinese "summary" that explains what a prompt is for. This introduces optional outbound network calls, so the privacy boundary, key handling, trigger behavior, and output contract need an explicit decision before implementation.

## Decision

PromptTrace will support an optional BYOK prompt-summary feature. Users can choose one fixed provider from OpenAI, Gemini, Claude, or OpenRouter, paste their own API key, choose a provider model from a maintained list or enter a custom model id, and run summaries manually or through an automatic interval.

The extension remains local-first by default. No summary request is sent unless the user enables and configures this feature. Summary calls are owned by the background service worker, not content scripts. Requests send prompt text only; records without prompt text are skipped instead of calling an API. Images, videos, local paths, download paths, page assets, and unrelated capture metadata are not sent.

The summary contract has a maintained default system prompt that asks the model to produce a concise Chinese explanation of the prompt's purpose, expected output, important constraints, and searchable hints. Advanced users may edit this system prompt in local settings, while the response parser still validates the provider output through a stable JSON schema. Single cards can be summarized again manually. Automatic scans only process cards that have never been summarized.

PromptTrace will store provider-returned token usage with each generated summary when the selected API returns it. The settings UI can aggregate this into a local token dashboard so users can understand input, output, and total token usage. If a provider response omits usage data, PromptTrace should show that the value is unavailable instead of inventing a precise local estimate.

Provider API details, model lists, and headers must be verified against current official documentation during implementation because these APIs change over time. Stored API keys must be masked in the settings UI and must not be logged, exported, or committed.

## Alternatives Considered

### Keep all summaries manual and user-written

- Pros: No network calls, no API keys, simplest privacy story.
- Cons: Does not solve the main workflow problem of quickly understanding many saved prompts.
- Why not: The feature goal is specifically to automate a concise purpose summary when the user opts in.

### Add a PromptTrace backend proxy

- Pros: Can centralize provider integrations and hide provider differences.
- Cons: Breaks the current no-backend architecture, creates account/billing/security obligations, and introduces server-side data handling.
- Why not: The product direction remains local-first and BYOK.

### Let content scripts call provider APIs directly

- Pros: Shorter implementation path from captured page context.
- Cons: Expands the exposed surface for API keys and makes privacy boundaries harder to reason about.
- Why not: Background-owned requests keep key usage and outbound calls centralized.

### Auto-summarize every changed record

- Pros: Summaries stay fresh without user action.
- Cons: Can surprise users with extra API usage and repeated network calls.
- Why not: Automatic mode should be conservative: only never-summarized records are processed, and manual re-summary handles explicit refresh.

## Consequences

### Positive

- Users can scan saved prompts faster through a short Chinese purpose summary.
- BYOK keeps billing and provider choice under the user's control.
- Fixed providers and a custom model option balance simple UX with flexibility.
- Background-owned calls create one auditable place for provider adapters, timeouts, retries, and error handling.

### Negative

- PromptTrace gains optional network behavior, which weakens the simplicity of the original "no LLM API calls" invariant unless the opt-in boundary is kept clear.
- Provider APIs and model ids can drift, so implementation must avoid hardcoding assumptions without verification.
- API key storage and masking require careful handling even though the feature is local-only.

### Risks

- Risk: prompt text may contain sensitive content and will be sent to the selected provider when summarization is used.
  - Mitigation: keep the feature disabled by default, state the purpose plainly in settings, send prompt text only, and skip records without prompt text.
- Risk: automatic scans could create unexpected cost.
  - Mitigation: provide a manual button, an explicit auto-summary switch, editable scan interval controls, max-per-run controls, and a local token usage dashboard.
- Risk: model output may be malformed.
  - Mitigation: use a fixed schema, validate responses, and show a recoverable error instead of saving untrusted output.
- Risk: CBM ADR sync is currently blocked by the global write gate while the relay is unfinished.
  - Mitigation: keep this repo-visible ADR as the source of record now, then mirror the same decision into CBM once the approved write path is available.
