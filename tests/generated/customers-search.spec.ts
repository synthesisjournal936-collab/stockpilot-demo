import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

function attachDiagnostics(page: Page, errors: string[]) {
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', err => errors.push(err.message));
  page.on('requestfailed', req => errors.push(`${req.method()} ${req.url()} failed: ${req.failure()?.errorText}`));
  page.on('response', res => { if (res.status() >= 400) errors.push(`${res.status()} ${res.request().method()} ${res.url()}`); });
}

async function reportDiagnostics(page: Page, errors: string[]) {
  const axeResults = await new AxeBuilder({ page }).setLegacyMode().analyze();
  if (axeResults.violations.length) {
    test.info().annotations.push({
      type: 'a11y-violations',
      description: axeResults.violations.map(v => `${v.id}: ${v.help}`).join(' | '),
    });
  }
  if (errors.length) test.info().annotations.push({ type: 'console-errors', description: errors.slice(0, 5).join(' | ') });
}

async function gotoCustomers(page: Page) {
  await page.goto('dashboard.html', { waitUntil: 'domcontentloaded' });
  const customersLink = page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: /^[\s\uE000-\uF8FF]*Customers[\s\uE000-\uF8FF]*$/ });
  await expect(customersLink).toBeVisible({ timeout: 15000 });
  await expect(async () => {
    await customersLink.click();
    await expect(page).toHaveURL(/customers\.html/, { timeout: 3000 });
  }).toPass({ timeout: 20000 });
  await expect(page.getByRole('heading', { name: 'Customers', level: 1 })).toBeVisible({ timeout: 15000 });
}

test.describe('Customers list search', () => {
  test('POSITIVE: searching filters the customer table by name and email', async ({ page }) => {
    test.setTimeout(120000);
    const errors: string[] = [];
    attachDiagnostics(page, errors);

    await gotoCustomers(page);

    const search = page.getByRole('searchbox', { name: 'Search customers' });
    await expect(search).toBeVisible({ timeout: 15000 });

    const dataRows = page.locator('#customer-table tbody tr[data-id]');
    await expect(dataRows.first()).toBeVisible({ timeout: 15000 });
    const totalRows = await dataRows.count();
    expect(totalRows).toBeGreaterThan(1);

    // Filter by part of a customer's NAME.
    await search.fill('north');
    await expect(page.getByRole('row', { name: /Northwind Traders/ })).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('row', { name: /Brightside Retail/ })).toHaveCount(0);
    await expect(dataRows).toHaveCount(1);

    // Filter by part of a customer's EMAIL.
    await search.fill('orders@');
    await expect(page.getByRole('row', { name: /orders@brightside\.test/ })).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('row', { name: /Northwind Traders/ })).toHaveCount(0);
    await expect(dataRows).toHaveCount(1);

    await expect(page.getByRole('main')).toMatchAriaSnapshot(`
      - heading "Customers" [level=1]
      - button "Add Customer"
      - searchbox "Search customers"
    `);

    // Clearing the box restores the full list.
    await search.fill('');
    await expect(dataRows).toHaveCount(totalRows);
    await expect(page.getByRole('row', { name: /Northwind Traders/ })).toBeVisible();
    await expect(page.getByRole('row', { name: /Brightside Retail/ })).toBeVisible();

    await reportDiagnostics(page, errors);
  });

  test('NEGATIVE: a search that matches no customer shows the empty state and no customer rows', async ({ page }) => {
    test.setTimeout(120000);
    const errors: string[] = [];
    attachDiagnostics(page, errors);

    await gotoCustomers(page);

    const search = page.getByRole('searchbox', { name: 'Search customers' });
    await expect(search).toBeVisible({ timeout: 15000 });
    const dataRows = page.locator('#customer-table tbody tr[data-id]');
    await expect(dataRows.first()).toBeVisible({ timeout: 15000 });
    const totalRows = await dataRows.count();

    await search.fill('zzz-no-such-customer-99');

    await expect(page.getByRole('row', { name: /No customers found/ })).toBeVisible({ timeout: 10000 });
    await expect(dataRows).toHaveCount(0);
    // The table headers are still there (page not broken), the box keeps what was typed,
    // and nothing was added to the list by this non-matching query.
    await expect(page.getByRole('columnheader', { name: 'Name' })).toBeVisible();
    await expect(search).toHaveValue('zzz-no-such-customer-99');
    expect(totalRows).toBeGreaterThan(0);

    await reportDiagnostics(page, errors);
  });

  test('VALIDATION: an empty / whitespace-only search is accepted and lists every customer', async ({ page }) => {
    test.setTimeout(120000);
    const errors: string[] = [];
    attachDiagnostics(page, errors);

    await gotoCustomers(page);

    const search = page.getByRole('searchbox', { name: 'Search customers' });
    await expect(search).toBeVisible({ timeout: 15000 });
    const dataRows = page.locator('#customer-table tbody tr[data-id]');
    await expect(dataRows.first()).toBeVisible({ timeout: 15000 });
    const totalRows = await dataRows.count();

    // Whitespace only -> trimmed to empty -> whole list, never the "No customers found" row.
    await search.fill('   ');
    await expect(dataRows).toHaveCount(totalRows);
    await expect(page.getByRole('row', { name: /No customers found/ })).toHaveCount(0);

    // Explicitly empty again.
    await search.fill('');
    await expect(dataRows).toHaveCount(totalRows);
    await expect(page.getByRole('row', { name: /No customers found/ })).toHaveCount(0);

    await reportDiagnostics(page, errors);
  });

  test('BOUNDARY: search accepts a single character and has no length limit (200-char query kept, finds nothing)', async ({ page }) => {
    test.setTimeout(120000);
    const errors: string[] = [];
    attachDiagnostics(page, errors);

    await gotoCustomers(page);

    const search = page.getByRole('searchbox', { name: 'Search customers' });
    await expect(search).toBeVisible({ timeout: 15000 });
    const dataRows = page.locator('#customer-table tbody tr[data-id]');
    await expect(dataRows.first()).toBeVisible({ timeout: 15000 });

    // Smallest real query: one character. 'n' appears only in Northwind Traders / buying@northwind.test.
    await search.fill('n');
    await expect(search).toHaveValue('n');
    await expect(page.getByRole('row', { name: /Northwind Traders/ })).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('row', { name: /Brightside Retail/ })).toHaveCount(0);

    // No maxLength exists on this search input (source has no maxlength attribute):
    // a 200-character query must be kept exactly as typed, not cut down.
    const longQuery = 'zz' + 'x'.repeat(198);
    expect(longQuery.length).toBe(200);
    await search.fill(longQuery);
    await expect(search).toHaveValue(longQuery);
    expect((await search.inputValue()).length).toBe(200);
    await expect(page.getByRole('row', { name: /No customers found/ })).toBeVisible({ timeout: 10000 });
    await expect(dataRows).toHaveCount(0);

    // And a longer value is still accepted by the field itself.
    const longerQuery = 'q'.repeat(500);
    await search.fill(longerQuery);
    expect((await search.inputValue()).length).toBe(500);

    await reportDiagnostics(page, errors);
  });

  test('SECURITY: markup typed into the search box is treated as inert text, never executed', async ({ page }) => {
    test.setTimeout(120000);
    const errors: string[] = [];
    attachDiagnostics(page, errors);

    let dialogSeen = false;
    page.on('dialog', async d => { dialogSeen = true; await d.dismiss(); });

    await gotoCustomers(page);

    const search = page.getByRole('searchbox', { name: 'Search customers' });
    await expect(search).toBeVisible({ timeout: 15000 });
    await expect(page.locator('#customer-table tbody tr[data-id]').first()).toBeVisible({ timeout: 15000 });

    const payload = '<script>alert(1)</script><img src=x onerror=alert(1)>';
    await search.fill(payload);

    await expect(search).toHaveValue(payload);
    await expect(page.getByRole('row', { name: /No customers found/ })).toBeVisible({ timeout: 10000 });
    expect(dialogSeen).toBe(false);
    expect(await page.locator('#customer-table tbody script, #customer-table tbody img').count()).toBe(0);
    await expect(page.getByRole('heading', { name: 'Customers', level: 1 })).toBeVisible();

    await reportDiagnostics(page, errors);
  });

  test('STATE: ending the session and reloading sends the user back to the sign-in page', async ({ page }) => {
    test.setTimeout(120000);
    const errors: string[] = [];
    attachDiagnostics(page, errors);

    await gotoCustomers(page);

    await expect(page.locator('#customer-table tbody tr[data-id]').first()).toBeVisible({ timeout: 15000 });

    await page.context().clearCookies();
    await page.evaluate(() => {
      try { localStorage.clear(); } catch (e) { /* ignore */ }
      try { sessionStorage.clear(); } catch (e) { /* ignore */ }
    });

    await page.reload({ waitUntil: 'domcontentloaded' });

    await expect(page).toHaveURL(/login\.html/, { timeout: 15000 });
    await expect(page.locator('#login-email')).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Customers', level: 1 })).toHaveCount(0);

    await reportDiagnostics(page, errors);
  });
});

test.describe('SECURITY: signed-out access', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('SECURITY: the customers page cannot be opened without a signed-in session', async ({ page }) => {
    const errors: string[] = [];
    attachDiagnostics(page, errors);

    await page.goto('customers.html', { waitUntil: 'domcontentloaded' });

    await expect(page.locator('#login-email')).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Customers', level: 1 })).toHaveCount(0);
    await expect(page.getByRole('searchbox', { name: 'Search customers' })).toHaveCount(0);

    await reportDiagnostics(page, errors);
  });
});