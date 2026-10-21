import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const CUSTOMER_ROWS = '#customer-table tbody tr';
const TOASTS = '#toast-region .toast';

/** Collects console / page / network problems so a human can see them as an annotation. */
function attachDiagnostics(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('requestfailed', (req) => errors.push(`${req.method()} ${req.url()} failed: ${req.failure()?.errorText}`));
  page.on('response', (res) => { if (res.status() >= 400) errors.push(`${res.status()} ${res.request().method()} ${res.url()}`); });
  return errors;
}

/** Non-blocking console-error + accessibility report (never fails the test). */
async function report(page: Page, errors: string[]): Promise<void> {
  if (errors.length) {
    test.info().annotations.push({ type: 'console-errors', description: errors.slice(0, 5).join(' | ') });
  }
  const axeResults = await new AxeBuilder({ page }).setLegacyMode().analyze();
  if (axeResults.violations.length) {
    test.info().annotations.push({
      type: 'a11y-violations',
      description: axeResults.violations.map((v) => `${v.id}: ${v.help}`).join(' | '),
    });
  }
}

async function openCustomersPage(page: Page): Promise<void> {
  await page.goto('customers.html', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Customers', level: 1 })).toBeVisible({ timeout: 15000 });
  await expect(page.locator(CUSTOMER_ROWS).first()).toBeVisible({ timeout: 15000 });
}

async function openAddCustomerDialog(page: Page) {
  const dialog = page.getByRole('dialog', { name: 'Add customer' });
  await expect(async () => {
    await page.getByRole('button', { name: /^[\s\uE000-\uF8FF]*Add\ Customer[\s\uE000-\uF8FF]*$/ }).click();
    await expect(dialog).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 15000 });
  return dialog;
}

async function addCustomer(page: Page, data: { name: string; email: string; phone?: string }): Promise<void> {
  const dialog = await openAddCustomerDialog(page);
  await dialog.getByLabel('Customer name').fill(data.name);
  await dialog.getByLabel('Email').fill(data.email);
  if (data.phone !== undefined) await dialog.getByLabel('Phone').fill(data.phone);
  await dialog.getByRole('button', { name: 'Save customer' }).click();
  await expect(dialog).toBeHidden({ timeout: 10000 });
}

test.describe('Delete a customer', () => {
  test('POSITIVE: Delete a customer with no orders and confirm the dialog', async ({ page }) => {
    test.setTimeout(120000);
    const errors = attachDiagnostics(page);

    const stamp = Date.now();
    const customerName = `QA Delete ${stamp}`;
    const customerEmail = `qa.delete.${stamp}@example.com`;
    test.info().annotations.push({ type: 'test-data', description: `customerName: ${customerName} | customerEmail: ${customerEmail}` });

    await openCustomersPage(page);

    // Prerequisite of this journey: a brand-new customer, which therefore has 0 orders.
    await addCustomer(page, { name: customerName, email: customerEmail, phone: '+1 555 0999' });
    await expect(page.locator(TOASTS).filter({ hasText: 'Customer added' }).first()).toBeVisible({ timeout: 10000 });

    const row = page.getByRole('row').filter({ hasText: customerName });
    await expect(row).toBeVisible({ timeout: 10000 });
    await expect(row.getByRole('cell').nth(3)).toHaveText('0'); // Orders column

    // Use the per-row Delete action.
    await row.getByRole('button', { name: 'Delete' }).click();

    const confirm = page.getByRole('dialog', { name: 'Please confirm' });
    await expect(confirm).toBeVisible({ timeout: 10000 });
    await expect(confirm).toContainText(`Delete customer "${customerName}"?`);

    await confirm.getByRole('button', { name: /^[\s\uE000-\uF8FF]*Delete[\s\uE000-\uF8FF]*$/ }).click();
    await expect(confirm).toBeHidden({ timeout: 10000 });

    await expect(page.locator(TOASTS).filter({ hasText: 'Customer deleted' }).first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('row').filter({ hasText: customerName })).toHaveCount(0);

    await expect(page.getByRole('main')).toMatchAriaSnapshot(`
      - heading "Customers" [level=1]
      - button "Add Customer"
      - searchbox "Search customers"
    `);

    // Independent proof the record is really gone.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator(CUSTOMER_ROWS).first()).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('row').filter({ hasText: customerName })).toHaveCount(0);

    await report(page, errors);
  });

  test('NEGATIVE: Deleting a customer that already has orders is blocked', async ({ page }) => {
    test.setTimeout(120000);
    const errors = attachDiagnostics(page);

    await openCustomersPage(page);

    // Pick a customer whose Orders count is greater than zero (seeded demo data has such rows).
    const rows = page.locator(CUSTOMER_ROWS);
    const rowCount = await rows.count();
    let targetName = '';
    let found = false;
    for (let i = 0; i < rowCount; i++) {
      const candidate = rows.nth(i);
      const orderCount = Number((await candidate.getByRole('cell').nth(3).innerText()).trim());
      if (orderCount > 0) {
        targetName = (await candidate.getByRole('cell').nth(0).innerText()).trim();
        found = true;
        break;
      }
    }
    expect(found, 'expected at least one customer with existing orders in the customers table').toBeTruthy();
    test.info().annotations.push({ type: 'test-data', description: `customer with orders: ${targetName}` });

    const row = page.getByRole('row').filter({ hasText: targetName });
    await row.getByRole('button', { name: 'Delete' }).click();

    // The app refuses the delete with an error toast and never opens the confirmation dialog.
    await expect(page.locator(`${TOASTS}.toast-error`).filter({ hasText: 'Cannot delete a customer with orders' }).first())
      .toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('dialog', { name: 'Please confirm' })).toHaveCount(0);
    await expect(page.getByRole('row').filter({ hasText: targetName })).toBeVisible();

    // Nothing was deleted - the record is still there after a reload.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('row').filter({ hasText: targetName })).toBeVisible({ timeout: 15000 });

    await report(page, errors);
  });

  test('VALIDATION: Saving a customer with a missing required field is rejected per field', async ({ page }) => {
    test.setTimeout(120000);
    const errors = attachDiagnostics(page);

    await openCustomersPage(page);

    // Required fields confirmed in customers.html: name ("Customer name is required")
    // and email ("Email is required"). Phone is optional.
    const requiredFields = [
      { label: 'Customer name', message: 'Customer name is required' },
      { label: 'Email', message: 'Email is required' },
    ];

    for (const field of requiredFields) {
      const stamp = Date.now();
      const validName = `QA Req ${stamp}`;
      const validEmail = `qa.req.${stamp}@example.com`;

      const dialog = await openAddCustomerDialog(page);
      // Reality check on the primary action: it stays enabled, validation happens on submit.
      await expect(dialog.getByRole('button', { name: 'Save customer' })).toBeEnabled({ timeout: 5000 });

      await dialog.getByLabel('Customer name').fill(field.label === 'Customer name' ? '' : validName);
      await dialog.getByLabel('Email').fill(field.label === 'Email' ? '' : validEmail);
      await dialog.getByLabel('Phone').fill('+1 555 0123');

      await dialog.getByRole('button', { name: 'Save customer' }).click();

      // The dialog stays open and shows the real message for the field under test.
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole('alert').filter({ hasText: field.message })).toHaveText(field.message);
      await expect(page.getByRole('row').filter({ hasText: validName })).toHaveCount(0);

      await dialog.getByRole('button', { name: 'Cancel' }).click();
      await expect(dialog).toBeHidden();
    }

    // A duplicate email is rejected with its own message.
    const existingEmail = (await page.locator(CUSTOMER_ROWS).first().getByRole('cell').nth(1).innerText()).trim();
    const duplicateDialog = await openAddCustomerDialog(page);
    await duplicateDialog.getByLabel('Customer name').fill(`QA Dup ${Date.now()}`);
    await duplicateDialog.getByLabel('Email').fill(existingEmail);
    await duplicateDialog.getByRole('button', { name: 'Save customer' }).click();
    await expect(duplicateDialog.getByRole('alert').filter({ hasText: 'A customer with this email already exists' }))
      .toHaveText('A customer with this email already exists');
    await duplicateDialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(duplicateDialog).toBeHidden();

    await report(page, errors);
  });

  test('BOUNDARY: Customer name allows 80 characters, phone allows 7-20 characters, email must be valid', async ({ page }) => {
    test.setTimeout(120000);
    const errors = attachDiagnostics(page);

    await openCustomersPage(page);

    // --- Rule 1 (customers.html): name.length > 80 -> "Customer name must be 80 characters or fewer" ---
    const nameAtLimit = `QA80-${'x'.repeat(74)}`; // exactly 80 characters
    expect(nameAtLimit.length).toBe(80);
    const atLimitEmail = `qa.limit.80.${Date.now()}@example.com`;
    await addCustomer(page, { name: nameAtLimit, email: atLimitEmail });
    const savedRow = page.getByRole('row').filter({ hasText: nameAtLimit });
    await expect(savedRow).toBeVisible({ timeout: 10000 });
    await expect(savedRow.getByRole('cell').nth(0)).toHaveText(nameAtLimit);

    const nameOverLimit = `QA81-${'y'.repeat(75)}`; // one past the limit: 81 characters
    expect(nameOverLimit.length).toBe(81);
    const overDialog = await openAddCustomerDialog(page);
    await overDialog.getByLabel('Customer name').fill(nameOverLimit);
    // The input has no maxlength, so the full 81 characters are kept in the field...
    await expect(overDialog.getByLabel('Customer name')).toHaveValue(nameOverLimit);
    await overDialog.getByLabel('Email').fill(`qa.limit.81.${Date.now()}@example.com`);
    await overDialog.getByRole('button', { name: 'Save customer' }).click();
    // ...but the app refuses to save it.
    await expect(overDialog.getByRole('alert').filter({ hasText: 'Customer name must be 80 characters or fewer' }))
      .toHaveText('Customer name must be 80 characters or fewer');
    await expect(page.getByRole('row').filter({ hasText: nameOverLimit })).toHaveCount(0);
    await overDialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(overDialog).toBeHidden();

    // --- Rule 2 (customers.html): PHONE_RE = /^[0-9+()\-\s]{7,20}$/ ---
    const phoneAtLimitName = `QA Phone At Limit ${Date.now()}`;
    await addCustomer(page, { name: phoneAtLimitName, email: `qa.phone.7.${Date.now()}@example.com`, phone: '1234567' }); // exactly 7
    await expect(page.getByRole('row').filter({ hasText: phoneAtLimitName })).toBeVisible({ timeout: 10000 });

    const phoneOverDialog = await openAddCustomerDialog(page);
    await phoneOverDialog.getByLabel('Customer name').fill(`QA Phone Too Short ${Date.now()}`);
    await phoneOverDialog.getByLabel('Email').fill(`qa.phone.6.${Date.now()}@example.com`);
    await phoneOverDialog.getByLabel('Phone').fill('123456'); // one below the minimum: 6 characters
    await phoneOverDialog.getByRole('button', { name: 'Save customer' }).click();
    await expect(phoneOverDialog.getByRole('alert').filter({ hasText: 'Enter a valid phone number' }))
      .toHaveText('Enter a valid phone number');
    await phoneOverDialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(phoneOverDialog).toBeHidden();

    // --- Rule 3: SP.EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i ---
    const badEmailDialog = await openAddCustomerDialog(page);
    await badEmailDialog.getByLabel('Customer name').fill(`QA Bad Email ${Date.now()}`);
    await badEmailDialog.getByLabel('Email').fill('user@');
    await badEmailDialog.getByRole('button', { name: 'Save customer' }).click();
    await expect(badEmailDialog.getByRole('alert').filter({ hasText: 'Enter a valid email address' }))
      .toHaveText('Enter a valid email address');
    await badEmailDialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(badEmailDialog).toBeHidden();

    await report(page, errors);
  });

  test('SECURITY: Script markup in a customer name is stored and rendered as inert text', async ({ page }) => {
    test.setTimeout(120000);
    const errors = attachDiagnostics(page);
    const nativeDialogs: string[] = [];
    page.on('dialog', async (d) => { nativeDialogs.push(d.message()); await d.dismiss(); });

    const payload = '<script>alert(1)</script>';
    const email = `qa.xss.${Date.now()}@example.com`;
    test.info().annotations.push({ type: 'test-data', description: `payload: ${payload} | email: ${email}` });

    await openCustomersPage(page);
    await addCustomer(page, { name: payload, email });

    const row = page.getByRole('row').filter({ hasText: payload });
    await expect(row).toBeVisible({ timeout: 10000 });
    await expect(row.getByRole('cell').nth(0)).toHaveText(payload);

    await page.reload({ waitUntil: 'domcontentloaded' });
    const rowAfterReload = page.getByRole('row').filter({ hasText: payload });
    await expect(rowAfterReload).toBeVisible({ timeout: 15000 });
    await expect(rowAfterReload.getByRole('cell').nth(0)).toHaveText(payload);

    // The markup was escaped, not executed: no injected <script> element and no alert().
    await expect(page.locator('#customer-table tbody script')).toHaveCount(0);
    expect(nativeDialogs).toEqual([]);

    await report(page, errors);
  });

  test('STATE: Customers list shows its own empty-state message and restores rows when the search is cleared', async ({ page }) => {
    const errors = attachDiagnostics(page);
    await openCustomersPage(page);

    const search = page.getByRole('searchbox', { name: 'Search customers' });
    await search.fill(`no-such-customer-${Date.now()}`);

    await expect(page.locator(CUSTOMER_ROWS)).toHaveCount(1);
    await expect(page.locator(CUSTOMER_ROWS).first()).toContainText('No customers found');
    await expect(page.locator(CUSTOMER_ROWS).first().getByRole('button')).toHaveCount(0);

    await search.fill('');
    await expect(page.locator(CUSTOMER_ROWS).filter({ hasText: 'Delete' }).first()).toBeVisible({ timeout: 10000 });

    await report(page, errors);
  });
});

test.describe('SECURITY: customers page requires a session', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('SECURITY: Opening the customers page while signed out shows the sign-in form', async ({ page }) => {
    const errors = attachDiagnostics(page);

    await page.goto('customers.html', { waitUntil: 'domcontentloaded' });
    await page.waitForURL((url) => url.toString().includes('login.html'), { timeout: 15000 });

    await expect(page.getByRole('textbox', { name: 'Email' })).toBeVisible({ timeout: 15000 });
    await expect(page.locator('input[type="password"]')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
    await expect(page.locator('#customer-table')).toHaveCount(0);

    await report(page, errors);
  });
});