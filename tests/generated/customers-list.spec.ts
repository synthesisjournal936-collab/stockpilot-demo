import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// ---------- shared helpers ----------

function watchForErrors(page: Page): string[] {
  const consoleErrors: string[] = [];
  page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', err => consoleErrors.push(err.message));
  page.on('requestfailed', req => consoleErrors.push(`${req.method()} ${req.url()} failed: ${req.failure()?.errorText}`));
  page.on('response', res => { if (res.status() >= 400) consoleErrors.push(`${res.status()} ${res.request().method()} ${res.url()}`); });
  return consoleErrors;
}

function reportErrors(consoleErrors: string[]): void {
  if (consoleErrors.length) {
    test.info().annotations.push({ type: 'console-errors', description: consoleErrors.slice(0, 5).join(' | ') });
  }
}

async function scanA11y(page: Page): Promise<void> {
  const axeResults = await new AxeBuilder({ page }).setLegacyMode().analyze();
  if (axeResults.violations.length) {
    test.info().annotations.push({
      type: 'a11y-violations',
      description: axeResults.violations.map(v => `${v.id}: ${v.help}`).join(' | '),
    });
  }
}

async function openCustomers(page: Page): Promise<void> {
  await page.goto('customers.html', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Customers', level: 1 })).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole('button', { name: 'Logout' })).toBeVisible({ timeout: 15000 });
}

// data rows = the rows of the customers table that carry the per-row Edit action
// (the empty-state row is a single colspan cell and has none).
function customerRows(page: Page) {
  return page.getByRole('table').getByRole('row').filter({ has: page.getByRole('button', { name: /^[\s\uE000-\uF8FF]*Edit[\s\uE000-\uF8FF]*$/ }) });
}

// ---------- POSITIVE ----------

test('POSITIVE: signed-in user sees the customers list with order counts and row actions', async ({ page }) => {
  test.setTimeout(120000);
  const consoleErrors = watchForErrors(page);

  // journey step: reach the Customers page through the main sidebar navigation
  await page.goto('dashboard.html', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('button', { name: 'Logout' })).toBeVisible({ timeout: 15000 });
  await expect(async () => {
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: /^[\s\uE000-\uF8FF]*Customers[\s\uE000-\uF8FF]*$/ }).click();
    await expect(page.getByRole('heading', { name: 'Customers', level: 1 })).toBeVisible({ timeout: 3000 });
  }).toPass({ timeout: 20000 });

  // signed-in shell that only an authenticated user sees
  await expect(page.getByRole('button', { name: 'Logout' })).toBeVisible();

  // the page heading and its own controls
  const table = page.getByRole('table');
  await expect(table).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole('main')).toMatchAriaSnapshot(`
    - heading "Customers" [level=1]
    - button "Add Customer"
    - searchbox "Search customers"
  `);

  // the five columns the journey asks for
  for (const header of ['Name', 'Email', 'Phone', 'Orders', 'Actions']) {
    await expect(table.getByRole('columnheader', { name: header, exact: true })).toBeVisible();
  }

  const rows = customerRows(page);
  const rowCount = await rows.count();
  expect(rowCount).toBeGreaterThan(0);

  const customers: { name: string; orders: number }[] = [];
  for (let i = 0; i < rowCount; i++) {
    const row = rows.nth(i);
    const name = (await row.getByRole('cell').nth(0).innerText()).trim();
    const email = (await row.getByRole('cell').nth(1).innerText()).trim();
    const phone = (await row.getByRole('cell').nth(2).innerText()).trim();
    const ordersText = (await row.getByRole('cell').nth(3).innerText()).trim();

    expect(name.length).toBeGreaterThan(0);
    expect(email).toMatch(/@/);
    expect(phone.length).toBeGreaterThan(0);
    // order count is a real number (0 or more) for every customer row
    expect(ordersText).toMatch(/^\d+$/);

    // Actions column carries Edit and Delete
    await expect(row.getByRole('button', { name: /^[\s\uE000-\uF8FF]*Edit[\s\uE000-\uF8FF]*$/ })).toBeVisible();
    await expect(row.getByRole('button', { name: /^[\s\uE000-\uF8FF]*Delete[\s\uE000-\uF8FF]*$/ })).toBeVisible();

    customers.push({ name, orders: Number(ordersText) });
  }

  test.info().annotations.push({
    type: 'test-data',
    description: `customers checked: ${customers.map(c => `${c.name}=${c.orders}`).join(', ')}`,
  });

  await scanA11y(page);

  // cross-check the displayed order counts against the real orders list
  await page.goto('orders.html', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Orders', level: 1 })).toBeVisible({ timeout: 15000 });
  for (const customer of customers) {
    await expect(page.getByRole('row').filter({ hasText: customer.name })).toHaveCount(customer.orders, { timeout: 10000 });
  }

  reportErrors(consoleErrors);
});

// ---------- NEGATIVE ----------

test('NEGATIVE: searching for a customer that does not exist shows the empty state instead of rows', async ({ page }) => {
  const consoleErrors = watchForErrors(page);
  await openCustomers(page);

  const rowsBefore = await customerRows(page).count();
  expect(rowsBefore).toBeGreaterThan(0);

  const missing = `no-such-customer-${Date.now()}`;
  test.info().annotations.push({ type: 'test-data', description: `missing search term: ${missing}` });

  const search = page.getByRole('searchbox', { name: 'Search customers' });
  await search.fill(missing);

  // the app's real empty state, and nothing pretending to be a customer
  await expect(page.getByRole('cell', { name: 'No customers found' })).toBeVisible({ timeout: 10000 });
  await expect(customerRows(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^[\s\uE000-\uF8FF]*Edit[\s\uE000-\uF8FF]*$/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^[\s\uE000-\uF8FF]*Delete[\s\uE000-\uF8FF]*$/ })).toHaveCount(0);
  await expect(page.locator('.toast-error')).toHaveCount(0);

  // clearing the term brings the real rows back (nothing was lost or changed)
  await search.fill('');
  await expect(page.getByRole('cell', { name: 'No customers found' })).toHaveCount(0);
  await expect(customerRows(page)).toHaveCount(rowsBefore);

  await scanA11y(page);
  reportErrors(consoleErrors);
});

// ---------- BOUNDARY ----------

test('BOUNDARY: the customer search keeps a 300-character query without truncation and still filters correctly', async ({ page }) => {
  const consoleErrors = watchForErrors(page);
  await openCustomers(page);

  const search = page.getByRole('searchbox', { name: 'Search customers' });

  // source has no maxlength/pattern on this search box -> generic extreme input.
  expect(await search.getAttribute('maxlength')).toBeNull();
  const longQuery = `zz${'q'.repeat(298)}`; // 300 characters
  expect(longQuery).toHaveLength(300);

  await search.fill(longQuery);
  // the app keeps the whole value (no silent cut to a limit) ...
  await expect(search).toHaveValue(longQuery);
  expect((await search.inputValue()).length).toBe(300);
  // ... and answers with its real empty state, no error toast
  await expect(page.getByRole('cell', { name: 'No customers found' })).toBeVisible({ timeout: 10000 });
  await expect(page.locator('.toast-error')).toHaveCount(0);

  // exact-match edge: a full email filters down to exactly that one customer
  await search.fill('');
  const firstRow = customerRows(page).first();
  const email = (await firstRow.getByRole('cell').nth(1).innerText()).trim();
  await search.fill(email);
  await expect(customerRows(page)).toHaveCount(1, { timeout: 10000 });
  await expect(customerRows(page).first()).toContainText(email);

  await search.fill('');
  await expect(page.getByRole('cell', { name: 'No customers found' })).toHaveCount(0);

  await scanA11y(page);
  reportErrors(consoleErrors);
});

// ---------- STATE ----------

test('STATE: empty customers list shows the "No customers found" empty state', async ({ page }) => {
  const consoleErrors = watchForErrors(page);

  // the list is read from localStorage under this key; an empty stored list must not be re-seeded
  await page.addInitScript(() => {
    try { localStorage.setItem('stockpilot_v1_customers', JSON.stringify([])); } catch { /* storage blocked */ }
  });

  await openCustomers(page);

  await expect(page.getByRole('cell', { name: 'No customers found' })).toBeVisible({ timeout: 10000 });
  await expect(customerRows(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^[\s\uE000-\uF8FF]*Edit[\s\uE000-\uF8FF]*$/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^[\s\uE000-\uF8FF]*Delete[\s\uE000-\uF8FF]*$/ })).toHaveCount(0);
  // the page itself is fine: heading and its own controls still render
  await expect(page.getByRole('heading', { name: 'Customers', level: 1 })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add Customer' })).toBeVisible();

  await scanA11y(page);
  reportErrors(consoleErrors);
});

test('STATE: signing out ends the session and the customers page can no longer be opened', async ({ page }) => {
  const consoleErrors = watchForErrors(page);
  await openCustomers(page);

  await expect(customerRows(page).first()).toBeVisible({ timeout: 10000 });

  await expect(async () => {
    await page.getByRole('button', { name: 'Logout' }).click();
    await page.waitForURL(u => u.toString().includes('login.html'), { timeout: 3000 });
  }).toPass({ timeout: 15000 });
  await expect(page.locator('#login-email')).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();

  // the protected page must not open any more - the sign-in form shows instead
  await page.goto('customers.html', { waitUntil: 'domcontentloaded' });
  await page.waitForURL(u => u.toString().includes('login.html'), { timeout: 15000 });
  await expect(page.locator('#login-email')).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole('heading', { name: 'Customers', level: 1 })).toHaveCount(0);
  await expect(page.getByRole('cell', { name: 'No customers found' })).toHaveCount(0);

  await scanA11y(page);
  reportErrors(consoleErrors);
});

// ---------- SECURITY ----------

test.describe('customers page without a session', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('SECURITY: opening the customers page while signed out shows the sign-in form', async ({ page }) => {
    const consoleErrors = watchForErrors(page);

    await page.goto('customers.html', { waitUntil: 'domcontentloaded' });

    // the app redirects to the sign-in page and renders its form
    await page.waitForURL(u => u.toString().includes('login.html'), { timeout: 15000 });
    await expect(page.getByRole('textbox', { name: 'Email' })).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();

    // none of the customer data leaked onto the sign-in page
    await expect(page.getByRole('heading', { name: 'Customers', level: 1 })).toHaveCount(0);
    await expect(page.getByRole('table')).toHaveCount(0);

    await scanA11y(page);
    reportErrors(consoleErrors);
  });
});