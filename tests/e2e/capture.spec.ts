import { test, expect } from './support/extension';

// The headline check (#3 from static review): capture a text selection and
// confirm the overlay frame is drawn AND repositions when the *nested* scroll
// container moves — the bug the capture-phase scroll listener was meant to fix.
test('captured selection draws an overlay frame that tracks nested scroll', async ({ context }) => {
  const page = await context.newPage();
  await page.goto('/chatgpt-like.html');
  await expect(page.locator('prompttrace-ui')).toBeAttached({ timeout: 10_000 });

  // Select the target paragraph and summon the in-page toolbar. Default
  // toolbarTrigger is 'hotkey', so we fire the summon event the hotkey would.
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

  // The role-colored frame is drawn in the page (outside the shadow UI).
  const frame = page.locator('#prompttrace-overlay-container .prompttrace-frame');
  await expect(frame).toBeAttached({ timeout: 5_000 });
  const topBefore = await frame.evaluate((f) => f.getBoundingClientRect().top);

  // Scroll the nested pane; the frame must follow.
  await page.locator('#thread').evaluate((el) => {
    el.scrollTop += 150;
  });
  await page.waitForTimeout(150); // allow the rAF-batched reposition
  const topAfter = await frame.evaluate((f) => f.getBoundingClientRect().top);

  expect(Math.abs(topAfter - topBefore)).toBeGreaterThan(50);
});
