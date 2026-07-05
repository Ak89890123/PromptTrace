import { test, expect } from './support/extension';

test('selection toolbar follows forward and backward selection endpoint side', async ({ context }) => {
  const page = await context.newPage();
  await page.goto('/chatgpt-like.html');
  await expect(page.locator('prompttrace-ui')).toBeAttached({ timeout: 10_000 });

  const selectMessage = async (direction: 'forward' | 'backward') =>
    page.evaluate((direction) => {
      const el = document.querySelector('#msg-1')!;
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      const nodes: Text[] = [];
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (node.textContent?.trim()) nodes.push(node as Text);
      }
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      if (direction === 'forward') {
        selection.setBaseAndExtent(first, 0, last, last.length);
      } else {
        selection.setBaseAndExtent(last, last.length, first, 0);
      }
      const range = selection.getRangeAt(0);
      const rects = Array.from(range.getClientRects()).filter((rect) => rect.width > 0 || rect.height > 0);
      const endpoint = direction === 'forward' ? rects[rects.length - 1] : rects[0];
      window.dispatchEvent(new CustomEvent('prompttrace:summon'));
      return { top: endpoint.top, bottom: endpoint.bottom };
    }, direction);

  const forwardEndpoint = await selectMessage('forward');
  const toolbar = page.locator('.pt-toolbar');
  await expect(toolbar).toBeVisible({ timeout: 5_000 });
  const forwardToolbar = await toolbar.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    return { top: rect.top, bottom: rect.bottom };
  });
  expect(forwardToolbar.top).toBeGreaterThanOrEqual(forwardEndpoint.bottom);

  await page.mouse.click(20, 20);
  await expect(toolbar).toBeHidden();

  const backwardEndpoint = await selectMessage('backward');
  await expect(toolbar).toBeVisible({ timeout: 5_000 });
  const backwardToolbar = await toolbar.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    return { top: rect.top, bottom: rect.bottom };
  });
  expect(backwardToolbar.bottom).toBeLessThanOrEqual(backwardEndpoint.top);
});
