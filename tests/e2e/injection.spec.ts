import { test, expect } from './support/extension';

// Verifies the wrap-up-log item: "content script 仍注入 (Console [PrompTrace],
// Elements <prompttrace-ui>)" — now automated.
test('content script injects shadow UI + overlay container on an http page', async ({ context }) => {
  const page = await context.newPage();
  await page.goto('/chatgpt-like.html');

  // The shadow-root host mounted by createShadowRootUi.
  await expect(page.locator('prompttrace-ui')).toBeAttached({ timeout: 10_000 });
  // The overlay container appended to <html> by the overlay manager.
  await expect(page.locator('#prompttrace-overlay-container')).toBeAttached();
});

test('gallery panel keeps its top anchor while short content settles', async ({ context }) => {
  const page = await context.newPage();
  await page.goto('/chatgpt-like.html');
  await expect(page.locator('prompttrace-ui')).toBeAttached({ timeout: 10_000 });

  const tab = page.locator('.pt-edge-tab');
  await expect(tab).toBeVisible();

  await tab.hover();
  const panel = page.locator('.pt-gallery-panel');
  await expect(panel).toBeVisible();
  await expect(panel.locator('[data-gallery-loading="true"]')).toHaveCount(0, { timeout: 10_000 });
  await page.waitForTimeout(250);
  const viewportHeight = await page.evaluate(() => window.innerHeight);
  const expectedPanelHeight = Math.min(viewportHeight * 0.86, 900);
  await expect.poll(async () => (await panel.boundingBox())?.height ?? 0).toBeLessThan(expectedPanelHeight - 10);
  const initialPanelBox = await panel.boundingBox();
  expect(initialPanelBox).not.toBeNull();
  await page.waitForTimeout(250);
  const settledPanelBox = await panel.boundingBox();
  expect(settledPanelBox).not.toBeNull();
  expect(Math.abs((settledPanelBox?.y ?? 0) - (initialPanelBox?.y ?? 0))).toBeLessThanOrEqual(2);
  await expect.poll(async () => {
    const panelBox = await panel.boundingBox();
    expect(panelBox).not.toBeNull();
    return panelBox?.height ?? 0;
  }).toBeLessThan(expectedPanelHeight - 10);
});
