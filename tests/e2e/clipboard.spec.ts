import { test, expect } from './support/extension';
import type { BrowserContext } from '@playwright/test';

const NEEDLE = 'The quick brown fox jumps over the lazy dog';
const SUMMARY_TEXT = '這是一段會顯示在右側小卡卡片層級的摘要，用來描述輸入、參考、排除條件到輸出成果之間的目的與限制，不是輸出本身。';

async function setLatestRecordSummary(context: BrowserContext, extensionId: string, summary: string): Promise<void> {
  const extensionPage = await context.newPage();
  await extensionPage.goto(`chrome-extension://${extensionId}/popup.html`);
  await extensionPage.evaluate(async (nextSummary) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      // Let the extension open the current schema version; this helper only
      // edits record metadata and should not pin the test to an old version.
      const request = indexedDB.open('promptrace');
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
  const panel = page.locator('.pt-gallery-panel');
  const filters = page.locator('.pt-filter-chip');
  expect(await filters.count()).toBeGreaterThan(1);
  const beforeFilterBox = await panel.boundingBox();
  expect(beforeFilterBox).not.toBeNull();
  await filters.nth(1).click();
  await expect(page.locator('.pt-gcard')).toHaveCount(0);
  const afterFilterBox = await panel.boundingBox();
  expect(afterFilterBox).not.toBeNull();
  expect(Math.abs((afterFilterBox?.y ?? 0) - (beforeFilterBox?.y ?? 0))).toBeLessThanOrEqual(2);
  expect((afterFilterBox?.height ?? 0)).toBeLessThan((beforeFilterBox?.height ?? 0) - 10);
  await filters.first().click();
  await expect(prompt).toBeVisible({ timeout: 5_000 });
  await expect.poll(async () => (await panel.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(
    (beforeFilterBox?.height ?? 0) - 2,
  );
  const restoredFilterBox = await panel.boundingBox();
  expect(restoredFilterBox).not.toBeNull();
  expect(Math.abs((restoredFilterBox?.y ?? 0) - (beforeFilterBox?.y ?? 0))).toBeLessThanOrEqual(2);
  const card = page.locator('.pt-gcard').filter({ hasText: NEEDLE }).first();
  const summary = card.locator(':scope > .pt-gsummary');
  await expect(summary).toHaveText(SUMMARY_TEXT);
  await expect(summary).toHaveCSS('-webkit-line-clamp', '2');
  await expect(card.locator('.pt-gcol .pt-gsummary')).toHaveCount(0);
  await summary.hover();
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

  await page.mouse.move(20, 20);
  await expect(page.locator('.pt-panel-dock')).toHaveCount(0, { timeout: 2_000 });
  await expect(page.locator('.pt-edge-tab')).toBeVisible();
});

test('same-role text captures render as one gallery prompt block', async ({ context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const page = await context.newPage();
  await page.goto('/chatgpt-like.html');
  await expect(page.locator('prompttrace-ui')).toBeAttached({ timeout: 10_000 });

  async function captureAsInput(selector: string) {
    await page.evaluate((targetSelector) => {
      const el = document.querySelector(targetSelector)!;
      const range = document.createRange();
      range.selectNodeContents(el);
      const sel = window.getSelection()!;
      sel.removeAllRanges();
      sel.addRange(range);
      window.dispatchEvent(new CustomEvent('prompttrace:summon'));
    }, selector);
    const roleButton = page.locator('.pt-toolbar button').first();
    await expect(roleButton).toBeVisible({ timeout: 5_000 });
    await roleButton.click();
  }

  await captureAsInput('#msg-1');
  await captureAsInput('#msg-2');

  await page.locator('.pt-commit').click();
  await expect(page.locator('.pt-wizard')).toBeVisible({ timeout: 5_000 });
  await page.locator('.pt-wizard .pt-choice').first().click();

  await page.locator('.pt-edge-tab').hover();
  const card = page.locator('.pt-gcard').filter({ hasText: 'A reply message to add vertical content.' }).first();
  await expect(card).toBeVisible({ timeout: 10_000 });

  const inputPrompts = card.locator('.pt-gcol').first().locator('.pt-gprompt');
  await expect(inputPrompts).toHaveCount(1);
  const text = await inputPrompts.locator('.pt-gtext').innerText();
  expect(text).toContain(NEEDLE);
  expect(text).toContain('A reply message to add vertical content.');
  expect(text).toContain('\n\n');
});

test('saved prompt preserves line breaks when filling a contenteditable composer', async ({ context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const page = await context.newPage();
  await page.goto('/chatgpt-like.html');
  await expect(page.locator('prompttrace-ui')).toBeAttached({ timeout: 10_000 });

  const multiLineText = '第一行 prompt\n第二行 reference\n\n第四行 constraint';
  await page.evaluate((text) => {
    const target = document.querySelector('#prompt-textarea')!;
    const editor = document.createElement('div');
    editor.id = 'prompt-textarea';
    editor.dataset.testid = 'prompt-textarea';
    editor.setAttribute('aria-label', 'Message Prompt');
    editor.setAttribute('contenteditable', 'true');
    editor.setAttribute('role', 'textbox');
    target.replaceWith(editor);

    const source = document.createElement('div');
    source.id = 'multiline-prompt-source';
    source.style.whiteSpace = 'pre-wrap';
    source.textContent = text;
    document.querySelector('#thread')!.prepend(source);

    const range = document.createRange();
    range.selectNodeContents(source);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    window.dispatchEvent(new CustomEvent('prompttrace:summon'));
  }, multiLineText);

  const roleButton = page.locator('.pt-toolbar button').first();
  await expect(roleButton).toBeVisible({ timeout: 5_000 });
  await roleButton.click();
  await page.locator('.pt-commit').click();
  await expect(page.locator('.pt-wizard')).toBeVisible({ timeout: 5_000 });
  await page.locator('.pt-wizard .pt-choice').first().click();

  await page.locator('.pt-edge-tab').hover();
  const column = page.locator('.pt-gcol--copyable').filter({ hasText: '第一行 prompt' });
  await expect(column).toBeVisible({ timeout: 10_000 });
  await column.click();

  const editorText = await page.locator('#prompt-textarea').evaluate((el) => (el as HTMLElement).innerText.replace(/\u200B/g, ''));
  expect(editorText).toContain(multiLineText);
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
