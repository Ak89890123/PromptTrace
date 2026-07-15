# PrompTrace Design System

PrompTrace is a local-first Chrome extension for capturing AI workflow material into a private local library. Its interface should make repeated capture, review, copy, organization, export, restore, and cleanup fast while remaining visually distinct from—but respectful of—the host page.

This document is the product-level design contract for the popup, injected content UI, Library, Settings, and Trash. It describes both the current system and the rules for extending it. The actual token values in `src/ui/tokens.css`, role defaults in `src/ui/roleColors.ts`, and domain constraints in `src/core/domain/validation.ts` remain the implementation sources of truth.

## Design Goals

1. **Fast repeated work.** Optimize for scanning, capture, comparison, and reuse rather than presentation or marketing.
2. **Clear ownership.** Extension UI must be recognizable as PrompTrace without making the host page feel taken over.
3. **Local-first trust.** Surfaces and copy should make storage, export, deletion, and optional external actions understandable.
4. **Dense but readable.** Favor compact controls, stable dimensions, and strong hierarchy. Density must not come at the cost of legibility or target clarity.
5. **Semantic consistency.** Color, shape, text, and motion should communicate role, state, and priority consistently across every surface.
6. **Accessible by default.** Keyboard access, visible focus, contrast, labels, reduced motion, and non-color cues are part of the component definition.

## Product Surfaces

The system adapts to several very different containers. Do not apply website-layout assumptions uniformly to all of them.

| Surface | Purpose | Design behavior |
| --- | --- | --- |
| Browser popup | Quick settings and navigation | Fixed compact width, short labels, immediate controls, no unnecessary scrolling or full-viewport layout |
| Selection/media toolbar | Capture at the point of intent | Small, transient, high-contrast, minimal choices, must not obscure the selected asset |
| Right-edge panel | Capture session and quick save | Narrow, dense, glass-backed, visually isolated from arbitrary host pages |
| In-page gallery | Browse and reuse without leaving the page | Scannable cards, category filters, copy affordances, responsive columns |
| Library | Full record management | Information-rich dashboard with stable navigation, filters, previews, editing, and destructive actions |
| Settings | Detailed configuration | Form clarity, grouped decisions, explicit consequences, responsive stacked layout |
| Trash | Restore and permanent deletion | Strong state distinction, clear retention information, deliberate destructive actions |

The injected content UI lives in a shadow root. It must import shared tokens directly and must not depend on host-page typography, colors, box sizing, or extension-page base styles.

## Visual Direction

### Dark-first

Dark mode is the primary and currently supported visual theme. The neutral canvas is near-black, elevated surfaces are translucent charcoal, and cyan/green accents provide action and status contrast. Do not introduce a partial light theme. A future light theme must redefine the same semantic tokens and be complete across all surfaces before release.

Use system UI fonts so the extension remains lightweight and native to the operating system. Do not add a remote font dependency. A packaged font requires an explicit product decision, loading/fallback behavior, and verification across extension pages and the shadow-root UI.

### Glass with boundaries

Glass is a PrompTrace surface treatment, not a decoration to apply everywhere.

- Use glass for extension-owned floating panels, compact elevated cards, menus, and controls that need separation from a host page.
- Use tonal surfaces, strokes, or dividers inside a glass container. Avoid glass nested inside glass when hierarchy can be expressed more simply.
- Blur must always have a sufficiently opaque fallback color. Content must remain readable when `backdrop-filter` is unsupported or visually noisy.
- Do not add gratuitous gradients. Existing ambient page gradients and the primary-action gradient are intentional, limited brand treatments.
- Elevation should come from surface tone and border first, shadow second.

## Design Tokens

### Source and naming

`src/ui/tokens.css` defines shared semantic CSS custom properties under the `--pt-*` namespace:

- Text: `--pt-color-text-*`
- Functional color: `--pt-color-accent-*`, `--pt-color-success`, `--pt-color-danger-*`, and `--pt-color-warning-*`
- Surfaces: `--pt-surface-*`
- Borders: `--pt-stroke-*`
- Glass details: `--pt-glass-*`
- Spacing: `--pt-space-*`
- Radius: `--pt-radius-*`
- Shadows: `--pt-shadow-*`
- Typography: `--pt-font-*` and `--pt-line-height-*`

Compatibility aliases such as `--text`, `--muted`, `--glass`, and `--radius-md` may remain while older extension-page CSS is migrated. New styles should use `--pt-*` names.

Add a semantic token before repeating a new visual value across components. A one-off literal is acceptable only when it is intrinsic to a unique brand mark, media treatment, or isolated composition; keep it local and document why it should not be shared.

### Color semantics

Use semantic purpose rather than choosing a color by appearance.

| Purpose | Token family | Meaning |
| --- | --- | --- |
| Primary text | `--pt-color-text-primary` | Titles, important values, primary control labels |
| Secondary text | `--pt-color-text-secondary` | Supporting content that still needs comfortable reading |
| Muted/faint text | `--pt-color-text-muted`, `--pt-color-text-faint` | Metadata, hints, tertiary information |
| Disabled/empty text | `--pt-color-text-disabled`, `--pt-color-text-empty` | Unavailable controls and intentional empty placeholders |
| Accent | `--pt-color-accent-*` | Focus, selection, active filters, links, and PrompTrace emphasis |
| Success | `--pt-color-success` | Completed or positive outcomes; also participates in the primary-action gradient |
| Danger | `--pt-color-danger-*` | Destructive actions and technical error states |
| Warning | `--pt-color-warning-*` | Conflicts, caution, or user-operation collisions |
| Role color | stored settings and `DEFAULT_ROLE_COLORS` | Captured asset purpose, never generic decoration |

Never communicate state with color alone. Pair it with a label, icon, border pattern, position, or other perceivable cue. Text placed on a role color must use a foreground that remains legible for both default and user-customized colors.

### Role colors

Role colors are domain semantics and may be customized by the user. The defaults are:

| Role | Default | Use |
| --- | --- | --- |
| Pending | `#94A3B8` | Captured but not yet assigned |
| Input | `#22D3EE` | Prompt or instruction input |
| Input Reference | `#A78BFA` | Reference image, video, or supporting input |
| Output | `#34D399` | Generated or resulting material |
| Negative | `#F472B6` | Negative prompt or exclusion instruction |

Consume these values through `DEFAULT_ROLE_COLORS` and stored display settings. Do not duplicate the palette in component CSS. UI components must not infer asset-role validity from color; validity stays centralized in `src/core/domain/validation.ts`.

### Typography

PrompTrace uses a compact extension-specific type scale rather than large website headings.

| Level | Token | Typical use |
| --- | --- | --- |
| Micro | `--pt-font-size-micro` | Tiny counts or dense supporting marks; use sparingly |
| Tag | `--pt-font-size-tag` | Compact role/category tags |
| Caption | `--pt-font-size-caption` | Metadata, help text, section labels |
| Control | `--pt-font-size-control` | Buttons, inputs, compact navigation |
| Small body | `--pt-font-size-body-sm` | Card summaries and secondary prose |
| Body | `--pt-font-size-body` | Default UI copy |
| Page | `--pt-font-size-page` | Comfortable full-page copy |
| Title | `--pt-font-size-title` | Panel and compact-surface titles |
| Heading | `--pt-font-size-heading` | Page/card headings |
| Small display | `--pt-font-size-display-sm` | Empty states and selected hero headings |

- Use the shared system font stack in `--pt-font-family-ui`.
- Use weight, color, and spacing before introducing another font size.
- Use tabular figures or a local monospace system stack for aligned numeric or technical data.
- Keep body copy around the shared `--pt-line-height-body`; compact single-line labels may use a tighter line height.
- Avoid uppercase for ordinary buttons and navigation. Uppercase is reserved for short eyebrow or section labels with increased letter spacing.
- Long captured text must wrap safely. Use truncation only when the full value is available through expansion, preview, or another clear interaction.

### Spacing

Spacing follows the compact scale in `src/ui/tokens.css`: 4, 6, 8, 10, 12, 14, 16, 18, 20, 24, 32, 40, and 48px.

Use a predictable rhythm:

- 4–8px between tightly related icon/label elements.
- 8–14px inside compact controls and groups.
- 16–24px between card sections or distinct control groups.
- 32–48px only for full-page regions and major separation.

Prefer parent `gap` over child margins for repeated layouts. Do not compress a layout by shrinking every space equally; preserve grouping so users can still perceive relationships.

### Shape

Use the radius scale by function:

- Tight and keyboard-key radii for very small elements.
- Thumbnail radius for previews and compact media.
- Control radius for inputs, buttons, and interactive cards.
- Card radius for contained sections.
- Panel radius for large floating extension surfaces.
- Pill radius only for chips, statuses, counters, and truly capsule-shaped controls.

Keep one dominant radius family within a component. Avoid mixing sharp and highly rounded children without a functional reason.

### Elevation

Use the named shadow that matches the layer: card, panel, glass, menu, popover, selected record, lightbox, or floating control. Do not make up a stronger shadow merely to increase emphasis.

Layer order should be understandable:

1. Canvas or host page
2. Inline card/content
3. Sticky toolbar or rail
4. Floating panel/menu/popover
5. Modal/lightbox/confirmation
6. Toast or short-lived system feedback when it must remain visible

Every elevated layer needs a border or tonal distinction in addition to shadow so it remains legible on dark and complex backgrounds.

## Layout and Responsive Behavior

### Density and hierarchy

- Keep the most common action visible without opening a menu.
- Secondary and destructive actions may move into a menu when space is constrained.
- Preserve stable card and panel dimensions where possible to reduce visual jumping during repeated work.
- Align labels, values, and action columns consistently across repeated rows.
- Prefer one primary action per decision area.
- Use sticky controls only when they remain contextually tied to the scrolling content and do not hide important material.

### Surface-specific responsiveness

Breakpoints are implementation details chosen for content fit, not universal device categories. Current styles use surface-specific thresholds, including compact gallery changes, Library column collapse, Trash stacking, and Settings single-column layout. When modifying them:

- Test at the actual popup width and at narrow host-page viewports.
- Collapse multi-column content before text, buttons, or previews become unusably narrow.
- Keep controls operable without horizontal page scrolling.
- Allow action groups to wrap while preserving primary-before-secondary order.
- On narrow layouts, stack label/control pairs when side-by-side alignment harms readability.
- Media should use `object-fit` intentionally and never distort.

Do not copy marketing-site conventions such as oversized headings, hero spacing, or a single 1200px page grid into compact extension surfaces.

## Components

### Buttons and action hierarchy

Use labels that describe the outcome. Icon-only buttons require an accessible name and, when the icon is not universally understood, a tooltip or visible explanation.

| Variant | Use |
| --- | --- |
| Primary | The single main completion action in a decision area, such as saving a capture |
| Secondary/default | Normal actions with lower priority |
| Tertiary/link | Low-emphasis navigation or reversible utility actions |
| Danger | Destructive actions such as permanent deletion; do not use for ordinary cancel actions |
| Icon | Compact, familiar utility action with an accessible name |

All interactive variants must define these states:

| State | Required signal |
| --- | --- |
| Default | Clear affordance and readable label |
| Hover | Surface, border, or brightness change without moving surrounding layout |
| Active/pressed | Brief physical response or selected state |
| Focus-visible | Persistent visible ring or outline distinct from hover |
| Disabled | Lower emphasis, `not-allowed` where appropriate, and no action |
| Busy | Prevent duplicate activation and communicate progress in text or status feedback |

Do not rely on `title` as the only name or explanation. Avoid ambiguous labels such as “OK” or “Confirm” when the actual result can be named.

### Inputs and forms

- Every input needs a visible label unless its purpose is unmistakable and it has an accessible name.
- Helper text explains format or consequence; error text explains what happened and how to correct it.
- Focus must be more visible than the default border.
- Disabled and read-only are different states and must not be styled or described as interchangeable.
- Preserve user-entered values after recoverable validation or save errors.
- Place units and constraints close to the value they qualify.
- Use inline confirmation for consequential settings when a full modal would be excessive.

### Cards and records

- Cards group one record or one coherent configuration topic.
- Card titles, role/category metadata, preview content, and actions should appear in a consistent order.
- Use flat subregions and dividers inside a glass card rather than stacking equally elevated cards.
- Selected, dragging, drop-target, error, and conflict states must be visually distinct and also exposed semantically where applicable.
- Keep technical failures (`error`) separate from user-operation collisions (`conflict`) in both copy and visual treatment.

### Chips, pills, and segmented choices

- Chips and pills represent compact metadata, filters, statuses, or categories—not ordinary sentences.
- A selectable chip must expose its selected state, for example with `aria-pressed`, as well as a visual change.
- Counts should remain secondary to the label.
- Segmented controls are for mutually exclusive choices. Use standard buttons or checkboxes for independent actions.

### Menus, dialogs, and lightboxes

- Menus contain secondary actions and close on outside activation or Escape.
- Dialogs need a clear name, initial focus, contained keyboard navigation where appropriate, Escape behavior, and focus restoration.
- Destructive confirmation should name the affected item and consequence.
- Do not open a modal for simple success feedback.
- Lightboxes prioritize the asset, retain a clear close action, and must not stretch or crop media accidentally.

### Media and captured text

- Treat remote media as unreliable. Preserve loading, missing-preview, source-only, and download-unavailable states.
- Never imply that a preview guarantees a downloadable original.
- Provide text alternatives or labels for meaningful media controls; decorative imagery should be hidden from assistive technology.
- Captured text preserves intentional line breaks and safely wraps long URLs or unbroken strings.
- Thumbnail crops may use `cover` for a predictable grid; detail previews should normally use `contain`.

### Feedback, empty, and loading states

- Toasts announce a specific completed or failed action and disappear only after users have had time to perceive them.
- Use `role="status"` for non-urgent updates and an alert treatment only when immediate attention is required.
- Empty states explain what is absent and point to the first useful action when one exists.
- Loading and busy states should preserve layout when possible to avoid jumping.
- Never report success before storage, clipboard, download, import/export, restore, or deletion has actually completed.

### Drag and drop

Drag-and-drop is an enhancement, not the only path for an operation.

- Show draggable, dragging, valid target, active target, and invalid target states.
- Use cursor, shape/border, and text or icon cues in addition to color.
- Provide a keyboard or menu-based alternative for moving records or categories.
- Prevent invalid drops in domain logic, not only through styling.

## Interaction and Motion

Motion should clarify cause and effect. It must not compete with captured content or the host page.

- Use immediate or approximately 150ms transitions for hover, focus, selection, and small state changes.
- Use approximately 200ms for menus, tooltips, and compact popovers.
- Use up to approximately 300ms for panels, overlays, and lightboxes when spatial continuity is useful.
- Prefer opacity and transform over layout-changing animation.
- Small press feedback may scale a control slightly; it must not cause surrounding layout movement.
- Avoid looping, ornamental, or attention-seeking animation.
- Honor `prefers-reduced-motion: reduce` by removing nonessential transforms and transitions while preserving state clarity.

Timing values that recur across components should become motion tokens before broad adoption.

## Accessibility

Accessibility is required for new and modified UI, including shadow-root content.

### Keyboard and focus

- Every action available by pointer must have a keyboard path unless the browser platform itself makes that impossible.
- Use native interactive elements whenever possible. A non-native element with `role="button"` must also implement focus, Enter, and Space behavior.
- Every interactive element needs a visible `:focus-visible` treatment. Never remove an outline without an equivalent replacement.
- Focus order follows visual and task order.
- Opening and closing menus, dialogs, lightboxes, and inline confirmations must not lose focus.

### Names and states

- Icon-only controls require `aria-label` or an equivalent accessible name.
- Decorative icons use `aria-hidden="true"`.
- Toggle buttons and selectable chips expose state with `aria-pressed`; form controls use their native checked/selected state.
- Dynamic success and progress messages use an appropriate live status region without repeatedly interrupting the user.

### Contrast and targets

- Normal body text and essential icons should meet WCAG AA contrast against their effective composited background.
- Focus, selection, error, and drag targets must remain distinguishable in grayscale and under common color-vision differences.
- Keep pointer targets comfortably operable. Compact controls may have a small visible glyph, but their interactive area should be enlarged without overlapping adjacent targets.
- User-customized role colors must be tested or paired with adaptive foregrounds and non-color labels.

### Zoom, reflow, and motion

- Full extension pages must remain usable under browser zoom and narrow viewport reflow.
- Do not lock text into containers that clip when system font metrics or localization expands it.
- Reduced-motion behavior is part of acceptance testing for animated UI.

## Voice and Content

PrompTrace copy is concise, specific, and calm. It should sound like a dependable local tool, not a cloud platform or marketing page.

- Use sentence case for ordinary buttons, labels, tabs, helper text, toasts, and headings unless the locale convention requires otherwise.
- Name actions with the object or outcome when ambiguity is possible: “Delete record,” “Restore record,” “Save settings.”
- Use present-tense progress labels with an ellipsis: “Saving…”, “Exporting…”.
- A success message names the changed item or completed action and avoids filler such as “successfully.”
- An error states what happened and what the user can do next. Preserve technical details only when they help recovery.
- A conflict explains the collision and presents the available resolution; do not phrase it as a system failure.
- Destructive copy states whether data can be restored and whether downloaded files may also be removed.
- Empty-state copy points to the first meaningful action instead of blaming the user.
- Avoid “please,” superlatives, cloud/account assumptions, and unexplained implementation jargon.

### Localization

- Design for English, Traditional Chinese, Simplified Chinese, and system language behavior already represented by settings.
- Do not assemble translated sentences from fragments when grammar may differ.
- Allow labels to expand; do not set fixed widths based only on English.
- Use locale-appropriate punctuation, dates, counts, and word order.
- Accessible names, tooltips, errors, empty states, and confirmation text require the same localization coverage as visible primary UI.

## Trust, Privacy, and Destructive Actions

- Use local-first language accurately. Do not imply an account, sync, upload, or remote backup when none is involved.
- When an action can send content outside the device, it must be explicitly user-configured and clear at the point of action.
- Never display API keys, captured private content, machine-specific paths, or full sensitive values in incidental logs or toasts.
- Export and backup copy should distinguish metadata from available media files.
- Permanent deletion needs stronger wording and visual treatment than moving to Trash.
- Restore, retention, cleanup, and deletion feedback must reflect the real storage result, including partial failure or unavailable downloaded files.

## Implementation Rules

1. Use semantic `--pt-*` tokens in new CSS. Extend `src/ui/tokens.css` before repeating a new color, spacing, radius, shadow, type, or motion value.
2. Keep Chrome APIs out of `src/core`; visual components should consume domain results rather than recreate domain constraints.
3. Keep role rules in `src/core/domain/validation.ts` and role colors in `src/ui/roleColors.ts` plus stored display settings.
4. Import `src/ui/base.css` for extension pages that use the shared page foundation. Import `src/ui/tokens.css` directly for shadow-root content UI.
5. Preserve the local-first privacy contract. New network, analytics, account, or sync assumptions require explicit product approval and the appropriate architecture decision record.
6. Prefer native HTML semantics. Add ARIA only to fill a real semantic gap.
7. Keep technical errors and user conflicts separate in domain handling, copy, and styling.
8. Treat page-specific literals already in CSS as migration candidates, not precedent for additional hardcoded values.
9. Document any new reusable component pattern here when its behavior or semantics are not obvious from existing primitives.

## UI Change Checklist

Before considering a UI change complete, verify:

- The design works on every affected surface and at its actual container width.
- Default, hover, active, focus-visible, disabled, selected, busy, success, error, and conflict states are covered where relevant.
- Keyboard operation, accessible names, focus order, and focus restoration work.
- Meaning is not carried by color alone, including user-customized role colors.
- Long content, empty content, missing media, unavailable downloads, and localization expansion do not break the layout.
- Reduced motion and browser zoom do not hide state or controls.
- New reusable visual values use tokens; justified one-off values remain local.
- Host-page styles do not leak into shadow-root UI and PrompTrace styles do not affect the host page.
- Storage, clipboard, download, import/export, restore, and deletion feedback matches the actual result.

After styling changes to extension pages or content UI, run at least `npm run compile`. Run relevant Vitest tests for changed behavior. Run `npm run build` when CSS imports or bundling behavior changes, and use `npm run test:e2e` for browser behavior, shadow DOM UI, popup, clipboard, or extension injection changes.

## Maintaining This Document

Update this document when a change introduces or revises:

- A shared visual token or semantic color role
- A reusable component or interaction pattern
- Theme behavior
- Accessibility or motion behavior
- A new product surface or major responsive layout
- Role-color meaning or UI use
- Privacy/trust language that changes user expectations

Do not turn this file into an exhaustive component API or a duplicate of CSS. Keep rationale and cross-surface rules here; keep exact implementation values in their source files.
