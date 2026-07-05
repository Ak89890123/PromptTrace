import { test, expect } from './support/extension';

// Regression for the dismiss bug: selecting text shows the role toolbar, and
// scrolling a NESTED overflow pane (like ChatGPT's conversation) must dismiss it.
// Those scrolls don't bubble, so the listener has to be capture-phase.
test('selection toolbar dismisses when a nested pane scrolls', async ({ context }) => {
  const page = await context.newPage();
  await page.goto('/chatgpt-like.html');
  await expect(page.locator('prompttrace-ui')).toBeAttached({ timeout: 10_000 });

  await page.evaluate(() => {
    const el = document.querySelector('#msg-1')!;
    const r = document.createRange();
    r.selectNodeContents(el);
    const s = window.getSelection()!;
    s.removeAllRanges();
    s.addRange(r);
    window.dispatchEvent(new CustomEvent('prompttrace:summon'));
  });
  await expect(page.locator('.pt-toolbar')).toBeVisible({ timeout: 5_000 });

  await page.locator('#thread').evaluate((el) => {
    el.scrollTop += 150;
  });
  await expect(page.locator('.pt-toolbar')).toBeHidden();
});

test('left click outside clears selection and dismisses toolbar', async ({ context }) => {
  const page = await context.newPage();
  await page.goto('/chatgpt-like.html');
  await expect(page.locator('prompttrace-ui')).toBeAttached({ timeout: 10_000 });

  await page.evaluate(() => {
    const el = document.querySelector('#msg-1')!;
    const r = document.createRange();
    r.selectNodeContents(el);
    const s = window.getSelection()!;
    s.removeAllRanges();
    s.addRange(r);
    window.dispatchEvent(new CustomEvent('prompttrace:summon'));
  });
  await expect(page.locator('.pt-toolbar')).toBeVisible({ timeout: 5_000 });

  await page.mouse.click(20, 20);

  await expect(page.locator('.pt-toolbar')).toBeHidden();
  await expect
    .poll(() => page.evaluate(() => window.getSelection()?.toString() ?? ''))
    .toBe('');
});
