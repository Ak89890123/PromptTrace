import { test, expect } from './support/extension';

// Verifies the popup-settings overhaul: quick toggles render and persist.
test('popup renders quick toggles and persists a change across reopen', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);

  await expect(page.getByText('快速開關')).toBeVisible();

  // The real <input> is visually hidden behind the styled .pt-track switch, so
  // a user (and the test) clicks the wrapping <label> to toggle it.
  const row = page.locator('label.tog-row').filter({ hasText: '右緣漂浮面板' });
  const input = row.locator('input[type=checkbox]');
  const before = await input.isChecked();

  await row.click();
  await expect(input).toBeChecked({ checked: !before });
  await page.waitForTimeout(200); // let saveSettings() flush to chrome.storage

  await page.reload();
  const inputAfter = page
    .locator('label.tog-row')
    .filter({ hasText: '右緣漂浮面板' })
    .locator('input[type=checkbox]');
  await expect(inputAfter).toBeChecked({ checked: !before });

  const heightRow = page.locator('label.tog-row').filter({ hasText: 'P 邊欄高度' });
  const range = heightRow.locator('input[type=range]');
  const reset = heightRow.getByRole('button', { name: 'Reset' });

  await range.evaluate((node) => {
    const input = node as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, '72');
    input.dispatchEvent(new InputEvent('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect(reset).toBeEnabled();

  await reset.click();
  await expect(range).toHaveValue('50');
  await expect(reset).toBeDisabled();
});
