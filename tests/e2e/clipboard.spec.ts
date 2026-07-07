import { test, expect } from './support/extension';

const NEEDLE = 'The quick brown fox jumps over the lazy dog';

test('saved prompt has no copy label but still fills from the in-page gallery', async ({ context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
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
  const roleButton = page.locator('.pt-toolbar button').first();
  await expect(roleButton).toBeVisible({ timeout: 5_000 });
  await roleButton.click();

  await page.locator('.pt-commit').click();
  await expect(page.locator('.pt-wizard')).toBeVisible({ timeout: 5_000 });
  await page.locator('.pt-wizard .pt-choice').first().click();

  await page.locator('.pt-edge-tab').hover();
  const prompt = page.locator('.pt-gprompt').filter({ hasText: NEEDLE });
  await expect(prompt).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('.pt-gcol-copy')).toHaveCount(0);

  const column = page.locator('.pt-gcol--copyable').filter({ hasText: NEEDLE });
  await column.click();
  await expect(page.locator('#prompt-textarea')).toHaveValue(new RegExp(NEEDLE));
});

test('saved image has no copy label but still copies from the in-page gallery', async ({ context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const page = await context.newPage();
  await page.goto('/chatgpt-like.html');
  await expect(page.locator('prompttrace-ui')).toBeAttached({ timeout: 10_000 });

  await page.locator('#img-1').hover();
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('prompttrace:summon')));
  const roleButton = page.locator('.pt-toolbar button').first();
  await expect(roleButton).toBeVisible({ timeout: 5_000 });
  await roleButton.click();

  await page.locator('.pt-commit').click();
  await expect(page.locator('.pt-wizard')).toBeVisible({ timeout: 5_000 });
  await page.locator('.pt-wizard .pt-choice').first().click();

  await page.locator('.pt-edge-tab').hover();
  const thumb = page.locator('.pt-gthumb').first();
  await expect(thumb).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('.pt-gcol-copy')).toHaveCount(0);

  await thumb.click();
  await expect(page.locator('.pt-lightbox')).toHaveCount(0);
  await expect(page.locator('#attachments img')).toHaveCount(1);
});
