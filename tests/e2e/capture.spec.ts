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

test('media capture never inherits a stale text range after a rejected duplicate', async ({ context }) => {
  const page = await context.newPage();
  await page.goto('/chatgpt-like.html');
  await expect(page.locator('prompttrace-ui')).toBeAttached({ timeout: 10_000 });
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');

  const selectMessage = () =>
    page.evaluate(() => {
      const el = document.querySelector('#msg-1')!;
      const range = document.createRange();
      range.selectNodeContents(el);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
    });
  const captureSelection = () =>
    worker.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab.id == null) throw new Error('active fixture tab not found');
      const result = await chrome.tabs.sendMessage(tab.id, { type: 'capture/captureSelection' });
      if (!result?.ok) throw new Error('selection capture failed');
    });
  const roleButton = page.locator('.pt-toolbar button').first();
  const assetCards = page.locator('.pt-panel .pt-card:has(.pt-rolerow)');
  const conflicts = page.locator('.pt-panel .pt-conflict');
  const captureWithFirstRole = async () => {
    await expect(roleButton).toBeVisible({ timeout: 5_000 });
    await page.evaluate(() => {
      const button = document
        .querySelector('prompttrace-ui')
        ?.shadowRoot?.querySelector<HTMLButtonElement>('.pt-toolbar button');
      if (!button) throw new Error('selection toolbar role button not found');
      button.click();
    });
    await expect(roleButton).toBeHidden();
  };

  await selectMessage();
  await captureSelection();
  await expect(assetCards).toHaveCount(1);

  // A rejected duplicate leaves the selected text range pending until the
  // next asset-added message consumes it.
  await selectMessage();
  await captureSelection();
  await expect(conflicts).toHaveCount(1);
  await conflicts.locator('button').last().click();
  await expect(conflicts).toHaveCount(0);

  await assetCards.first().locator('.pt-spread button').click();
  await expect(assetCards).toHaveCount(0);

  const image = page.locator('#img-1');
  await image.scrollIntoViewIfNeeded();
  await image.hover();
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('prompttrace:summon')));
  await captureWithFirstRole();
  await expect(assetCards).toHaveCount(1);

  await page.locator('#msg-1').scrollIntoViewIfNeeded();
  await selectMessage();
  await captureSelection();

  await expect(conflicts).toHaveCount(0);
  await expect(assetCards).toHaveCount(2);
});

test('replacing an overlap keeps range tracking after another capture consumes the pending anchor', async ({ context }) => {
  const page = await context.newPage();
  await page.goto('/chatgpt-like.html');
  await expect(page.locator('prompttrace-ui')).toBeAttached({ timeout: 10_000 });
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');

  const selectRange = async (startToken: string, endToken: string) => {
    await page.evaluate(({ startToken, endToken }) => {
      const target = document.querySelector('#msg-1')!;
      const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT);
      const node = walker.nextNode() as Text;
      const text = node.textContent ?? '';
      const start = text.indexOf(startToken);
      const end = text.indexOf(endToken, start) + endToken.length;
      if (start < 0 || end < start + endToken.length) throw new Error('fixture selection tokens not found');
      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, end);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
    }, { startToken, endToken });
  };
  const selectWhole = async (selector: string) => {
    await page.evaluate((selector) => {
      const target = document.querySelector(selector)!;
      const range = document.createRange();
      range.selectNodeContents(target);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
    }, selector);
  };
  const captureSelection = () =>
    worker.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab.id == null) throw new Error('active fixture tab not found');
      const result = await chrome.tabs.sendMessage(tab.id, { type: 'capture/captureSelection' });
      if (!result?.ok) throw new Error('selection capture failed');
    });
  const assetCards = page.locator('.pt-panel .pt-card:has(.pt-rolerow)');
  const conflicts = page.locator('.pt-panel .pt-conflict');

  // A and B overlap, but neither text contains the other.
  await selectRange('quick', 'jumps');
  await captureSelection();
  await expect(assetCards).toHaveCount(1);

  await selectRange('fox', 'lazy');
  await captureSelection();
  await expect(conflicts).toHaveCount(1);

  // This successful capture consumes B's one-shot pending anchor before the
  // user resolves the overlap conflict.
  await selectWhole('#msg-2');
  await captureSelection();
  await expect(assetCards).toHaveCount(2);

  await conflicts.locator('button').first().click();
  await expect(conflicts).toHaveCount(0);
  await expect(assetCards).toHaveCount(2);

  // C overlaps the replacement range but is not a string containment match.
  await selectRange('brown', 'over');
  await captureSelection();
  await expect(conflicts).toHaveCount(1);
});
