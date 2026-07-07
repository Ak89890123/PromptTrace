---
type: goal-contract
schema_version: 1
id: panel-category-controls
title: PromptTrace Panel Category Controls
status: ready
created: 2026-07-06
updated: 2026-07-07
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

Goal: make the right-side in-page PromptTrace panel support practical drag-based category organization without adding external services or breaking the local-first privacy contract.

Primary deliverable for the next implementation step: a drag-handle category move flow in the existing gallery cards. The MVP combines visual reference 1 and visual reference 4: drag a card/category handle to the sticky category chips, update the record category on drop, then show a compact confirmation toast with undo.

Implementation strategy:

Start with the smallest useful drag interaction: card handle -> horizontally scrollable sticky category chips -> drop confirmation/undo. The sticky chips must support horizontal scrolling because user-created categories can grow beyond the panel width. Other interaction models below are candidate alternatives or future extensions, not mandatory phases that must all coexist.

1. MVP: drag handle to sticky chips with undo.
   - Use existing local category data and existing `library/updateRecordMeta` mutation path where possible.
   - Keep the sticky filter chips as the current browsing mode.
   - Make the chip row horizontally scrollable for large category sets.
   - Drag entry should be a visible handle or category metadata area, not the whole card.
   - During drag, sticky filter chips become drop targets with clear hover/over state.
   - Dropping updates category locally, refreshes or locally updates the gallery/counts, and shows `已移到 <分類>` with `復原`.
   - If a non-`全部` filter is active and the card moves out of that category, remove it from the visible list after the drop feedback begins.
2. Candidate fallback: card category menu.
   - Consider only if keyboard or pointer accessibility needs a visible non-drag path beyond undo.
   - Reuse the same local mutation path as drag/drop.
3. Candidate extension: multi-select batch category changes.
   - Add an explicit organize mode or checkboxes.
   - Selecting multiple cards then choosing a sticky chip applies the category in batch.
   - This is for larger cleanup sessions, not the default browsing mode.
4. Candidate extension: local-only suggestions.
   - Suggestions may use capture type, role, source URL/domain, and previous local choices.
   - No cloud calls, LLM classification, telemetry, account state, or analytics.

## Scope

In scope for Phase 1:

- `entrypoints/content/PanelApp.tsx`
- `entrypoints/content/style.css`
- message calls already exposed through `src/core/messages.ts` and `entrypoints/background.ts`
- focused tests or manual evidence for dragging a card/category handle to a sticky chip from the in-page panel

Out of scope for Phase 1:

- Kanban or board layout.
- Batch multi-select.
- New storage schema or IndexedDB migration.
- New Chrome permissions.
- Network calls, telemetry, sync, LLM APIs, or cloud classification.
- Full Library page taxonomy redesign.

## Success Criteria

Phase 1 is ready when:

- A gallery card can be dragged from a handle/category metadata area to a sticky category chip.
- The sticky chip row can be horizontally scrolled when categories exceed the panel width.
- Dropping on another category updates the record category through the existing local mutation path.
- The gallery reflects the new category and filter counts after the update.
- A compact confirmation toast appears with an undo action.
- The control is usable in the narrow single-column and split card layouts.
- Keyboard/focus behavior is not worse than the current right-click edit flow.
- Existing compile and Vitest checks pass.
- If e2e is run and unrelated failures remain, the failure point is documented separately from this feature.

## Evidence

Required for Phase 1 completion:

- `npm run compile`
- `npm test`
- Manual or automated evidence that dragging a card/category handle to a sticky chip updates the visible category/filter state.
- `npm run test:e2e` if practical for the final UI behavior; otherwise document the exact blocker.

Current baseline evidence before Phase 1 drag/drop:

- `npm run compile` passed after sticky filter chip implementation.
- `npm test` passed after rerun outside sandbox because Vitest/esbuild hit sandbox `spawn EPERM`.
- `npm run test:e2e` built successfully but had two clipboard spec timeouts before reaching gallery filtering, waiting on the commit wizard `未分類` option.

Current implementation evidence after drag/drop MVP:

- `npm run compile` passed.
- `npm test` passed after rerun outside sandbox because Vitest/esbuild hit sandbox `spawn EPERM`.
- `npm run build` passed after rerun outside sandbox because WXT build hit sandbox `EPERM` unlinking `.output/chrome-mv3/background.js`.
- `npm run test:e2e` built successfully and passed 6/8 specs; the same two clipboard specs timed out waiting for the commit wizard `未分類` option before reaching gallery drag/drop.

## Routing

Primary owner: main Codex agent.

UI/UX input: keep using the existing `codex_uiux_designer` output as design guidance, but do not block Phase 1 on further visual review unless the interaction model changes.

Reviewer: optional for Phase 1 because this is bounded UI work using existing mutation paths. Require review before multi-select, undo persistence, storage/message boundary changes, or any broader interaction model.

## Open Decisions

- Whether horizontal scrolling should be native touchpad/wheel scrolling only or also expose small left/right edge affordances when the chip row overflows.
- Whether changing a category while a non-`全部` filter is active should immediately remove the card from the current filtered view or keep it visible until refresh. Default assumption: update immediately according to the active filter.
- Whether `未分類` should appear as a drop target chip. Decision: no; keep uncategorized records visible through `全部`, but do not spend chip space on an empty/default category.

## Progress Log

- 2026-07-06: Sticky filter chips and muted card category metadata were implemented as visual alignment groundwork.
- 2026-07-06: Contract created with the original narrow category-control direction before the drag-based MVP decision.
- 2026-07-07: MVP direction changed to visual references 1 + 4: drag handle to sticky chips plus drop confirmation/undo. Sticky chips must remain horizontally scrollable for growing user-created category sets.
- 2026-07-07: Drag/drop MVP implemented with a draggable card category handle, horizontally scrollable taxonomy-backed category chips, local category update, visible drop states, and undo toast.
