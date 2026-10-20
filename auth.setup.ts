// Written by the test app, not by the AI: logs in ONCE before the tests
// and saves the session, so every test starts signed in. Never fails the
// run -- without a session, tests start signed out, as before.
import { chromium, type FullConfig } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const STATE = path.join(__dirname, '.auth', 'state.json');
const RESULT = path.join(__dirname, 'login-check', 'result.json');
const USER_FIELD = [
  'input[type="email"]', 'input[name="email"]', 'input[name="username"]', 'input[name="_username"]',
  'input[id="username"]', 'input[autocomplete="username"]', 'input[placeholder*="email" i]',
  'input[placeholder*="username" i]', 'input[name*="login" i]', 'input[name*="user" i]',
].join(', ');
const PASSWORD_FIELD = 'input[type="password"]';
const SUBMIT = 'button[type="submit"], input[type="submit"], button:has-text("Sign in"), button:has-text("Log in"), button:has-text("Login")';
const LOGIN_LINK = 'a:has-text("Log in"), a:has-text("Login"), a:has-text("Sign in"), a[href*="login" i], button:has-text("Log in"), button:has-text("Sign in")';
const MESSAGES = '[role="alert"], .alert, .error, .errors, .invalid-feedback, .text-danger, [class*="error" i], [class*="alert" i]';

function write(result: Record<string, unknown>) {
  fs.mkdirSync(path.dirname(RESULT), { recursive: true });
  fs.writeFileSync(RESULT, JSON.stringify(result));
}

export default async function globalSetup(config: FullConfig) {
  fs.mkdirSync(path.dirname(STATE), { recursive: true });
  fs.writeFileSync(STATE, JSON.stringify({ cookies: [], origins: [] }));
  const user = process.env.APP_USERNAME;
  const password = process.env.APP_PASSWORD;
  const base = process.env.PLAYWRIGHT_BASE_URL;
  if (!user || !password || !base) { write({ ok: false, reason: 'no_login' }); return; }
  const use = (config.projects[0]?.use || {}) as { channel?: string };
  const browser = await chromium.launch({ channel: use.channel, headless: true });
  try {
    let origin: string | undefined;
    try { origin = new URL(base).origin; } catch { origin = undefined; }
    const page = await (await browser.newContext({
      viewport: { width: 1280, height: 720 },
      // The browser's own sign-in box (HTTP Basic Auth), when the site has one.
      httpCredentials: origin ? { username: user, password, origin } : undefined,
    })).newPage();
    // A wrong login comes back as a 401 page; no login at all as a browser error.
    const boxRefused = { ok: false, reason: 'refused', message: "The site's browser sign-in box (HTTP Basic Auth) refused the saved login." };
    try {
      const response = await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 30000 });
      if (response?.status() === 401 && /basic/i.test(response.headers()['www-authenticate'] || '')) {
        write(boxRefused);
        return;
      }
    } catch (error) {
      if (String((error as Error)?.message || error).includes('ERR_INVALID_AUTH_CREDENTIALS')) {
        write(boxRefused);
        return;
      }
      throw error;
    }
    const pass = page.locator(PASSWORD_FIELD).filter({ visible: true }).first();
    const userField = page.locator(USER_FIELD).filter({ visible: true }).first();
    const shown = (el: typeof pass, ms: number) => el.waitFor({ state: 'visible', timeout: ms }).then(() => true, () => false);
    if (!(await shown(pass, 8000)) && !(await shown(userField, 1000))) {
      const link = page.locator(LOGIN_LINK).filter({ visible: true }).first();
      if (await link.count()) await link.click({ timeout: 10000 }).catch(() => undefined);
    }
    if (await shown(userField, 5000)) {
      await userField.fill(user);
      // A two-step sign-in (email first, then the password).
      if (!(await shown(pass, 1000))) {
        await page.locator(SUBMIT).filter({ visible: true }).first().click({ timeout: 10000 }).catch(() => undefined);
      }
    }
    if (!(await shown(pass, 10000))) { write({ ok: false, reason: 'no_form' }); return; }
    await pass.fill(password);
    const submit = page.locator(SUBMIT).filter({ visible: true }).first();
    if (await submit.count()) await submit.click({ timeout: 10000 }); else await pass.press('Enter');
    // Signed in once the password field is gone (a redirect back to the
    // same sign-in page leaves it there).
    const signedIn = await pass.waitFor({ state: 'hidden', timeout: 20000 }).then(() => true, () => false);
    if (!signedIn) {
      const texts = (await page.locator(MESSAGES).filter({ visible: true }).allInnerTexts())
        .map((t) => t.replace(/\s+/g, ' ').trim()).filter((t) => t && t.length < 200);
      write({ ok: false, reason: 'refused', message: texts[0] || '' });
      return;
    }
    await page.waitForLoadState('domcontentloaded').catch(() => undefined);
    await page.context().storageState({ path: STATE });
    write({ ok: true });
  } catch (error) {
    write({ ok: false, reason: 'error', message: String((error as Error)?.message || error).slice(0, 200) });
  } finally {
    await browser.close();
  }
}
