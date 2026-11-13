const { test, expect } = require('@playwright/test');
const { PRODUCT_ID, productFixture, unlock, resolveOwnerPinIfPrompted, resolveAppDialog, seed, readRecord, go } = require('./helpers');

test('Reports calculate net revenue, returned cost of goods, estimated gross profit and inventory valuation', async ({ page }) => {
  await unlock(page);
  const date = new Date().toISOString();
  await seed(page, {
    products: [productFixture({ stock: 9, batches: [{
      id: 'qa-batch-001', qty: 9, costPerPiece: 90, expiry: '',
      receivedAt: date, salePiecePrice: 120
    }] })],
    sales: [{
      id: 'qa-report-sale', receipt: 'QA-REPORT-001', date, payment: 'Cash',
      subtotal: 240, discount: 0, total: 240,
      items: [{ productId: PRODUCT_ID, name: 'QA Test Milk 1L', qty: 2, stockQty: 2,
        unitType: 'piece', packSize: 6, price: 120, lineTotal: 240, unitCost: 90 }]
    }],
    returns: [{
      id: 'qa-report-return', saleId: 'qa-report-sale', receipt: 'QA-REPORT-001',
      date, refundTotal: 120, refundMethod: 'Cash', creditAdjustment: 0,
      items: [{ saleItemIndex: 0, productId: PRODUCT_ID, qty: 1, stockQty: 1, unitCost: 90 }]
    }]
  });
  await page.evaluate(() => localStorage.setItem('ronyalReportPeriod', 'alltime'));
  await go(page, 'reports');

  const stat = label => page.locator('.stat').filter({ hasText: label }).locator('strong');
  await expect(stat('Net sales revenue')).toHaveText('Rs 120.00');
  await expect(stat('Estimated gross profit')).toHaveText('Rs 30.00');
  await expect(stat('Stock value at cost')).toHaveText('Rs 810.00');
  await expect(stat('Stock value at selling price')).toHaveText('Rs 1,080.00');
  await expect(page.locator('#main')).toContainText('Gross Rs 240.00');
  await expect(page.locator('#main')).toContainText('returns Rs 120.00');
});

test('Return linked to an older sale does not reduce current-period revenue', async ({ page }) => {
  await unlock(page);
  const old = new Date();
  old.setMonth(old.getMonth() - 3);
  const oldDate = old.toISOString();
  await seed(page, {
    products: [productFixture()],
    sales: [{
      id: 'qa-old-sale', receipt: 'QA-OLD-001', date: oldDate,
      payment: 'Cash', subtotal: 120, discount: 0, total: 120,
      items: [{ productId: PRODUCT_ID, name: 'QA Test Milk 1L', qty: 1, stockQty: 1,
        price: 120, lineTotal: 120, unitCost: 90 }]
    }],
    returns: [{
      id: 'qa-old-return', saleId: 'qa-old-sale', receipt: 'QA-OLD-001',
      date: new Date().toISOString(), refundTotal: 120, refundMethod: 'Cash',
      items: [{ saleItemIndex: 0, productId: PRODUCT_ID, qty: 1, stockQty: 1, unitCost: 90 }]
    }]
  });
  await page.evaluate(() => localStorage.setItem('ronyalReportPeriod', 'monthly'));
  await go(page, 'reports');
  await expect(page.locator('.stat').filter({ hasText: 'Net sales revenue' }).locator('strong')).toHaveText('Rs 0.00');
  await expect(page.locator('#main')).not.toContainText('returns Rs 120.00');
});

test('Data Health reports inventory mismatch, cost warning, batch outlier and below-cost sale without modifying data', async ({ page }) => {
  await unlock(page);
  const date = new Date().toISOString();
  await seed(page, {
    products: [productFixture({
      stock: 10, cost: 150, price: 120,
      batches: [{ id: 'qa-batch-001', qty: 8, costPerPiece: 500, expiry: '' }]
    })],
    sales: [{
      id: 'qa-below-cost-sale', receipt: 'QA-BELOW-COST', date,
      payment: 'Cash', total: 50,
      items: [{ productId: PRODUCT_ID, name: 'QA Test Milk 1L', qty: 1, stockQty: 1,
        price: 50, lineTotal: 50, unitCost: 150 }]
    }]
  });
  await go(page, 'dataHealth');
  await expect(page.locator('#main')).toContainText('Stock / batch mismatch');
  await expect(page.locator('#main')).toContainText('Product cost above price');
  await expect(page.locator('#main')).toContainText('Batch cost outlier');
  await expect(page.locator('#main')).toContainText('Sale below cost');
  await expect(page.locator('#main')).not.toContainText('Duplicate sale reversal');

  const product = await readRecord(page, 'products', PRODUCT_ID);
  expect(product.stock).toBe(10);
  expect(product.batches[0].qty).toBe(8);
});

test('Owner stock reconciliation creates adjustment batch and audit trail', async ({ page }) => {
  await unlock(page);
  await seed(page, {
    products: [productFixture({
      stock: 10,
      batches: [{ id: 'qa-batch-001', qty: 8, costPerPiece: 90, expiry: '' }]
    })]
  });
  await go(page, 'dataHealth');
  await page.locator('[data-health-product="' + PRODUCT_ID + '"][data-health-action="reconcile-stock"]').click();
  await resolveOwnerPinIfPrompted(page);
  await resolveAppDialog(page, '12');
  await resolveAppDialog(page);
  await expect.poll(async () => (await readRecord(page, 'products', PRODUCT_ID))?.stock).toBe(12);

  const product = await readRecord(page, 'products', PRODUCT_ID);
  expect(product.batches.reduce((sum, batch) => sum + batch.qty, 0)).toBe(12);
  expect(product.batches).toHaveLength(2);
  expect(product.batches[1]).toMatchObject({ qty: 4, source: 'stock-reconciliation' });
  expect(product.stockAdjustments).toHaveLength(1);
  expect(product.stockAdjustments[0].newStock).toBe(12);
});
