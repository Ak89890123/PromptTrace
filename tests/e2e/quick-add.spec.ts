import { test, expect } from './support/extension';
import type { BrowserContext, Locator, Page } from '@playwright/test';

const CAPTURE_TEXT = 'The quick brown fox jumps over the lazy dog';
const QUICK_TEXT = 'Manual note from right click quick add';
const PASTED_TEXT = 'Manual note from card paste';
const PASTED_IMAGE_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

async function createSavedRecord(page: Page) {
  await createPendingRecord(page);
  await page.locator('.pt-commit').click();
  await expect(page.locator('.pt-wizard')).toBeVisible({ timeout: 5_000 });
  await page.locator('.pt-wizard .pt-choice').first().click();
}

async function createPendingRecord(page: Page) {
  await page.locator('#msg-1').click();
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
}

async function createGalleryCard(context: BrowserContext) {
  const page = await context.newPage();
  await page.goto('/chatgpt-like.html');
  await expect(page.locator('prompttrace-ui')).toBeAttached({ timeout: 10_000 });

  await createSavedRecord(page);

  await page.locator('.pt-edge-tab').hover();
  const card = page.locator('.pt-gcard').filter({ hasText: CAPTURE_TEXT }).first();
  await expect(card).toBeVisible({ timeout: 10_000 });

  return { page, card };
}

async function expectEditorAlignedToCard(editor: Locator, card: Locator) {
  const editorBox = await editor.boundingBox();
  const cardBox = await card.boundingBox();
  expect(editorBox).not.toBeNull();
  expect(cardBox).not.toBeNull();
  expect((editorBox?.y ?? 0)).toBeLessThanOrEqual((cardBox?.y ?? 0) + 16);
  expect((editorBox?.y ?? 0) + (editorBox?.height ?? 0)).toBeLessThanOrEqual(
    (await editor.page().evaluate(() => window.innerHeight)) - 8,
  );
}

async function expectEditorInsideViewportBottom(editor: Locator) {
  const editorBox = await editor.boundingBox();
  expect(editorBox).not.toBeNull();
  const viewportHeight = await editor.page().evaluate(() => window.innerHeight);
  expect((editorBox?.y ?? 0) + (editorBox?.height ?? 0)).toBeLessThanOrEqual(viewportHeight - 8);
}

async function expectEditorNearPanel(editor: Locator, panel: Locator) {
  const editorBox = await editor.boundingBox();
  const panelBox = await panel.boundingBox();
  expect(editorBox).not.toBeNull();
  expect(panelBox).not.toBeNull();
  const gap = (panelBox?.x ?? 0) - ((editorBox?.x ?? 0) + (editorBox?.width ?? 0));
  // Headless Chromium can report fractional layout boxes with a tiny overlap.
  expect(gap).toBeGreaterThanOrEqual(-4);
  expect(gap).toBeLessThanOrEqual(24);
}

test('hovering a saved card does not show quick-add controls', async ({ context }) => {
  const { page, card } = await createGalleryCard(context);

  await card.hover();
  await expect(page.locator('.pt-quick-editor')).toHaveCount(0);
  await expect(page.locator('text=/Add text|新增文字/')).toHaveCount(0);
});

test('right-click add text opens the quick-add flyout and saves into the card', async ({ context }) => {
  const { page, card } = await createGalleryCard(context);

  const prompt = card.locator('.pt-gprompt').filter({ hasText: CAPTURE_TEXT }).first();
  await prompt.hover();
  await expect(page.locator('.pt-hover-preview')).toContainText(CAPTURE_TEXT);
  await card.click({ button: 'right', position: { x: 24, y: 24 } });
  await expect(page.locator('.pt-hover-preview')).toHaveCount(0);

  await page.locator('.pt-gmenu-item').filter({ hasText: /Add text|新增文字/ }).click();
  const quickEditor = page.locator('.pt-quick-editor');
  await expect(quickEditor).toBeVisible({ timeout: 5_000 });
  await expect(quickEditor).toHaveClass(/pt-geditor/);
  await expectEditorAlignedToCard(quickEditor, card);
  const editor = quickEditor.locator('textarea');
  await expect(editor).toBeVisible({ timeout: 5_000 });
  await editor.fill(QUICK_TEXT);
  await quickEditor.locator('.pt-choices button').first().click();

  await expect(page.locator('.pt-gprompt').filter({ hasText: QUICK_TEXT })).toBeVisible({ timeout: 5_000 });
});

test('right-click menu escapes the card frame and stays open while hovered', async ({ context }) => {
  const { page, card } = await createGalleryCard(context);
  const cardBox = await card.boundingBox();
  expect(cardBox).not.toBeNull();
  await page.mouse.click(cardBox!.x + 24, cardBox!.y + cardBox!.height - 8, { button: 'right' });

  const menu = page.locator('.pt-gmenu');
  await expect(menu).toBeVisible({ timeout: 5_000 });
  await expect(menu).toHaveCSS('position', 'fixed');
  const menuBox = await menu.boundingBox();
  expect(menuBox).not.toBeNull();
  const viewportHeight = await page.evaluate(() => window.innerHeight);
  expect(menuBox!.y + menuBox!.height).toBeLessThanOrEqual(viewportHeight - 8);

  await page.mouse.move(menuBox!.x + menuBox!.width / 2, menuBox!.y + menuBox!.height / 2);
  await page.waitForTimeout(350);
  await expect(menu).toBeVisible();
  await expect(card).toBeVisible();
});

test('closing the right-click menu inside a card does not replay the panel animation', async ({ context }) => {
  const { page, card } = await createGalleryCard(context);
  await page.waitForTimeout(300);
  const cardBox = await card.boundingBox();
  const panel = page.locator('.pt-gallery-panel');
  expect(cardBox).not.toBeNull();

  await page.mouse.click(cardBox!.x + 24, cardBox!.y + cardBox!.height - 8, { button: 'right' });
  await expect(page.locator('.pt-gmenu')).toBeVisible({ timeout: 5_000 });
  await page.mouse.click(cardBox!.x + 24, cardBox!.y + 12);
  await expect(page.locator('.pt-gmenu')).toHaveCount(0);

  const before = await panel.boundingBox();
  await page.waitForTimeout(50);
  const after = await panel.boundingBox();
  expect(before).not.toBeNull();
  expect(after).not.toBeNull();
  expect(Math.abs((after!.x ?? 0) - (before!.x ?? 0))).toBeLessThan(1);
});

test('pasting on a saved card opens role choices without an input panel', async ({ context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const { page, card } = await createGalleryCard(context);

  const prompt = card.locator('.pt-gprompt').filter({ hasText: CAPTURE_TEXT }).first();
  await prompt.hover();
  await expect(page.locator('.pt-hover-preview')).toContainText(CAPTURE_TEXT);
  await page.evaluate((text) => navigator.clipboard.writeText(text), PASTED_TEXT);
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+V' : 'Control+V');

  const quickEditor = page.locator('.pt-quick-editor');
  await expect(quickEditor).toBeVisible({ timeout: 5_000 });
  await expect(page.locator('.pt-hover-preview')).toHaveCount(0);
  await expect(quickEditor).toHaveClass(/pt-geditor/);
  await expectEditorAlignedToCard(quickEditor, card);
  await expect(quickEditor.locator('textarea')).toHaveCount(0);
  await expect(quickEditor.locator('.pt-quick-preview--text')).toContainText(PASTED_TEXT);
  await quickEditor.locator('.pt-choices button').first().click();

  await expect(page.locator('.pt-gprompt').filter({ hasText: PASTED_TEXT })).toBeVisible({ timeout: 5_000 });
});

test('pasting an image on a saved card previews the image and saves it with media roles', async ({ context }) => {
  const { page, card } = await createGalleryCard(context);

  await card.evaluate((el, base64) => {
    const binary = atob(base64);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const file = new File([bytes], 'pasted-image.png', { type: 'image/png' });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }));
  }, PASTED_IMAGE_PNG_BASE64);

  const quickEditor = page.locator('.pt-quick-editor');
  await expect(quickEditor).toBeVisible({ timeout: 5_000 });
  await expect(quickEditor).toHaveClass(/pt-geditor/);
  await expectEditorAlignedToCard(quickEditor, card);
  await expect(quickEditor.locator('textarea')).toHaveCount(0);
  await expect(quickEditor.locator('.pt-quick-preview--image img')).toBeVisible();
  await expect(quickEditor.locator('.pt-choices button')).toHaveCount(2);
  await expect(quickEditor.locator('.pt-choices')).toContainText(/Reference|參考/);
  await expect(quickEditor.locator('.pt-choices')).toContainText(/Output|輸出/);
  await quickEditor.locator('.pt-choices button').first().click();

  await expect(card.locator('.pt-gthumb[src^="data:image/webp"]')).toBeVisible({ timeout: 5_000 });
});

test('quick-add flyout for a bottom card stays above the viewport bottom', async ({ context }) => {
  const page = await context.newPage();
  await page.setViewportSize({ width: 760, height: 640 });
  await page.goto('/chatgpt-like.html');
  await expect(page.locator('prompttrace-ui')).toBeAttached({ timeout: 10_000 });

  for (let i = 0; i < 5; i++) {
    await createSavedRecord(page);
  }

  await page.locator('.pt-edge-tab').hover();
  const card = page.locator('.pt-gcard').last();
  await expect(card).toBeVisible({ timeout: 10_000 });
  await card.scrollIntoViewIfNeeded();
  await card.click({ button: 'right', position: { x: 24, y: 24 } });
  await page.locator('.pt-gmenu-item').filter({ hasText: /Add text|新增文字/ }).click();

  const quickEditor = page.locator('.pt-quick-editor');
  await expect(quickEditor).toBeVisible({ timeout: 5_000 });
  await expectEditorInsideViewportBottom(quickEditor);
});

test('right-click add text works on a pending capture card', async ({ context }) => {
  const page = await context.newPage();
  await page.goto('/chatgpt-like.html');
  await expect(page.locator('prompttrace-ui')).toBeAttached({ timeout: 10_000 });
  await createPendingRecord(page);

  const pendingCard = page.locator('.pt-card').filter({ hasText: CAPTURE_TEXT }).first();
  await expect(pendingCard).toBeVisible({ timeout: 5_000 });
  await pendingCard.click({ button: 'right', position: { x: 24, y: 24 } });
  await page.locator('.pt-gmenu-item').filter({ hasText: /Add text|新增文字/ }).click();

  const quickEditor = page.locator('.pt-quick-editor');
  await expect(quickEditor).toBeVisible({ timeout: 5_000 });
  await expectEditorAlignedToCard(quickEditor, pendingCard);
  await expectEditorNearPanel(quickEditor, page.locator('.pt-capture-edge .pt-panel'));
  await quickEditor.locator('textarea').fill(QUICK_TEXT);
  await quickEditor.locator('.pt-choices button').first().click();

  await expect(page.locator('.pt-preview').filter({ hasText: QUICK_TEXT })).toBeVisible({ timeout: 5_000 });
});

test('pasting text on a pending capture card opens role choices', async ({ context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const page = await context.newPage();
  await page.goto('/chatgpt-like.html');
  await expect(page.locator('prompttrace-ui')).toBeAttached({ timeout: 10_000 });
  await createPendingRecord(page);

  const pendingCard = page.locator('.pt-card').filter({ hasText: CAPTURE_TEXT }).first();
  await expect(pendingCard).toBeVisible({ timeout: 5_000 });
  await pendingCard.hover();
  await page.evaluate((text) => navigator.clipboard.writeText(text), PASTED_TEXT);
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+V' : 'Control+V');

  const quickEditor = page.locator('.pt-quick-editor');
  await expect(quickEditor).toBeVisible({ timeout: 5_000 });
  await expectEditorAlignedToCard(quickEditor, pendingCard);
  await expect(quickEditor.locator('textarea')).toHaveCount(0);
  await expect(quickEditor.locator('.pt-quick-preview--text')).toContainText(PASTED_TEXT);
  await quickEditor.locator('.pt-choices button').first().click();

  await expect(page.locator('.pt-preview').filter({ hasText: PASTED_TEXT })).toBeVisible({ timeout: 5_000 });
});
