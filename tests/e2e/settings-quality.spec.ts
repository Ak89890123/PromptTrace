import { expect, test } from './support/extension';

test('settings persists the preview quality preset', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/settings.html`);
  await page.evaluate(() => chrome.storage.local.set({ 'promptrace:settings': { language: 'zh-TW' } }));
  await page.reload();

  const quality = page.getByRole('radiogroup', { name: '預覽品質' });
  const mediaStorage = page.getByTestId('media-asset-storage');
  await expect(mediaStorage).toBeVisible();
  await expect(mediaStorage).toContainText('媒體資產容量');
  await expect(mediaStorage).toContainText('0 KB');
  await expect(mediaStorage).toContainText('0 個資產');
  await expect(quality).toBeVisible();
  await expect(quality.getByRole('radio')).toHaveCount(3);
  await expect(quality.getByRole('radio', { name: /^中/ })).toHaveAttribute('aria-checked', 'true');

  await quality.getByRole('radio', { name: /^高/ }).click();
  await expect.poll(() => page.evaluate(async () => {
    const stored = await chrome.storage.local.get('promptrace:settings');
    return stored['promptrace:settings']?.mediaQuality;
  })).toBe('high');

  await page.reload();
  await expect(page.getByRole('radiogroup', { name: '預覽品質' }).getByRole('radio', { name: /^高/ }))
    .toHaveAttribute('aria-checked', 'true');
});

test('settings hover rendering keeps the page compositor-safe', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(`chrome-extension://${extensionId}/settings.html`);

  const nav = page.locator('.settings-nav-button');
  await nav.hover();

  await expect(nav).toHaveCSS('background-color', 'rgba(34, 211, 238, 0.08)');
  const backgroundAttachment = await page.locator('body').evaluate((body) => getComputedStyle(body).backgroundAttachment);
  expect(backgroundAttachment.split(',').every((value) => value.trim() === 'scroll')).toBe(true);
  await page.locator('.settings-media-quality-option').nth(2).hover();
  await expect(page.locator('.settings-page')).toBeVisible();
});
