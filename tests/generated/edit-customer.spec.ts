import { test, expect, Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/** Collects console/page/network problems so a human can look at them afterwards (never blocks a test). */
function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('requestfailed', (req) => errors.push(`${req.method()} ${req.url()} failed: ${req.failure()?.errorText}`));
  page.on('response', (res) => { if (res.status() >= 400) errors.push(`${res.status()} ${res.request().method()} ${res.url()}`); });
  return errors;
}

async function reportAnnotations(page: Page, errors: string[]): Promise<void> {
  if (errors.length) {
    test.info().annotations.push({ type: 'console-errors', description: errors.slice(0, 5).join(' | ') });
  }
  const axeResults = await new AxeBuilder({ page }).setLegacyMode().analyze();
  if (axeResults.violations.length) {
    test.info().annotations.push({
      type: 'a11y-violations',
      description: axeResults.violations.map(v => `${v.id}: ${v.help}`).join(' | '),
    });
  }
}

/** Real error spans from customers.html (each is a role="alert" span with a stable id). */
const ERROR_SPAN: Record<string, string> = {
  'Customer name': '#customer-name-error',
  'Email': '#customer-email-error',
  'Phone': '#customer-phone-error',
};

async function gotoCustomers(page: Page) {
  await page.goto('customers.html', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Customers', level: 1 })).toBeVisible({ timeout: 15000 });
  const table = page.getByRole('table').first();
  await expect(table.locator('tbody').getByRole('row').first()).toBeVisible({ timeout: 15000 });
  return table;
}

function firstDataRow(page: Page) {
  return page.getByRole('table').first().locator('tbody').getByRole('row').first();
}

async function firstRowCellTexts(page: Page) {
  const cells = firstDataRow(page).getByRole('cell');
  return {
    name: (await cells.nth(0).innerText()).trim(),
    email: (await cells.nth(1).innerText()).trim(),
    phone: (await cells.nth(2).innerText()).trim(),
  };
}

/** Clicking Edit opens the pre-filled "Edit customer" dialog; retried because the click can land while the table renders. */
async function openEditDialog(page: Page) {
  const dialog = page.getByRole('dialog', { name: 'Edit customer' });
  await expect(async () => {
    await firstDataRow(page).getByRole('button', { name: /^[\s\uE000-\uF8FF]*Edit[\s\uE000-\uF8FF]*$/ }).click();
    await expect(dialog).toBeVisible({ timeout: 3000 });
  }).toPass({ timeout: 20000 });
  return dialog;
}

test.describe('Edit an existing customer', () => {
  test('POSITIVE: editing a customer saves the new name and shows it in the table', async ({ page }) => {
    test.setTimeout(120000);
    const errors = trackErrors(page);

    await gotoCustomers(page);
    const original = await firstRowCellTexts(page);

    const dialog = await openEditDialog(page);
    const nameInput = dialog.getByLabel('Customer name');
    const emailInput = dialog.getByLabel('Email');
    const phoneInput = dialog.getByLabel('Phone');

    // The dialog is pre-filled with that customer's real values
    await expect(nameInput).toHaveValue(original.name);
    await expect(emailInput).toHaveValue(original.email);
    if (original.phone !== '-') {
      await expect(phoneInput).toHaveValue(original.phone);
    }

    const stamp = Date.now();
    const updatedName = `Brightside Retail ${stamp}`;
    test.info().annotations.push({ type: 'test-data', description: `updatedName: ${updatedName}` });

    await nameInput.fill(updatedName);
    await dialog.getByRole('button', { name: 'Save customer' }).click();

    const toast = page.getByRole('status').filter({ hasText: 'Customer updated' });
    await expect(toast).toBeVisible({ timeout: 10000 });
    await expect(dialog).toBeHidden({ timeout: 10000 });

    await expect(page.getByRole('main')).toMatchAriaSnapshot(`
      - heading "Customers" [level=1]
      - button "Add Customer"
      - searchbox "Search customers"
    `);

    // The list really shows the updated record
    const search = page.getByRole('searchbox', { name: 'Search customers' });
    await search.fill(String(stamp));
    const updatedRow = page.getByRole('row').filter({ hasText: String(stamp) });
    await expect(updatedRow).toBeVisible({ timeout: 10000 });
    await expect(updatedRow).toContainText(original.email);

    // And it survives a reload (real persistence, not just a client toast)
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Customers', level: 1 })).toBeVisible({ timeout: 15000 });
    await page.getByRole('searchbox', { name: 'Search customers' }).fill(String(stamp));
    await expect(page.getByRole('row').filter({ hasText: String(stamp) })).toBeVisible({ timeout: 10000 });

    await reportAnnotations(page, errors);
  });

  test('NEGATIVE: saving an edit with a missing name and invalid email is rejected', async ({ page }) => {
    test.setTimeout(120000);
    const errors = trackErrors(page);

    await gotoCustomers(page);
    const original = await firstRowCellTexts(page);
    const dialog = await openEditDialog(page);

    const nameInput = dialog.getByLabel('Customer name');
    const emailInput = dialog.getByLabel('Email');

    await nameInput.fill('');
    await emailInput.fill('not-an-email');
    await dialog.getByRole('button', { name: 'Save customer' }).click();

    await expect(dialog.locator(ERROR_SPAN['Customer name'])).toHaveText('Customer name is required');
    await expect(dialog.locator(ERROR_SPAN['Email'])).toHaveText('Enter a valid email address');
    await expect(dialog).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: 'Customer updated' })).toHaveCount(0);

    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    await expect(firstDataRow(page)).toContainText(original.name);

    await reportAnnotations(page, errors);
  });

  test('VALIDATION: each required field shows its own required message', async ({ page }) => {
    test.setTimeout(120000);
    const errors = trackErrors(page);

    await gotoCustomers(page);
    const original = await firstRowCellTexts(page);
    const dialog = await openEditDialog(page);

    const nameInput = dialog.getByLabel('Customer name');
    const emailInput = dialog.getByLabel('Email');

    // Only Customer name and Email are mandatory in customers.html; Phone is optional.
    const required = [
      { label: 'Customer name', message: 'Customer name is required', input: nameInput },
      { label: 'Email', message: 'Email is required', input: emailInput },
    ];

    for (const field of required) {
      await nameInput.fill(original.name);
      await emailInput.fill(original.email);
      await field.input.fill('');
      await dialog.getByRole('button', { name: 'Save customer' }).click();

      await expect(dialog.locator(ERROR_SPAN[field.label])).toHaveText(field.message);
      await expect(dialog).toBeVisible();
      await expect(page.getByRole('status').filter({ hasText: 'Customer updated' })).toHaveCount(0);
    }

    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    await expect(firstDataRow(page)).toContainText(original.name);

    await reportAnnotations(page, errors);
  });

  test('BOUNDARY: customer name allows 80 characters, email and phone rules are enforced', async ({ page }) => {
    test.setTimeout(180000);
    const errors = trackErrors(page);

    await gotoCustomers(page);
    const stamp = Date.now();
    const atLimitName = 'A'.repeat(80);
    const newEmail = `user.${stamp}@example.com`;
    const atLimitPhone = '1'.repeat(20);
    test.info().annotations.push({ type: 'test-data', description: `email: ${newEmail}` });

    let dialog = await openEditDialog(page);
    let nameInput = dialog.getByLabel('Customer name');
    let emailInput = dialog.getByLabel('Email');
    let phoneInput = dialog.getByLabel('Phone');

    // Customer name rule: 80 characters max -> 81 is refused
    await nameInput.fill('A'.repeat(81));
    await dialog.getByRole('button', { name: 'Save customer' }).click();
    await expect(dialog.locator(ERROR_SPAN['Customer name'])).toHaveText('Customer name must be 80 characters or fewer');
    await expect(dialog).toBeVisible();

    // exactly 80 characters is accepted and kept as typed
    await nameInput.fill(atLimitName);
    await dialog.getByRole('button', { name: 'Save customer' }).click();
    await expect(dialog).toBeHidden({ timeout: 10000 });
    await expect(page.getByRole('status').filter({ hasText: 'Customer updated' })).toBeVisible({ timeout: 10000 });

    dialog = await openEditDialog(page);
    nameInput = dialog.getByLabel('Customer name');
    emailInput = dialog.getByLabel('Email');
    phoneInput = dialog.getByLabel('Phone');
    await expect(nameInput).toHaveValue(atLimitName);

    // Email rule: must look like user@domain.tld -> 'user@' is refused
    await emailInput.fill('user@');
    await dialog.getByRole('button', { name: 'Save customer' }).click();
    await expect(dialog.locator(ERROR_SPAN['Email'])).toHaveText('Enter a valid email address');
    await expect(dialog).toBeVisible();

    // a well-formed address is accepted and kept
    await emailInput.fill(newEmail);
    await dialog.getByRole('button', { name: 'Save customer' }).click();
    await expect(dialog).toBeHidden({ timeout: 10000 });

    dialog = await openEditDialog(page);
    nameInput = dialog.getByLabel('Customer name');
    emailInput = dialog.getByLabel('Email');
    phoneInput = dialog.getByLabel('Phone');
    await expect(emailInput).toHaveValue(newEmail);
    await expect(nameInput).toHaveValue(atLimitName);

    // Phone rule: 7-20 characters of digits/+/()/-/space -> 21 is refused
    await phoneInput.fill('1'.repeat(21));
    await dialog.getByRole('button', { name: 'Save customer' }).click();
    await expect(dialog.locator(ERROR_SPAN['Phone'])).toHaveText('Enter a valid phone number');
    await expect(dialog).toBeVisible();

    // exactly 20 characters is accepted
    await phoneInput.fill(atLimitPhone);
    await dialog.getByRole('button', { name: 'Save customer' }).click();
    await expect(dialog).toBeHidden({ timeout: 10000 });

    const search = page.getByRole('searchbox', { name: 'Search customers' });
    await search.fill(newEmail);
    const row = page.getByRole('row').filter({ hasText: newEmail });
    await expect(row).toBeVisible({ timeout: 10000 });
    await expect(row).toContainText(atLimitName);
    await expect(row).toContainText(atLimitPhone);

    await reportAnnotations(page, errors);
  });

  test('SECURITY: an unsafe customer name is rendered as inert plain text', async ({ page }) => {
    test.setTimeout(120000);
    const errors = trackErrors(page);
    let alertFired = false;
    page.on('dialog', async (d) => { alertFired = true; await d.dismiss(); });

    await gotoCustomers(page);
    const dialog = await openEditDialog(page);

    const payload = '<script>alert(1)</script>';
    const email = `test.${Date.now()}@example.com`;
    test.info().annotations.push({ type: 'test-data', description: `email: ${email}` });

    await dialog.getByLabel('Customer name').fill(payload);
    await dialog.getByLabel('Email').fill(email);
    await dialog.getByRole('button', { name: 'Save customer' }).click();
    await expect(dialog).toBeHidden({ timeout: 10000 });

    const search = page.getByRole('searchbox', { name: 'Search customers' });
    await search.fill(email);
    const row = page.getByRole('row').filter({ hasText: email });
    await expect(row).toBeVisible({ timeout: 10000 });

    // rendered as literal text, no injected markup, no script execution
    await expect(row.getByRole('cell').first()).toHaveText(payload);
    await expect(row.locator('script')).toHaveCount(0);
    expect(alertFired).toBe(false);

    await reportAnnotations(page, errors);
  });

  test('STATE: empty customer list shows its empty-state message', async ({ page }) => {
    test.setTimeout(120000);
    const errors = trackErrors(page);

    await page.addInitScript(() => {
      window.localStorage.setItem('stockpilot_v1_customers', '[]');
    });
    await page.goto('customers.html', { waitUntil: 'domcontentloaded' });

    await expect(page.getByRole('heading', { name: 'Customers', level: 1 })).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('cell', { name: 'No customers found' })).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('button', { name: /^[\s\uE000-\uF8FF]*Edit[\s\uE000-\uF8FF]*$/ })).toHaveCount(0);

    await reportAnnotations(page, errors);
  });
});

test.describe('Customers page requires a session', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('SECURITY: opening Customers while signed out shows the sign-in form', async ({ page }) => {
    test.setTimeout(120000);
    const errors = trackErrors(page);

    await page.goto('customers.html', { waitUntil: 'domcontentloaded' });
    await page.waitForURL(/login\.html/, { timeout: 15000 });

    await expect(page.getByRole('heading', { name: 'StockPilot', level: 1 })).toBeVisible({ timeout: 15000 });
    await expect(page.getByLabel('Email')).toBeVisible();
    await expect(page.locator('input[name="password"]')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
    await expect(page.getByRole('table')).toHaveCount(0);

    await reportAnnotations(page, errors);
  });
});