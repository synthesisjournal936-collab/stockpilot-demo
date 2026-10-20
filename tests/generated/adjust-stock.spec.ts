import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

function watchErrors(page: Page): string[] {
  const consoleErrors: string[] = [];
  page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', err => consoleErrors.push(err.message));
  page.on('requestfailed', req => consoleErrors.push(`${req.method()} ${req.url()} failed: ${req.failure()?.errorText}`));
  page.on('response', res => { if (res.status() >= 400) consoleErrors.push(`${res.status()} ${res.request().method()} ${res.url()}`); });
  return consoleErrors;
}

async function reportSignals(page: Page, consoleErrors: string[]) {
  const axeResults = await new AxeBuilder({ page }).setLegacyMode().analyze();
  if (axeResults.violations.length) {
    test.info().annotations.push({
      type: 'a11y-violations',
      description: axeResults.violations.map(v => `${v.id}: ${v.help}`).join(' | '),
    });
  }
  if (consoleErrors.length) test.info().annotations.push({ type: 'console-errors', description: consoleErrors.slice(0, 5).join(' | ') });
}

async function openProducts(page: Page) {
  await page.goto('products.html', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Products', level: 1 })).toBeVisible({ timeout: 15000 });
}

function firstRow(page: Page) {
  return page.locator('#product-table tbody tr[data-id]').first();
}

async function readFirstProduct(page: Page) {
  const row = firstRow(page);
  await expect(row).toBeVisible({ timeout: 15000 });
  const name = (await row.locator('td').nth(0).innerText()).trim();
  const sku = (await row.locator('td').nth(1).innerText()).trim();
  const before = Number((await row.locator('td').nth(3).innerText()).trim());
  return { name, sku, before };
}

async function openAdjustDialog(page: Page) {
  await firstRow(page).getByRole('button', { name: /^[\s\uE000-\uF8FF]*Adjust\ stock[\s\uE000-\uF8FF]*$/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Adjust stock' });
  await expect(dialog).toBeVisible({ timeout: 5000 });
  return dialog;
}

async function reloadAndFindRow(page: Page, sku: string) {
  await page.reload({ waitUntil: 'domcontentloaded' });
  const row = page.getByRole('row').filter({ hasText: sku });
  await expect(row).toBeVisible({ timeout: 10000 });
  return row;
}

test('POSITIVE: adding stock with a reason updates the product stock', async ({ page }) => {
  test.setTimeout(120000);
  const consoleErrors = watchErrors(page);
  await openProducts(page);
  const { name, sku, before } = await readFirstProduct(page);
  const qty = 3;
  test.info().annotations.push({ type: 'test-data', description: `product: ${name} (${sku}), stock before: ${before}, adding: ${qty}` });
  const dialog = await openAdjustDialog(page);
  await expect(dialog).toContainText(name);
  await expect(dialog).toContainText(sku);
  await expect(dialog).toContainText(`${before} in stock`);
  await dialog.getByLabel('Change', { exact: true }).selectOption('add');
  await dialog.getByLabel('Quantity', { exact: true }).fill(String(qty));
  await dialog.getByLabel('Reason', { exact: true }).selectOption('Received shipment');
  await dialog.getByRole('button', { name: /^[\s\uE000-\uF8FF]*Update\ stock[\s\uE000-\uF8FF]*$/ }).click();
  await expect(dialog).toBeHidden({ timeout: 5000 });
  await expect(page.getByText('Stock updated', { exact: true }).first()).toBeVisible({ timeout: 5000 });
  const row = await reloadAndFindRow(page, sku);
  await expect(row).toContainText(name);
  await expect(row.getByRole('cell').nth(3)).toHaveText(String(before + qty));
  await expect(page.getByRole('main')).toMatchAriaSnapshot(`
  - heading "Products"
`);
  await reportSignals(page, consoleErrors);
});

test('NEGATIVE: removing more stock than is on hand is rejected and nothing is saved', async ({ page }) => {
  const consoleErrors = watchErrors(page);
  await openProducts(page);
  const { sku, before } = await readFirstProduct(page);
  const dialog = await openAdjustDialog(page);
  await dialog.getByLabel('Change', { exact: true }).selectOption('remove');
  await dialog.getByLabel('Quantity', { exact: true }).fill(String(before + 1));
  await dialog.getByLabel('Reason', { exact: true }).selectOption('Damaged');
  await dialog.getByRole('button', { name: /^[\s\uE000-\uF8FF]*Update\ stock[\s\uE000-\uF8FF]*$/ }).click();
  await expect(dialog.getByRole('alert')).toHaveText(`Cannot remove more than the current stock (${before})`);
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: /^[\s\uE000-\uF8FF]*Cancel[\s\uE000-\uF8FF]*$/ }).click();
  await expect(dialog).toBeHidden();
  const row = await reloadAndFindRow(page, sku);
  await expect(row.getByRole('cell').nth(3)).toHaveText(String(before));
  await reportSignals(page, consoleErrors);
});

test('VALIDATION: quantity and reason are each required and block the save', async ({ page }) => {
  const consoleErrors = watchErrors(page);
  await openProducts(page);
  const { sku, before } = await readFirstProduct(page);
  const dialog = await openAdjustDialog(page);
  await dialog.getByLabel('Change', { exact: true }).selectOption('add');
  const qty = dialog.getByLabel('Quantity', { exact: true });
  const reason = dialog.getByLabel('Reason', { exact: true });
  const submit = dialog.getByRole('button', { name: /^[\s\uE000-\uF8FF]*Update\ stock[\s\uE000-\uF8FF]*$/ });
  // Quantity missing, reason valid
  await qty.fill('');
  await reason.selectOption('Damaged');
  await submit.click();
  await expect(dialog.getByRole('alert')).toHaveText('Quantity must be a whole number of 1 or more');
  await expect(dialog).toBeVisible();
  // Quantity valid, reason missing
  await qty.fill('2');
  await reason.selectOption({ value: '' });
  await submit.click();
  await expect(dialog.getByRole('alert')).toHaveText('Select a reason');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: /^[\s\uE000-\uF8FF]*Cancel[\s\uE000-\uF8FF]*$/ }).click();
  await expect(dialog).toBeHidden();
  const row = await reloadAndFindRow(page, sku);
  await expect(row.getByRole('cell').nth(3)).toHaveText(String(before));
  await reportSignals(page, consoleErrors);
});

test('BOUNDARY: quantity accepts whole numbers 1 to 100000 and total stock cannot exceed 100,000', async ({ page }) => {
  test.setTimeout(120000);
  const consoleErrors = watchErrors(page);
  await openProducts(page);
  const { sku, before } = await readFirstProduct(page);
  expect(before).toBeGreaterThan(0);
  test.info().annotations.push({ type: 'test-data', description: `sku: ${sku}, stock before: ${before}` });
  const dialog = await openAdjustDialog(page);
  await dialog.getByLabel('Change', { exact: true }).selectOption('add');
  await dialog.getByLabel('Reason', { exact: true }).selectOption('Damaged');
  const qty = dialog.getByLabel('Quantity', { exact: true });
  const submit = dialog.getByRole('button', { name: /^[\s\uE000-\uF8FF]*Update\ stock[\s\uE000-\uF8FF]*$/ });
  // One step below the lower limit (1)
  await qty.fill('0');
  await submit.click();
  await expect(dialog.getByRole('alert')).toHaveText('Quantity must be a whole number of 1 or more');
  await expect(dialog).toBeVisible();
  // One step above the upper limit (100000)
  await qty.fill('100001');
  await submit.click();
  await expect(dialog.getByRole('alert')).toHaveText('Quantity must be a whole number of 1 or more');
  await expect(dialog).toBeVisible();
  // At the upper limit: rejected by the total stock cap because stock is above 0
  await qty.fill('100000');
  await submit.click();
  await expect(dialog.getByRole('alert')).toHaveText('Stock cannot exceed 100,000');
  await expect(dialog).toBeVisible();
  // At the lower limit: accepted and saved
  await qty.fill('1');
  await submit.click();
  await expect(dialog).toBeHidden({ timeout: 5000 });
  const row = await reloadAndFindRow(page, sku);
  await expect(row.getByRole('cell').nth(3)).toHaveText(String(before + 1));
  await reportSignals(page, consoleErrors);
});