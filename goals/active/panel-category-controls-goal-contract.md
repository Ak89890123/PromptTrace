---
type: goal-contract
schema_version: 1
id: panel-category-controls
title: PromptTrace Panel Category Controls
status: ready
created: 2026-07-06
updated: 2026-07-06
completed:
owner: codex
file_mode: single-file
project: PromptTrace
paths:
  contract: goals/active/panel-category-controls-goal-contract.md
review:
  required: false
  verdict:
tags:
  - content-panel
  - category-filter
  - local-first
---

## Contract

Goal: make the right-side in-page PromptTrace panel support practical category organization without adding external services or breaking the local-first privacy contract.

Primary deliverable for the next implementation step: card-level category dropdown in the existing gallery cards. A card label such as `生圖` should become an inline, low-weight `生圖 ▾` control that lets the user move that record to another category directly from the floating panel.

Phased roadmap:

1. Phase 1: card category dropdown.
   - Use existing local category data and existing `library/updateRecordMeta` mutation path where possible.
   - Keep the sticky filter chips as the current browsing mode.
   - Keep card category text visually quieter than the active filter chip.
   - Refresh or locally update the gallery after category changes.
2. Phase 2: drag/drop to sticky chips.
   - Only after Phase 1 is usable.
   - Drag entry should be a handle or category metadata area, not the whole card.
   - During drag, sticky filter chips become drop targets.
   - Dropping updates category locally and should offer an undo path before broad rollout.
3. Phase 3: multi-select batch category changes.
   - Add an explicit organize mode or checkboxes.
   - Selecting multiple cards then choosing a sticky chip applies the category in batch.
   - This is for larger cleanup sessions, not the default browsing mode.
4. Phase 4: local-only suggestions.
   - Suggestions may use capture type, role, source URL/domain, and previous local choices.
   - No cloud calls, LLM classification, telemetry, account state, or analytics.

## Scope

In scope for Phase 1:

- `entrypoints/content/PanelApp.tsx`
- `entrypoints/content/style.css`
- message calls already exposed through `src/core/messages.ts` and `entrypoints/background.ts`
- focused tests or manual evidence for changing category from the in-page panel

Out of scope for Phase 1:

- Drag/drop behavior.
- Batch multi-select.
- New storage schema or IndexedDB migration.
- New Chrome permissions.
- Network calls, telemetry, sync, LLM APIs, or cloud classification.
- Full Library page taxonomy redesign.

## Success Criteria

Phase 1 is ready when:

- A gallery card category label can be opened as a dropdown from the floating panel.
- Selecting another category updates the record category through the existing local mutation path.
- The gallery reflects the new category and filter counts after the update.
- The control is usable in the narrow single-column and split card layouts.
- Keyboard/focus behavior is not worse than the current right-click edit flow.
- Existing compile and Vitest checks pass.
- If e2e is run and unrelated failures remain, the failure point is documented separately from this feature.

## Evidence

Required for Phase 1 completion:

- `npm run compile`
- `npm test`
- Manual or automated evidence that changing a card category from the panel updates the visible category/filter state.
- `npm run test:e2e` if practical for the final UI behavior; otherwise document the exact blocker.

Current baseline evidence before Phase 1 dropdown:

- `npm run compile` passed after sticky filter chip implementation.
- `npm test` passed after rerun outside sandbox because Vitest/esbuild hit sandbox `spawn EPERM`.
- `npm run test:e2e` built successfully but had two clipboard spec timeouts before reaching gallery filtering, waiting on the commit wizard `未分類` option.

## Routing

Primary owner: main Codex agent.

UI/UX input: keep using the existing `codex_uiux_designer` output as design guidance, but do not block Phase 1 on further visual review unless the interaction model changes.

Reviewer: optional for Phase 1 because this is bounded UI work using existing mutation paths. Require review before Phase 2 drag/drop or Phase 3 batch behavior if the implementation becomes broad, risky, or crosses storage/message boundaries.

## Open Decisions

- Whether Phase 1 dropdown should list all categories inline or reuse the existing left-side `CardEditor` flyout styling in a smaller anchored menu.
- Whether changing a category while a non-`全部` filter is active should immediately remove the card from the current filtered view or keep it visible until refresh. Default assumption: update immediately according to the active filter.
- Whether `未分類` should appear as a selectable dropdown item in card metadata. Default assumption: yes.

## Progress Log

- 2026-07-06: Sticky filter chips and muted card category metadata were implemented as visual alignment groundwork.
- 2026-07-06: Contract created to keep the next implementation focused on Phase 1 dropdown before drag/drop and batch classification.
