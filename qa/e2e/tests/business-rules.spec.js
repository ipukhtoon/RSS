const { test, expect } = require('@playwright/test');
const {
  PRODUCT_ID, productFixture, unlock, resolveAppDialog, seed, readRecord, go,
  addFixtureProductToCart, confirmSale, closeReceipt
} = require('./helpers');

test('FEFO sale consumes the earliest-expiring eligible batch and records its actual cost', async ({ page }) => {
  await unlock(page);
  const date = days => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  };
  const p = productFixture({
    stock: 12,
    batches: [
      { id: 'later', qty: 5, costPerPiece: 200, expiry: date(10), receivedAt: new Date().toISOString() },
      { id: 'expired', qty: 5, costPerPiece: 1, expiry: date(-1), receivedAt: new Date().toISOString() },
      { id: 'sooner', qty: 2, costPerPiece: 100, expiry: date(1), receivedAt: new Date().toISOString() }
    ]
  });
  await seed(page, { products: [p] });
  await addFixtureProductToCart(page);
  await page.locator('#cashReceived').fill('120');
  await confirmSale(page);

  const sales = await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('ronyal_super_store_db', 7);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    return new Promise((resolve, reject) => {
      const tx = db.transaction('sales', 'readonly');
      const request = tx.objectStore('sales').getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      tx.oncomplete = () => db.close();
    });
  });
  expect(sales).toHaveLength(1);
  expect(sales[0].items[0].unitCost).toBe(100);

  const product = await readRecord(page, 'products', PRODUCT_ID);
  expect(product.stock).toBe(11);
  expect(product.batches.find(b => b.id === 'sooner').qty).toBe(1);
  expect(product.batches.find(b => b.id === 'later').qty).toBe(5);
  expect(product.batches.find(b => b.id === 'expired').qty).toBe(5);
  await closeReceipt(page);
});

test('Customer ledger displays separate balances for two customers with repayment and store-credit returns', async ({ page }) => {
  await unlock(page);
  const date = new Date().toISOString();
  await seed(page, {
    customers: [
      { id: 'qa-customer-one', name: 'QA Customer One', phone: '03000000001' },
      { id: 'qa-customer-two', name: 'QA Customer Two', phone: '03000000002' }
    ],
    sales: [
      { id: 'qa-sale-one', receipt: 'QA-LEDGER-1', date, payment: 'Borrow', customerId: 'qa-customer-one', customerName: 'QA Customer One', total: 1000, creditOutstanding: 1000, items: [] },
      { id: 'qa-sale-two', receipt: 'QA-LEDGER-2', date, payment: 'Borrow', customerId: 'qa-customer-two', customerName: 'QA Customer Two', total: 500, creditOutstanding: 500, items: [] }
    ],
    creditPayments: [
      { id: 'qa-payment-one', customerId: 'qa-customer-one', amount: 400, date: new Date(Date.now() + 1000).toISOString(), method: 'Cash' }
    ],
    returns: [
      { id: 'qa-return-one', saleId: 'qa-sale-one', customerId: 'qa-customer-one', refundMethod: 'Store credit', refundTotal: 300, creditAdjustment: 300, date: new Date(Date.now() + 2000).toISOString(), items: [] }
    ]
  });
  await go(page, 'credit');
  const one = page.locator('.credit-card').filter({ hasText: 'QA Customer One' });
  const two = page.locator('.credit-card').filter({ hasText: 'QA Customer Two' });
  await expect(one).toContainText('Rs 300.00');
  await expect(two).toContainText('Rs 500.00');

  await one.locator('[data-credit-history="qa-customer-one"]').click();
  await expect(page.locator('#ledgerBackdrop')).toBeVisible();
  await expect(page.locator('#ledgerTitle')).toHaveText('Customer ledger');
  await expect(page.locator('#ledgerBackdrop')).toContainText('Credit sale');
  await expect(page.locator('#ledgerBackdrop')).toContainText('Repayment');
  await expect(page.locator('#ledgerBackdrop')).toContainText('Return · store credit');
  await expect(page.locator('#ledgerBackdrop')).toContainText('Rs 300.00');

  await page.locator('[data-ledger-receipt="qa-sale-one"]').click();
  await expect(page.locator('#receipt')).toBeVisible();
  await expect(page.locator('#receipt')).toContainText('QA-LEDGER-1');
  await page.locator('#closeReceipt').click();
  await page.locator('#closeLedger').click();
  await expect(page.locator('#ledgerBackdrop')).toHaveCount(0);
});

test('Historical costing in Reports uses latest purchase before sale and excludes later purchase', async ({ page }) => {
  await unlock(page);
  await seed(page, {
    products: [productFixture({ stock: 10, cost: 200, batches: [
      { id: 'qa-batch-current', qty: 10, costPerPiece: 200, expiry: '' }
    ] })],
    purchases: [
      { id: 'qa-purchase-old', productId: PRODUCT_ID, date: '2026-10-01', packSize: 6, costPack: 600, costPerPiece: 100, addedPieces: 6 },
      { id: 'qa-purchase-latest-before', productId: PRODUCT_ID, date: '2026-11-05', packSize: 6, costPack: 720, costPerPiece: 120, addedPieces: 6 },
      { id: 'qa-purchase-after', productId: PRODUCT_ID, date: '2026-11-12', packSize: 6, costPack: 900, costPerPiece: 150, addedPieces: 6 }
    ],
    sales: [{
      id: 'qa-historical-cost-sale', receipt: 'QA-HIST-COST', date: '2026-11-10T12:00:00.000Z',
      payment: 'Cash', subtotal: 150, discount: 0, total: 150,
      items: [{ productId: PRODUCT_ID, name: 'QA Test Milk 1L', qty: 1, stockQty: 1,
        price: 150, lineTotal: 150 }]
    }]
  });
  await page.evaluate(() => localStorage.setItem('ronyalReportPeriod', 'alltime'));
  await go(page, 'reports');
  await expect(page.locator('.stat').filter({ hasText: 'Estimated gross profit' }).locator('strong')).toHaveText('Rs 30.00');
});

test('Duplicate-ID batch costs can be edited independently by row index and persist', async ({ page }) => {
  await unlock(page);
  const p = productFixture({ batches: [
    { id: 'duplicate-batch-id', qty: 4, costPerPiece: 80, expiry: '' },
    { id: 'duplicate-batch-id', qty: 6, costPerPiece: 90, expiry: '' }
  ] });
  await seed(page, { products: [p] });
  await go(page, 'products');
  await page.locator('[data-edit-batch-costs="' + p.id + '"]').first().click();
  await expect(page.locator('[data-batch-cost-index="0"]')).toHaveValue('80.00');
  await expect(page.locator('[data-batch-cost-index="1"]')).toHaveValue('90.00');
  await page.locator('[data-batch-cost-index="1"]').fill('95');
  await page.locator('#saveBatchCosts').click();
  await resolveAppDialog(page);
  await expect(page.locator('#batchCostTitle')).toHaveCount(0);
  const product = await readRecord(page, 'products', p.id);
  expect(product.batches[0].costPerPiece).toBe(80);
  expect(product.batches[1].costPerPiece).toBe(95);
});
