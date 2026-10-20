import { defineConfig } from '@playwright/test';
import * as path from 'path';

// Answers people gave to the AI's questions (HITL): uploaded files are in
// ./test-data, secret answers arrive as one JSON environment variable.
process.env.TEST_DATA_DIR = process.env.TEST_DATA_DIR || path.join(__dirname, 'test-data');
try { Object.assign(process.env, JSON.parse(process.env.HITL_SECRETS_JSON || '{}')); } catch { /* none */ }

// The browser's own sign-in box (HTTP Basic Auth), when the site has one:
// answered with the saved login, for the tested site only.
function siteLogin() {
  const username = process.env.APP_USERNAME;
  const password = process.env.APP_PASSWORD;
  const base = process.env.PLAYWRIGHT_BASE_URL;
  if (!username || !password || !base) return undefined;
  try { return { username, password, origin: new URL(base).origin }; } catch { return undefined; }
}

export default defineConfig({
  testDir: './tests/generated',
  retries: 1,
  // Logs in once and saves the session every test starts from (see
  // auth.setup.ts); a test that logs in by itself starts signed out.
  globalSetup: './auth.setup.ts',
  reporter: [
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['json', { outputFile: 'playwright-report/results.json' }],
  ],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL,
    httpCredentials: siteLogin(),
    storageState: './.auth/state.json',
    browserName: 'chromium',
    // Same limits as a local run. Without them a click on a button that is no longer
    // there waited out the whole test (120s with test.setTimeout) -- seen live: a
    // renamed button made 5 tests x 2 tries take 16.9 minutes.
    actionTimeout: 15000,
    navigationTimeout: 20000,
    headless: true,
    // Captured for every test, not just failures -- same reasoning as local
    // headed execution's own config: this runs on a GitHub-hosted runner
    // with no one watching live, so the screenshot/video/trace in the
    // report is the only way to actually see what a passed run did too.
    screenshot: 'on',
    trace: 'on',
    video: 'on',
  },
});
