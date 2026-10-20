import { test, expect, type Locator, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/** Seeded product with plenty of stock, so add -> remove -> low stock can all be exercised. */
const PREFERRED_PRODUCT = 'Mechanical Keyboard';
const STOCK_COLUMN = 3;
const STATUS_COLUMN = 4;

function attachDiagnostics(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', err => errors.push(err.message));
  page.on('requestfailed', req => errors.push(`${req.method()} ${req.url()} failed: ${req.failure()?.errorText}`));
  page.on('response', res => { if (res.status() >= 400) errors.push(`${res.status()} ${res.request().method()} ${res.url()}`); });
  return errors;
}

function reportDiagnostics(errors: string[]) {
  if (errors.length) test.info().annotations.push({ type: 'console-errors', description: errors.slice(0, 5).join(' | ') });
}

async function scanA11y(page: Page) {
  const axeResults = await new AxeBuilder({ page }).setLegacyMode().analyze();
  if (axeResults.violations.length) {
    test.info().annotations.push({
      type: 'a11y-violations',
      description: axeResults.violations.map(v => `${v.id}: ${v.help}`).join(' | '),
    });
  }
}

/** Picks the seeded product row to adjust, falling back to the first row of the table. */
async function pickTargetProduct(page: Page): Promise<string> {
  const rows = page.locator('#product-table tbody tr');
  await expect(rows.first()).toBeVisible({ timeout: 15000 });
  const preferred = rows.filter({ hasText: PREFERRED_PRODUCT });
  if ((await preferred.count()) > 0) return PREFERRED_PRODUCT;
  return (await rows.first().getByRole('cell').first().innerText()).trim();
}

async function readRow(page: Page, targetName: string) {
  const row = page.getByRole('row').filter({ hasText: targetName }).first();
  await expect(row).toBeVisible({ timeout: 15000 });
  const name = (await row.getByRole('cell').nth(0).innerText()).trim();
  const sku = (await row.getByRole('cell').nth(1).innerText()).trim();
  const stock = Number((await row.getByRole('cell').nth(STOCK_COLUMN).innerText()).replace(/[^0-9-]/g, ''));
  return { row, name, sku, stock };
}

/** Opens the 'Adjust stock' dialog for a product row and waits until it is really on screen. */
async function openAdjustStock(page: Page, targetName: string) {
  const dialog = page.locator('#adjust-dialog');
  const row = page.getByRole('row').filter({ hasText: targetName }).first();
  await expect(row).toBeVisible({ timeout: 15000 });
  const openButton = row.getByRole('button', { name: 'Adjust stock' });
  await expect(async () => {
    await openButton.click();
    await expect(dialog).toBeVisible({ timeout: 3000 });
  }).toPass({ timeout: 20000 });
  await expect(dialog.getByRole('heading', { name: 'Adjust stock' })).toBeVisible({ timeout: 10000 });
  return { row, dialog };
}

test('POSITIVE: adding stock updates the product Stock value shown in the products table', async ({ page }) => {
  test.setTimeout(120000);
  const consoleErrors = attachDiagnostics(page);

  await page.goto('products.html', { waitUntil: 'domcontentloaded' });
  const target = await pickTargetProduct(page);
  const before = await readRow(page, target);

  const { dialog } = await openAdjustStock(page, target);
  await expect(dialog.locator('#adjust-summary')).toHaveText(`${before.name} (${before.sku}) - ${before.stock} in stock`);
  await expect(dialog).toMatchAriaSnapshot(`
  - heading "Adjust stock" [level=2]
  - paragraph: /in stock/
`);

  const change = dialog.getByRole('combobox', { name: 'Change' });
  await expect(change).toHaveValue('add');
  await expect(change.locator('option')).toHaveText(['Add stock', 'Remove stock']);

  const addQty = 5;
  const afterAdd = before.stock + addQty;
  await dialog.getByRole('spinbutton', { name: 'Quantity' }).fill(String(addQty));
  await dialog.getByRole('combobox', { name: 'Reason' }).selectOption('Received shipment');
  await dialog.getByRole('button', { name: 'Update stock' }).click();

  await expect(dialog).toBeHidden({ timeout: 15000 });
  await expect(page.locator('#toast-region .toast-ok').last()).toHaveText('Stock updated', { timeout: 10000 });
  await expect(before.row.getByRole('cell').nth(STOCK_COLUMN)).toHaveText(String(afterAdd), { timeout: 15000 });

  // Independent proof the change persisted: reload and look at the table again.
  await page.reload({ waitUntil: 'domcontentloaded' });
  const persisted = await readRow(page, before.sku);
  await expect(persisted.row.getByRole('cell').nth(STOCK_COLUMN)).toHaveText(String(afterAdd), { timeout: 15000 });

  // Now remove stock again until the product drops to its reorder level.
  const removeQty = afterAdd - 1;
  const second = await openAdjustStock(page, before.sku);
  await expect(second.dialog.locator('#adjust-summary')).toContainText(`${afterAdd} in stock`);
  await second.dialog.getByRole('combobox', { name: 'Change' }).selectOption('remove');
  await second.dialog.getByRole('spinbutton', { name: 'Quantity' }).fill(String(removeQty));
  await second.dialog.getByRole('combobox', { name: 'Reason' }).selectOption('Stock count correction');
  await second.dialog.getByRole('button', { name: 'Update stock' }).click();

  await expect(second.dialog).toBeHidden({ timeout: 15000 });
  await expect(page.locator('#toast-region .toast-ok').last()).toHaveText('Stock updated', { timeout: 10000 });
  await expect(second.row.getByRole('cell').nth(STOCK_COLUMN)).toHaveText('1', { timeout: 15000 });
  await expect(second.row.getByRole('cell').nth(STATUS_COLUMN)).toContainText('Low stock', { timeout: 15000 });

  await scanA11y(page);
  reportDiagnostics(consoleErrors);
});

test('NEGATIVE: submitting the Adjust stock dialog without a quantity is rejected and nothing changes', async ({ page }) => {
  test.setTimeout(120000);
  const consoleErrors = attachDiagnostics(page);

  await page.goto('products.html', { waitUntil: 'domcontentloaded' });
  const target = await pickTargetProduct(page);
  const before = await readRow(page, target);

  const { row, dialog } = await openAdjustStock(page, target);
  await dialog.getByRole('spinbutton', { name: 'Quantity' }).fill('');
  await dialog.getByRole('combobox', { name: 'Reason' }).selectOption('Received shipment');
  await dialog.getByRole('button', { name: 'Update stock' }).click();

  await expect(dialog.locator('#adjust-error')).toHaveText('Quantity must be a whole number of 1 or more');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('spinbutton', { name: 'Quantity' })).toHaveValue('');
  await expect(page.locator('#toast-region .toast')).toHaveCount(0);
  await expect(row.getByRole('cell').nth(STOCK_COLUMN)).toHaveText(String(before.stock));

  await scanA11y(page);
  reportDiagnostics(consoleErrors);
});

test('VALIDATION: every mandatory Adjust stock field shows its own required message', async ({ page }) => {
  test.setTimeout(120000);
  const consoleErrors = attachDiagnostics(page);

  await page.goto('products.html', { waitUntil: 'domcontentloaded' });
  const target = await pickTargetProduct(page);
  const before = await readRow(page, target);

  const cases = [
    {
      field: 'Quantity',
      message: 'Quantity must be a whole number of 1 or more',
      clear: async (dialog: Locator) => { await dialog.getByRole('spinbutton', { name: 'Quantity' }).fill(''); },
    },
    {
      field: 'Reason',
      message: 'Select a reason',
      clear: async (dialog: Locator) => { await dialog.getByRole('combobox', { name: 'Reason' }).selectOption(''); },
    },
  ];

  for (const testCase of cases) {
    const { row, dialog } = await openAdjustStock(page, target);
    // Valid values everywhere, then empty only the field under test.
    await dialog.getByRole('spinbutton', { name: 'Quantity' }).fill('3');
    await dialog.getByRole('combobox', { name: 'Reason' }).selectOption('Received shipment');
    await testCase.clear(dialog);
    await dialog.getByRole('button', { name: 'Update stock' }).click();

    await expect(dialog.locator('#adjust-error'), `expected the ${testCase.field} message`).toHaveText(testCase.message);
    await expect(dialog).toBeVisible();
    await expect(page.locator('#toast-region .toast')).toHaveCount(0);
    await expect(row.getByRole('cell').nth(STOCK_COLUMN)).toHaveText(String(before.stock));

    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
  }

  await scanA11y(page);
  reportDiagnostics(consoleErrors);
});

test('BOUNDARY: Quantity accepts whole numbers 1 to 100000 and total stock cannot exceed 100000', async ({ page }) => {
  test.setTimeout(120000);
  const consoleErrors = attachDiagnostics(page);

  await page.goto('products.html', { waitUntil: 'domcontentloaded' });
  const target = await pickTargetProduct(page);
  const before = await readRow(page, target);

  const { row, dialog } = await openAdjustStock(page, target);
  const qty = dialog.getByRole('spinbutton', { name: 'Quantity' });
  const error = dialog.locator('#adjust-error');
  const update = dialog.getByRole('button', { name: 'Update stock' });
  await dialog.getByRole('combobox', { name: 'Reason' }).selectOption('Received shipment');

  // Rule 'quantity is a whole number of 1 or more': one below the minimum.
  await qty.fill('0');
  await update.click();
  await expect(error).toHaveText('Quantity must be a whole number of 1 or more');

  // Rule 'total stock cannot exceed 100,000': 100000 is the field maximum but busts the stock cap.
  await qty.fill('100000');
  await update.click();
  await expect(error).toHaveText('Stock cannot exceed 100,000');

  // One past the maximum of 100000.
  await qty.fill('100001');
  await update.click();
  await expect(error).toHaveText('Quantity must be a whole number of 1 or more');

  // Negative numbers are not whole numbers of 1 or more.
  await qty.fill('-5');
  await update.click();
  await expect(error).toHaveText('Quantity must be a whole number of 1 or more');

  await expect(dialog).toBeVisible();
  await expect(row.getByRole('cell').nth(STOCK_COLUMN)).toHaveText(String(before.stock));

  // The lowest accepted whole number.
  await qty.fill('1');
  await update.click();
  await expect(dialog).toBeHidden({ timeout: 15000 });
  await expect(row.getByRole('cell').nth(STOCK_COLUMN)).toHaveText(String(before.stock + 1), { timeout: 15000 });

  await scanA11y(page);
  reportDiagnostics(consoleErrors);
});

test.describe('signed out', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('SECURITY: the products page (and its stock adjustment) cannot be reached without a session', async ({ page }) => {
    test.setTimeout(60000);
    const consoleErrors = attachDiagnostics(page);

    await page.goto('products.html', { waitUntil: 'domcontentloaded' });

    await expect(page).toHaveURL(/login\.html/, { timeout: 15000 });
    await expect(page.locator('input[type="email"]')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('input[type="password"]')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Products' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Adjust stock' })).toHaveCount(0);

    await scanA11y(page);
    reportDiagnostics(consoleErrors);
  });
});