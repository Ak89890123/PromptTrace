import { test as base, chromium, type BrowserContext } from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/** Path to the built MV3 extension. Run `npm run build` first. */
const EXTENSION_PATH = path.resolve(process.cwd(), '.output/chrome-mv3');

/**
 * Loads the built extension into a persistent Chromium context. Extensions
 * require launchPersistentContext (not launch). CI runs headless by default;
 * use `playwright test --headed` locally when a visible browser is needed.
 */
export const test = base.extend<{ context: BrowserContext; extensionId: string }>({
  context: async ({ headless }, use) => {
    const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'promptrace-e2e-'));
    const context = await chromium.launchPersistentContext(userDataDir, {
      channel: 'chromium',
      headless,
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
        '--no-first-run',
      ],
    });

    try {
      await use(context);
    } finally {
      await context.close();
      await fs.rm(userDataDir, { recursive: true, force: true });
    }
  },
  // The background service worker's URL carries the extension id.
  extensionId: async ({ context }, use) => {
    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent('serviceworker');
    await use(sw.url().split('/')[2]);
  },
});

export const expect = test.expect;
