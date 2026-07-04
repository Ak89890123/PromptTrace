# PrompTrace Design System

PrompTrace is a local-first Chrome extension for capturing AI workflow material into a private local library. The UI system should make repeated capture, review, copy, and cleanup workflows fast without making the host page feel owned by the extension.

## Product UI Principles

- Local-first extension: keep UI copy and affordances aligned with local data ownership. Do not introduce cloud, account, analytics, or sync assumptions into product surfaces.
- Dark-first: treat dark UI as the primary mode. The extension sits on arbitrary pages, so panels and controls need enough contrast without relying on the host page.
- Dense but readable: popup, library, settings, and the in-page panel should prioritize scanning and repeated action. Prefer compact controls, clear hierarchy, and stable dimensions over marketing-style space.
- Role-color semantics: role colors identify captured asset purpose. Keep role colors centralized in `src/ui/roleColors.ts`, and use them as semantic labels rather than decorative accents.
- Glass usage boundary: glass is for extension-owned floating surfaces and compact panels. Avoid stacking glass inside glass when a flat card, divider, or subtle stroke would be clearer.

## Token Source

`src/ui/tokens.css` is the source for shared CSS custom properties. It defines semantic `--pt-*` tokens for text, surface, stroke, spacing, radius, shadow, and type scale, plus compatibility aliases for the older variables used by extension pages.

`src/ui/base.css` consumes the shared tokens for popup, library, and settings pages. `entrypoints/content/style.css` imports the same token source directly because the content UI is injected into a shadow root and should not depend on extension-page base styles.

## Token Naming

- Text tokens use `--pt-color-text-*`.
- Surfaces use `--pt-surface-*`.
- Borders use `--pt-stroke-*`.
- Radius tokens use `--pt-radius-*`, with `--pt-radius-control` as the default input/button radius.
- Spacing tokens use `--pt-space-*`, based on the compact extension scale: 4, 6, 8, 10, 12, 14, 16, 18, 20, 24, 32, 40, and 48px.
- Shadows use `--pt-shadow-*`.
- Type tokens use `--pt-font-size-*` and `--pt-line-height-*`.

## Change Rules

- Add new visual constants to `src/ui/tokens.css` before adding hardcoded colors, spacing, shadows, radii, or font sizes in feature CSS.
- Keep old alias variables such as `--text`, `--muted`, `--glass`, and `--radius-md` until all extension-page CSS has migrated.
- Use role colors through `DEFAULT_ROLE_COLORS` and stored display settings, not duplicate hardcoded role palettes in component styles.
- After styling changes to extension pages or content UI, run at least `npm run compile`; run `npm run build` when CSS import/bundling behavior changes.
