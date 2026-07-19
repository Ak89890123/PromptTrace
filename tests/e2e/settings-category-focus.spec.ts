import { expect, test } from './support/extension';

test('mouse reorder does not leave focus on the moved category action', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/settings.html`);

  const rows = page.locator('.settings-category-list > .settings-category-row:not(.settings-row-header):not(.settings-new-row)');
  await expect(rows).toHaveCount(4);

  const movedName = await rows.last().locator('input').inputValue();
  await rows.last().locator('.settings-compact-actions button').first().click();
  await expect(rows.nth(2).locator('input')).toHaveValue(movedName);

  await page.waitForTimeout(16);
  const movedVisualState = await page.evaluate((name) => {
    const categoryRows = [...document.querySelectorAll('.settings-category-row:not(.settings-row-header):not(.settings-new-row)')];
    const movedRow = categoryRows.find((row) => row.querySelector('input')?.value === name);
    const movedButton = movedRow?.querySelector('.settings-compact-actions button');
    const normalButton = categoryRows[0]?.querySelector('.settings-compact-actions button');
    const actionButtons = categoryRows.flatMap((row) => [...row.querySelectorAll('.settings-compact-actions button')]);
    if (!(movedButton instanceof HTMLElement) || !(normalButton instanceof HTMLElement)) return null;
    return {
      background: getComputedStyle(movedButton).backgroundColor,
      normalBackground: getComputedStyle(normalButton).backgroundColor,
      allNormal: actionButtons.every((button) => getComputedStyle(button).backgroundColor === getComputedStyle(normalButton).backgroundColor),
    };
  }, movedName);

  expect(movedVisualState?.background).toBe(movedVisualState?.normalBackground);
  expect(movedVisualState?.allNormal).toBe(true);

  const focusState = await page.evaluate(() => ({
    ariaLabel: document.activeElement?.getAttribute('aria-label') ?? null,
    focusVisible: document.activeElement?.matches(':focus-visible') ?? false,
  }));

  expect(focusState.ariaLabel ?? '').not.toMatch(/^(?:\u4e0a\u79fb|Move up)$/);
  expect(focusState.focusVisible).toBe(false);

  const keyboardMovedName = await rows.nth(1).locator('input').inputValue();
  await rows.nth(1).locator('.settings-compact-actions button').first().focus();
  await page.keyboard.press('Enter');
  await expect(rows.first().locator('input')).toHaveValue(keyboardMovedName);

  const keyboardFocusState = await page.evaluate(() => ({
    ariaLabel: document.activeElement?.getAttribute('aria-label') ?? null,
    focusVisible: document.activeElement?.matches(':focus-visible') ?? false,
  }));

  expect(keyboardFocusState.ariaLabel).toMatch(/^(?:\u4e0a\u79fb|Move up)$/);
  expect(keyboardFocusState.focusVisible).toBe(true);
});
