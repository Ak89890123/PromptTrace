import { test, expect } from './support/extension';
import type { BrowserContext } from '@playwright/test';

const NEEDLE = 'The quick brown fox jumps over the lazy dog';
const SUMMARY_TEXT = '這是一段會顯示在右側小卡卡片層級的摘要，用來描述輸入、參考、排除條件到輸出成果之間的目的與限制，不是輸出本身。';

async function setLatestRecordSummary(context: BrowserContext, extensionId: string, summary: string): Promise<void> {
  const extensionPage = await context.newPage();
  await extensionPage.goto(`chrome-extension://${extensionId}/popup.html`);
  await extensionPage.evaluate(async (nextSummary) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('promptrace', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('libraryRecords', 'readwrite');
        const store = tx.objectStore('libraryRecords');
        const request = store.getAll();
        request.onsuccess = () => {
          const records = (request.result as Array<{ id: string; createdAt: string; updatedAt: string; summary?: string }>).sort((a, b) =>
            a.createdAt < b.createdAt ? 1 : -1,
          );
          const latest = records[0];
          if (latest) store.put({ ...latest, summary: nextSummary, updatedAt: new Date().toISOString() });
        };
        request.onerror = () => reject(request.error);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  }, summary);
  await extensionPage.close();
}

test('saved prompt has no copy label but still fills from the in-page gallery', async ({ context, extensionId }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
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
  const roleButton = page.locator('.pt-toolbar button').first();
  await expect(roleButton).toBeVisible({ timeout: 5_000 });
  await roleButton.click();

  await page.locator('.pt-commit').click();
  await expect(page.locator('.pt-wizard')).toBeVisible({ timeout: 5_000 });
  await page.locator('.pt-wizard .pt-choice').first().click();
  await setLatestRecordSummary(context, extensionId, SUMMARY_TEXT);

  await page.locator('.pt-edge-tab').hover();
  const prompt = page.locator('.pt-gprompt').filter({ hasText: NEEDLE });
  await expect(prompt).toBeVisible({ timeout: 10_000 });
  const card = page.locator('.pt-gcard').filter({ hasText: NEEDLE }).first();
  const summary = card.locator(':scope > .pt-gsummary');
  await expect(summary).toHaveText(SUMMARY_TEXT);
  await expect(summary).toHaveCSS('-webkit-line-clamp', '2');
  await expect(card.locator('.pt-gcol .pt-gsummary')).toHaveCount(0);
  await summary.hover();
  await page.waitForTimeout(120);
  await expect(page.locator('.pt-hover-preview')).toHaveCount(0);
  await expect(page.locator('.pt-hover-preview')).toContainText(SUMMARY_TEXT);
  await prompt.hover();
  const hoverPreview = page.locator('.pt-hover-preview');
  await expect(hoverPreview).toContainText(NEEDLE);
  const previewBox = await hoverPreview.boundingBox();
  expect(previewBox).not.toBeNull();
  await page.mouse.move((previewBox?.x ?? 0) + (previewBox?.width ?? 0) / 2, (previewBox?.y ?? 0) + 24);
  await page.waitForTimeout(240);
  await expect(hoverPreview).toContainText(NEEDLE);
  await expect(page.locator('.pt-gcol-copy')).toHaveCount(0);

  const column = page.locator('.pt-gcol--copyable').filter({ hasText: NEEDLE });
  await column.click();
  await expect(page.locator('#prompt-textarea')).toHaveValue(new RegExp(NEEDLE));
});

test('saved image has no copy label but still copies from the in-page gallery', async ({ context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const page = await context.newPage();
  await page.goto('/chatgpt-like.html');
  await expect(page.locator('prompttrace-ui')).toBeAttached({ timeout: 10_000 });

  await page.locator('#img-1').hover();
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('prompttrace:summon')));
  const roleButton = page.locator('.pt-toolbar button').first();
  await expect(roleButton).toBeVisible({ timeout: 5_000 });
  await roleButton.click();

  await page.locator('.pt-commit').click();
  await expect(page.locator('.pt-wizard')).toBeVisible({ timeout: 5_000 });
  await page.locator('.pt-wizard .pt-choice').first().click();

  await page.locator('.pt-edge-tab').hover();
  const thumb = page.locator('.pt-gthumb').first();
  await expect(thumb).toBeVisible({ timeout: 10_000 });
  await thumb.hover();
  await expect(page.locator('.pt-hover-preview--image img')).toBeVisible({ timeout: 5_000 });
  await expect(page.locator('.pt-gcol-copy')).toHaveCount(0);

  await thumb.click();
  await expect(page.locator('.pt-lightbox')).toHaveCount(0);
  await expect(page.locator('#attachments img')).toHaveCount(1);
});
