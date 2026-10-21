import { test, expect, Page, Locator } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Real messages read from customers.html (form submit handler)
const NAME_REQUIRED = 'Customer name is required';
const NAME_TOO_LONG = 'Customer name must be 80 characters or fewer';
const EMAIL_REQUIRED = 'Email is required';
const EMAIL_INVALID = 'Enter a valid email address';
const PHONE_INVALID = 'Enter a valid phone number';

function attachConsoleMonitors(page: Page): string[] {
  const consoleErrors: string[] = [];
  page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', err => consoleErrors.push(err.message));
  page.on('requestfailed', req => consoleErrors.push(`${req.method()} ${req.url()} failed: ${req.failure()?.errorText}`));
  page.on('response', res => { if (res.status() >= 400) consoleErrors.push(`${res.status()} ${res.request().method()} ${res.url()}`); });
  return consoleErrors;
}

function reportConsoleErrors(consoleErrors: string[]) {
  if (consoleErrors.length) {
    test.info().annotations.push({ type: 'console-errors', description: consoleErrors.slice(0, 5).join(' | ') });
  }
}

async function scanAccessibility(page: Page) {
  const axeResults = await new AxeBuilder({ page }).setLegacyMode().analyze();
  if (axeResults.violations.length) {
    test.info().annotations.push({
      type: 'a11y-violations',
      description: axeResults.violations.map(v => `${v.id}: ${v.help}`).join(' | '),
    });
  }
}

/** Opens the 'Add customer' dialog from the 'Add Customer' button and verifies it really opened. */
async function openAddCustomerDialog(page: Page): Promise<Locator> {
  const addButton = page.getByRole('button', { name: 'Add Customer' });
  const dialog = page.getByRole('dialog');
  await expect(async () => {
    await addButton.click();
    await expect(dialog.getByRole('heading', { name: 'Add customer' })).toBeVisible({ timeout: 3000 });
  }).toPass({ timeout: 20000 });
  return dialog;
}

async function fillCustomerForm(dialog: Locator, values: { name: string; email: string; phone?: string }) {
  await dialog.getByRole('textbox', { name: 'Customer name' }).fill(values.name);
  await dialog.getByRole('textbox', { name: 'Email' }).fill(values.email);
  if (values.phone !== undefined) {
    await dialog.getByRole('textbox', { name: 'Phone' }).fill(values.phone);
  }
}

test.describe('Add a new customer', () => {
  test('POSITIVE: adding a customer with valid name, email and phone saves it and shows it in the customers table', async ({ page }) => {
    test.setTimeout(120000);
    const consoleErrors = attachConsoleMonitors(page);

    const stamp = Date.now();
    const customerName = `QA Co ${stamp}`;
    const email = `test.${stamp}@example.com`;
    const phone = '+1 555 0100';
    test.info().annotations.push({ type: 'test-data', description: `name: ${customerName}, email: ${email}, phone: ${phone}` });

    await page.goto('dashboard.html', { waitUntil: 'domcontentloaded' });
    await page.getByRole('link', { name: 'Customers' }).click();
    await expect(page.getByRole('heading', { name: 'Customers', level: 1 })).toBeVisible({ timeout: 15000 });
    await expect(page).toHaveURL(/customers\.html/);

    const dialog = await openAddCustomerDialog(page);
    await fillCustomerForm(dialog, { name: customerName, email, phone });
    await dialog.getByRole('button', { name: 'Save customer' }).click();

    // Confirmation toast (SP.toast('Customer added') -> #toast-region .toast)
    await expect(page.locator('#toast-region .toast').first()).toHaveText(/Customer added/, { timeout: 5000 });
    await expect(page.getByRole('dialog')).toBeHidden({ timeout: 10000 });

    await expect(page.getByRole('main')).toMatchAriaSnapshot(`
      - heading "Customers"
      - button "Add Customer"
      - searchbox "Search customers"
    `);

    // Independent proof of persistence: reload and find the record again through the list's own search
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Customers', level: 1 })).toBeVisible({ timeout: 15000 });
    await page.getByRole('searchbox', { name: 'Search customers' }).fill(customerName);
    const row = page.getByRole('row').filter({ hasText: customerName });
    await expect(row).toBeVisible({ timeout: 10000 });
    await expect(row).toContainText(email);
    await expect(row).toContainText(phone);

    await scanAccessibility(page);
    reportConsoleErrors(consoleErrors);
  });

  test('NEGATIVE: saving a customer with an invalid email is rejected with a validation message and nothing is saved', async ({ page }) => {
    test.setTimeout(120000);
    const consoleErrors = attachConsoleMonitors(page);

    const stamp = Date.now();
    const customerName = `QA Neg ${stamp}`;
    test.info().annotations.push({ type: 'test-data', description: `name: ${customerName}, invalid email: user@` });

    await page.goto('customers.html', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Customers', level: 1 })).toBeVisible({ timeout: 15000 });

    const dialog = await openAddCustomerDialog(page);
    await fillCustomerForm(dialog, { name: customerName, email: 'user@', phone: '' });
    await dialog.getByRole('button', { name: 'Save customer' }).click();

    await expect(dialog.getByText(EMAIL_INVALID, { exact: true })).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.locator('#toast-region .toast')).toHaveCount(0);

    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(page.getByRole('row').filter({ hasText: customerName })).toHaveCount(0);

    await scanAccessibility(page);
    reportConsoleErrors(consoleErrors);
  });

  test('VALIDATION: each required field (Customer name, Email) shows its own required message when left empty', async ({ page }) => {
    test.setTimeout(120000);
    const consoleErrors = attachConsoleMonitors(page);

    const stamp = Date.now();
    const customerName = `QA Required ${stamp}`;
    const email = `test.${stamp}@example.com`;
    test.info().annotations.push({ type: 'test-data', description: `name: ${customerName}, email: ${email}` });

    await page.goto('customers.html', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Customers', level: 1 })).toBeVisible({ timeout: 15000 });

    const dialog = await openAddCustomerDialog(page);
    const saveButton = dialog.getByRole('button', { name: 'Save customer' });
    // Button-state reality: the save button is not disabled with empty required fields
    await expect(saveButton).toBeEnabled();

    // Only 'Customer name' and 'Email' are mandatory (phone is validated only when filled)
    const requiredFields = [
      { label: 'Customer name', message: NAME_REQUIRED },
      { label: 'Email', message: EMAIL_REQUIRED },
    ];

    for (const field of requiredFields) {
      await fillCustomerForm(dialog, { name: customerName, email, phone: '+1 555 0100' });
      const target = dialog.getByRole('textbox', { name: field.label });
      await target.fill('');
      await expect(target).toHaveValue('');

      await saveButton.click();

      await expect(dialog.getByText(field.message, { exact: true })).toBeVisible({ timeout: 5000 });
      await expect(page.getByRole('dialog')).toBeVisible();
    }

    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(page.getByRole('row').filter({ hasText: customerName })).toHaveCount(0);

    await scanAccessibility(page);
    reportConsoleErrors(consoleErrors);
  });

  test('BOUNDARY: customer name allows 80 characters (81 rejected), email needs a 2+ character TLD, phone allows 7 to 20 characters', async ({ page }) => {
    test.setTimeout(180000);
    const consoleErrors = attachConsoleMonitors(page);

    await page.goto('customers.html', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Customers', level: 1 })).toBeVisible({ timeout: 15000 });

    // --- Customer name: rule is name.length <= 80 (else 'Customer name must be 80 characters or fewer') ---
    const name80 = 'N' + 'a'.repeat(79);
    expect(name80).toHaveLength(80);
    test.info().annotations.push({ type: 'test-data', description: `name at limit: ${name80.length} chars` });

    let dialog = await openAddCustomerDialog(page);
    await fillCustomerForm(dialog, { name: name80, email: `test.${Date.now()}@example.com` });
    await dialog.getByRole('button', { name: 'Save customer' }).click();
    await expect(page.getByRole('dialog')).toBeHidden({ timeout: 10000 });
    await expect(page.getByRole('row').filter({ hasText: name80 })).toBeVisible({ timeout: 10000 });

    const name81 = 'N' + 'a'.repeat(80);
    expect(name81).toHaveLength(81);
    dialog = await openAddCustomerDialog(page);
    await fillCustomerForm(dialog, { name: name81, email: `test.${Date.now()}@example.com` });
    await dialog.getByRole('button', { name: 'Save customer' }).click();
    await expect(dialog.getByText(NAME_TOO_LONG, { exact: true })).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole('dialog')).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('dialog')).toBeHidden();

    // --- Email: rule is /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i -> TLD must be at least 2 characters ---
    const emailAtLimit = `qa${Date.now()}@example.co`;
    dialog = await openAddCustomerDialog(page);
    await fillCustomerForm(dialog, { name: `QA Email Co ${Date.now()}`, email: emailAtLimit });
    await dialog.getByRole('button', { name: 'Save customer' }).click();
    await expect(page.getByRole('dialog')).toBeHidden({ timeout: 10000 });
    await expect(page.getByRole('row').filter({ hasText: emailAtLimit })).toBeVisible({ timeout: 10000 });

    const emailPastLimit = `qa${Date.now()}@example.c`;
    dialog = await openAddCustomerDialog(page);
    await fillCustomerForm(dialog, { name: `QA Email C ${Date.now()}`, email: emailPastLimit });
    await dialog.getByRole('button', { name: 'Save customer' }).click();
    await expect(dialog.getByText(EMAIL_INVALID, { exact: true })).toBeVisible({ timeout: 5000 });
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('dialog')).toBeHidden();

    // --- Phone (optional): rule is /^[0-9+()\-\s]{7,20}$/ -> 7..20 characters ---
    const phone20 = '+1' + '2'.repeat(18);
    expect(phone20).toHaveLength(20);
    const nameForPhone = `QA Phone ${Date.now()}`;
    dialog = await openAddCustomerDialog(page);
    await fillCustomerForm(dialog, { name: nameForPhone, email: `test.${Date.now()}@example.com`, phone: phone20 });
    await dialog.getByRole('button', { name: 'Save customer' }).click();
    await expect(page.getByRole('dialog')).toBeHidden({ timeout: 10000 });
    const phoneRow = page.getByRole('row').filter({ hasText: nameForPhone });
    await expect(phoneRow).toBeVisible({ timeout: 10000 });
    await expect(phoneRow).toContainText(phone20);

    const phone21 = '+1' + '2'.repeat(19);
    expect(phone21).toHaveLength(21);
    dialog = await openAddCustomerDialog(page);
    await fillCustomerForm(dialog, { name: `QA Phone Long ${Date.now()}`, email: `test.${Date.now()}@example.com`, phone: phone21 });
    await dialog.getByRole('button', { name: 'Save customer' }).click();
    await expect(dialog.getByText(PHONE_INVALID, { exact: true })).toBeVisible({ timeout: 5000 });
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('dialog')).toBeHidden();

    const phoneTooShort = '123456';
    expect(phoneTooShort).toHaveLength(6);
    dialog = await openAddCustomerDialog(page);
    await fillCustomerForm(dialog, { name: `QA Phone Short ${Date.now()}`, email: `test.${Date.now()}@example.com`, phone: phoneTooShort });
    await dialog.getByRole('button', { name: 'Save customer' }).click();
    await expect(dialog.getByText(PHONE_INVALID, { exact: true })).toBeVisible({ timeout: 5000 });
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('dialog')).toBeHidden();

    await scanAccessibility(page);
    reportConsoleErrors(consoleErrors);
  });

  test('SECURITY: a script tag entered as the customer name renders as inert plain text', async ({ page }) => {
    test.setTimeout(120000);
    const consoleErrors = attachConsoleMonitors(page);

    let alertFired = false;
    page.on('dialog', async d => { alertFired = true; await d.dismiss(); });

    const unsafeName = '<script>alert(1)</script>';
    const email = `test.${Date.now()}@example.com`;
    test.info().annotations.push({ type: 'test-data', description: `unsafe name: ${unsafeName}, email: ${email}` });

    await page.goto('customers.html', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Customers', level: 1 })).toBeVisible({ timeout: 15000 });

    const dialog = await openAddCustomerDialog(page);
    await fillCustomerForm(dialog, { name: unsafeName, email });
    await dialog.getByRole('button', { name: 'Save customer' }).click();
    await expect(page.getByRole('dialog')).toBeHidden({ timeout: 10000 });

    const row = page.getByRole('row').filter({ hasText: unsafeName });
    await expect(row).toBeVisible({ timeout: 10000 });
    await expect(row).toContainText(unsafeName);
    await expect(page.locator('#customer-table tbody script')).toHaveCount(0);
    expect(alertFired).toBe(false);

    await scanAccessibility(page);
    reportConsoleErrors(consoleErrors);
  });
});

test.describe('customers page without a session', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('SECURITY: the Customers page cannot be opened without a session and shows the sign-in form', async ({ page }) => {
    test.setTimeout(60000);
    const consoleErrors = attachConsoleMonitors(page);

    await page.goto('customers.html', { waitUntil: 'domcontentloaded' });
    await page.waitForURL(/login\.html/, { timeout: 15000 });

    await expect(page.locator('#login-email')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('#login-password')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Customers', level: 1 })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Add Customer' })).toHaveCount(0);

    await scanAccessibility(page);
    reportConsoleErrors(consoleErrors);
  });
});