import { test as base, chromium, type BrowserContext } from '@playwright/test';
import path from 'node:path';

/** Path to the built MV3 extension. Run `npm run build` first. */
const EXTENSION_PATH = path.resolve(process.cwd(), '.output/chrome-mv3');

/**
 * Loads the built extension into a persistent Chromium context. Extensions
 * require launchPersistentContext (not launch) and a headed/new-headless
 * browser; headed is used here so a failing run can be watched.
 */
export const test = base.extend<{ context: BrowserContext; extensionId: string }>({
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext('', {
      headless: false,
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
        '--no-first-run',
      ],
    });
    await use(context);
    await context.close();
  },
  // The background service worker's URL carries the extension id.
  extensionId: async ({ context }, use) => {
    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent('serviceworker');
    await use(sw.url().split('/')[2]);
  },
});

export const expect = test.expect;
