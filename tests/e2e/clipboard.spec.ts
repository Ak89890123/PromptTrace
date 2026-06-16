import { test, expect } from './support/extension';

// Static-review concern #2: does "點 prompt 複製" actually write to the clipboard
// from the content-script context? Drives the full flow: capture → commit via the
// two-step wizard → in-page gallery → click to copy → assert clipboard contents.
const NEEDLE = 'The quick brown fox jumps over the lazy dog';

test('saved prompt copies to the clipboard from the in-page gallery', async ({ context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const page = await context.newPage();
  await page.goto('/chatgpt-like.html');
  await expect(page.locator('prompttrace-ui')).toBeAttached({ timeout: 10_000 });

  // 1) Capture #msg-1 with a role (same path as capture.spec).
  await page.evaluate(() => {
    const el = document.querySelector('#msg-1')!;
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    window.dispatchEvent(new CustomEvent('prompttrace:summon'));
  });
  await page.locator('.pt-toolbar button').first().click();

  // 2) Commit through the two-step wizard: 保存 → 未分類 → 不填（直接保存）.
  await page.locator('.pt-commit').click();
  await page.locator('.pt-wizard .pt-choice', { hasText: '未分類' }).click();
  await page.locator('.pt-wizard .pt-choice', { hasText: '不填' }).click();

  // 3) Open the gallery (its own right-middle hover panel) and find the prompt.
  await page.locator('.pt-edge-tab').hover();
  const prompt = page.locator('.pt-gprompt').filter({ hasText: NEEDLE });
  await expect(prompt).toBeVisible({ timeout: 10_000 });

  // 4) Click to copy → UI confirms AND the clipboard actually holds the text.
  await prompt.click();
  await expect(prompt.locator('.pt-gcopy')).toHaveText('已複製 ✓');

  await page.bringToFront();
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  expect(clip).toContain(NEEDLE);
});
