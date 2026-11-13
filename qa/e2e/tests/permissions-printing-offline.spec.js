const { test, expect } = require('@playwright/test');
const { unlock, seed, productFixture, readRecord, go } = require('./helpers');

test('Cashier retains sales access but owner-only Reports, Data Health and Settings require owner PIN', async ({ page }) => {
  await unlock(page, 'cashier');
  await seed(page, { products: [productFixture()] });
  await go(page, 'pos');
  await expect(page.locator('#completeSale')).toBeVisible();
  await go(page, 'products');
  await expect(page.locator('#productsTable')).toBeVisible();

  for (const view of ['reports', 'dataHealth', 'settings']) {
    await page.locator('#sideNav [data-view="' + view + '"]').click();
    await expect(page.locator('#pinBackdrop')).toBeVisible();
    await expect(page.locator('#pinTitle')).toHaveText('Owner Access Required');
    await page.locator('#cancelPinPrompt').click();
    await expect(page.locator('#main')).toContainText('Dashboard');
  }
});

test('Receipt renders customer and shop copies and calls browser print adapter', async ({ page }) => {
  await unlock(page);
  await page.evaluate(() => {
    window.__qaPrintCalls = 0;
    window.print = () => { window.__qaPrintCalls += 1; };
    showReceipt({
      id: 'qa-receipt', receipt: 'QA-PRINT-001', date: new Date().toISOString(),
      subtotal: 120, discount: 0, total: 120, payment: 'Cash',
      cashReceived: 120, change: 0,
      items: [{ name: 'QA Test Milk 1L', qty: 1, unitType: 'piece', price: 120, lineTotal: 120 }]
    });
  });
  await expect(page.locator('#receipt .receipt-copy')).toHaveCount(2);
  await expect(page.locator('#receipt')).toContainText('QA-PRINT-001');
  await expect(page.locator('#receipt')).toContainText('CUSTOMER COPY');
  await expect(page.locator('#receipt')).toContainText('SHOP COPY');
  await page.locator('#printReceipt').click();
  expect(await page.evaluate(() => window.__qaPrintCalls)).toBe(1);
});

test('Android native print adapter receives the receipt job name and checks print status', async ({ page }) => {
  await unlock(page);
  await page.evaluate(() => {
    window.__qaNativePrintCalls = [];
    window.Capacitor = { isNativePlatform: () => true };
    window.RonyalPrinter = {
      getPrintStatus: async () => ({ activityAvailable: true, printingFeature: true, printManagerAvailable: true }),
      printWebView: async options => { window.__qaNativePrintCalls.push(options); }
    };
    showReceipt({
      id: 'qa-native-receipt', receipt: 'QA-NATIVE-001', date: new Date().toISOString(),
      subtotal: 120, discount: 0, total: 120, payment: 'Cash',
      cashReceived: 120, change: 0,
      items: [{ name: 'QA Test Milk 1L', qty: 1, unitType: 'piece', price: 120, lineTotal: 120 }]
    });
  });
  await page.locator('#printReceipt').click();
  await expect.poll(() => page.evaluate(() => window.__qaNativePrintCalls.length)).toBe(1);
  const calls = await page.evaluate(() => window.__qaNativePrintCalls);
  expect(calls[0].name).toBe('Ronyal Super Store Sales Receipt');
});

test('Offline browser retains local IndexedDB products and inventory view', async ({ page, context }) => {
  await unlock(page);
  await seed(page, { products: [productFixture()] });
  await context.setOffline(true);
  await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false);
  await go(page, 'products');
  await expect(page.locator('#productsTable')).toContainText('QA Test Milk 1L');
  const product = await readRecord(page, 'products', 'qa-product-001');
  expect(product.stock).toBe(10);
  expect(product.batches[0].qty).toBe(10);
  await context.setOffline(false);
});
