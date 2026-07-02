import { test, expect } from './support/extension';

// Static-review concern #2: does "點左欄" fill the host-page prompt composer
// from the content-script context? Drives the full flow: capture → commit via the
// two-step wizard → in-page gallery → click to fill → assert composer contents.
const NEEDLE = 'The quick brown fox jumps over the lazy dog';

test('saved prompt fills the host prompt composer from the in-page gallery', async ({ context }) => {
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

  // 4) Click the containing column to fill → UI confirms AND the page composer holds the text.
  const column = page.locator('.pt-gcol--copyable').filter({ hasText: NEEDLE });
  await column.click();
  await expect(column.locator('.pt-gcol-copy')).toHaveText('已複製+填入 ✓');

  await expect(page.locator('#prompt-textarea')).toHaveValue(new RegExp(NEEDLE));
});

test('saved image is copied as image/png and focuses the prompt composer from the in-page gallery', async ({ context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const page = await context.newPage();
  await page.goto('/chatgpt-like.html');
  await expect(page.locator('prompttrace-ui')).toBeAttached({ timeout: 10_000 });

  await page.locator('#img-1').hover();
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('prompttrace:summon')));
  await page.locator('.pt-toolbar button').first().click();

  await page.locator('.pt-commit').click();
  await page.locator('.pt-wizard .pt-choice', { hasText: '未分類' }).click();
  await page.locator('.pt-wizard .pt-choice', { hasText: '不填' }).click();

  await page.locator('.pt-edge-tab').hover();
  const column = page.locator('.pt-gcol--copyable').filter({ has: page.locator('.pt-gthumb') }).first();
  await expect(column).toBeVisible({ timeout: 10_000 });

  await column.locator('.pt-gcol-label').click({ force: true });
  const status = column.locator('.pt-gcol-copy');
  await expect(status).toHaveText(/^(已複製\+加入 ✓|已複製\+貼上 ✓|請 Ctrl\+V)$/);
  if ((await status.textContent()) === '已複製+加入 ✓' || (await status.textContent()) === '已複製+貼上 ✓') {
    await expect(page.locator('#attachments img')).toHaveCount(1);
  } else {
    await expect(page.locator('#prompt-textarea')).toBeFocused();
    const clipboard = await page.evaluate(async () => {
      const items = await navigator.clipboard.read();
      return {
        types: items.flatMap((item) => item.types),
        text: await navigator.clipboard.readText().catch(() => ''),
      };
    });
    expect(clipboard.types).toContain('image/png');
    expect(clipboard.text).not.toContain('[image]');
    expect(clipboard.text).not.toContain('/backend-api/estuary/content');
  }
});
