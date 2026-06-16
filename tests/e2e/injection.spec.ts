import { test, expect } from './support/extension';

// Verifies the wrap-up-log item: "content script 仍注入 (Console [PromptTrace],
// Elements <prompttrace-ui>)" — now automated.
test('content script injects shadow UI + overlay container on an http page', async ({ context }) => {
  const page = await context.newPage();
  await page.goto('/chatgpt-like.html');

  // The shadow-root host mounted by createShadowRootUi.
  await expect(page.locator('prompttrace-ui')).toBeAttached({ timeout: 10_000 });
  // The overlay container appended to <html> by the overlay manager.
  await expect(page.locator('#prompttrace-overlay-container')).toBeAttached();
});
