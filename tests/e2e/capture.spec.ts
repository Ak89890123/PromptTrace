import { test, expect } from './support/extension';

test('captured selection remains functional without drawing an overlay frame', async ({ context }) => {
  const page = await context.newPage();
  await page.goto('/chatgpt-like.html');
  await expect(page.locator('prompttrace-ui')).toBeAttached({ timeout: 10_000 });

  await page.evaluate(() => {
    const el = document.querySelector('#msg-1')!;
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    window.dispatchEvent(new CustomEvent('prompttrace:summon'));
  });

  // Toolbar lives in the open shadow root; Playwright pierces it. Click the
  // first role button to capture the selection with that role.
  const roleButton = page.locator('.pt-toolbar button').first();
  await expect(roleButton).toBeVisible({ timeout: 5_000 });
  await roleButton.click();

  // Capture still works, but the retired frame feature must not add page UI.
  await expect(page.locator('#prompttrace-overlay-container')).toHaveCount(0);
  await expect(page.locator('.pt-panel')).toBeVisible();
});
