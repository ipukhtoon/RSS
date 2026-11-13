const { test, expect } = require('@playwright/test');
const {
  unlock, seed, productFixture, readRecord, go,
  addFixtureProductToCart, confirmSale, closeReceipt
} = require('./helpers');

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

test('Receipt renders customer and shop copies and invokes browser print adapter after a real sale', async ({ page }) => {
  await unlock(page);
  await seed(page, { products: [productFixture()] });
  await page.evaluate(() => {
    window.__qaPrintCalls = 0;
    window.print = () => { window.__qaPrintCalls += 1; };
  });
  await addFixtureProductToCart(page);
  await page.locator('#cashReceived').fill('120');
  await confirmSale(page);

  await expect(page.locator('#receipt .receipt-print-copies .receipt-copy')).toHaveCount(2);
  await expect(page.locator('#receipt')).toContainText('CUSTOMER COPY');
  await expect(page.locator('#receipt')).toContainText('SHOP COPY');
  await expect(page.locator('#receipt')).toContainText('Rs 120.00');
  await page.locator('#printReceipt').click();
  expect(await page.evaluate(() => window.__qaPrintCalls)).toBe(1);
  await closeReceipt(page);
});

test('Android native print bridge receives the expected job name after a real sale', async ({ page }) => {
  await unlock(page);
  await seed(page, { products: [productFixture()] });
  await page.evaluate(() => {
    window.__qaNativePrintCalls = [];
    window.Capacitor = { isNativePlatform: () => true };
    window.RonyalPrinter = {
      getPrintStatus: async () => ({ activityAvailable: true, printingFeature: true, printManagerAvailable: true }),
      printWebView: async options => { window.__qaNativePrintCalls.push(options); }
    };
  });
  await addFixtureProductToCart(page);
  await page.locator('#cashReceived').fill('120');
  await confirmSale(page);
  await page.locator('#printReceipt').click();
  await expect.poll(() => page.evaluate(() => window.__qaNativePrintCalls.length)).toBe(1);
  const calls = await page.evaluate(() => window.__qaNativePrintCalls);
  expect(calls[0].name).toBe('Ronyal Super Store Sales Receipt');
  await closeReceipt(page);
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
