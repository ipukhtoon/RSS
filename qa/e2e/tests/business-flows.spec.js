const { test, expect } = require('@playwright/test');
const {
  PRODUCT_ID, CUSTOMER_ID, productFixture, customerFixture, unlock,
  acceptAppDialogs, seed, readStore, readRecord, go,
  addFixtureProductToCart, confirmSale, closeReceipt
} = require('./helpers');

test('Cash sale writes sale, exact change, sale-time unit cost and matching batch depletion', async ({ page }) => {
  await unlock(page);
  await seed(page, { products: [productFixture()] });
  await addFixtureProductToCart(page);
  await page.locator('#cashReceived').fill('150');
  await confirmSale(page);

  const sales = await readStore(page, 'sales');
  expect(sales).toHaveLength(1);
  expect(sales[0]).toMatchObject({ payment: 'Cash', subtotal: 120, discount: 0, total: 120, cashReceived: 150, change: 30 });
  expect(sales[0].items[0].unitCost).toBe(90);
  const product = await readRecord(page, 'products', PRODUCT_ID);
  expect(product.stock).toBe(9);
  expect(product.batches.reduce((sum, batch) => sum + batch.qty, 0)).toBe(9);
  await expect(page.locator('#receipt')).toContainText('Rs 120.00');
  await closeReceipt(page);
});

test('Cash underpayment is blocked without saving a sale or reducing stock', async ({ page }) => {
  await unlock(page);
  await seed(page, { products: [productFixture()] });
  await addFixtureProductToCart(page);
  await page.locator('#cashReceived').fill('100');
  await page.locator('#completeSale').click();
  await expect(page.locator('#saleConfirmBackdrop')).toHaveCount(0);
  await expect(page.locator('#toast')).toContainText('must cover the full sale total');
  expect(await readStore(page, 'sales')).toHaveLength(0);
  const product = await readRecord(page, 'products', PRODUCT_ID);
  expect(product.stock).toBe(10);
  expect(product.batches[0].qty).toBe(10);
});

test('Purchase form saves packs plus loose pieces with exact cost, supplier and matching stock batch', async ({ page }) => {
  await unlock(page);
  await seed(page, { products: [productFixture()] });
  await go(page, 'purchases');
  await page.locator('#openPurchaseForm').click();
  await page.locator('#purchaseProductSearch').fill('QA-SKU-001');
  await page.locator('[data-purchase-product="' + PRODUCT_ID + '"]').click();
  await page.locator('#purchaseForm [name="packs"]').fill('1');
  await page.locator('#purchaseForm [name="loosePieces"]').fill('2');
  await page.locator('#purchaseForm [name="costPack"]').fill('540');
  await page.locator('#purchaseForm [name="supplier"]').fill('QA Wholesale');
  await page.locator('#purchaseForm [name="invoice"]').fill('QA-INV-001');
  await page.locator('#purchaseForm button[type="submit"]').click();

  await expect(page.locator('#purchaseFormPanel')).toBeHidden();
  const purchases = await readStore(page, 'purchases');
  expect(purchases).toHaveLength(1);
  expect(purchases[0]).toMatchObject({
    packs: 1, loosePieces: 2, addedPieces: 8, costPack: 540,
    costPerPiece: 90, totalCost: 720, supplier: 'QA Wholesale', invoice: 'QA-INV-001'
  });
  const product = await readRecord(page, 'products', PRODUCT_ID);
  expect(product.stock).toBe(18);
  expect(product.batches.reduce((sum, batch) => sum + batch.qty, 0)).toBe(18);
  expect(product.batches.find(batch => batch.purchaseId === purchases[0].id).qty).toBe(8);
});

test('Udhaar checkout records a partial payment and subsequent repayment updates the customer balance', async ({ page }) => {
  await unlock(page);
  await seed(page, { products: [productFixture()], customers: [customerFixture()] });
  await addFixtureProductToCart(page);
  await page.locator('#payment').selectOption('Borrow');
  await page.locator('#borrowCustomerSearch').fill('QA Customer');
  await page.locator('[data-borrow-customer="' + CUSTOMER_ID + '"]').click();
  await page.locator('#cashReceived').fill('20');
  await confirmSale(page);

  let sales = await readStore(page, 'sales');
  expect(sales).toHaveLength(1);
  expect(sales[0]).toMatchObject({
    payment: 'Borrow', total: 120, initialPaymentAmount: 20,
    creditOutstanding: 120, customerOutstandingAfterSale: 100
  });
  let payments = await readStore(page, 'creditPayments');
  expect(payments).toHaveLength(1);
  expect(payments[0]).toMatchObject({ amount: 20, source: 'sale-checkout' });
  await closeReceipt(page);

  await go(page, 'credit');
  await page.locator('[data-credit-payment="' + CUSTOMER_ID + '"]').click();
  const amount = page.locator('#creditPaymentForm [name="amount"]');
  await expect(amount).toHaveAttribute('max', '100');
  await amount.fill('40');
  await page.locator('#creditPaymentForm [name="method"]').selectOption('Bank transfer');
  await page.locator('#creditPaymentForm button[type="submit"]').click();
  await expect(page.locator('#creditPaymentBackdrop')).toHaveCount(0);

  payments = await readStore(page, 'creditPayments');
  expect(payments).toHaveLength(2);
  expect(payments.reduce((sum, item) => sum + Number(item.amount), 0)).toBe(60);
  await expect(page.locator('#main')).toContainText('Rs 60.00');
});

test('Repayment greater than outstanding debt is rejected and no payment record is written', async ({ page }) => {
  await unlock(page);
  await seed(page, {
    customers: [customerFixture()],
    sales: [{
      id: 'qa-credit-sale-001', receipt: 'QA-CREDIT-001', date: new Date().toISOString(),
      payment: 'Borrow', customerId: CUSTOMER_ID, customerName: 'QA Customer',
      total: 100, creditOutstanding: 100, subtotal: 100, discount: 0, items: []
    }]
  });
  await go(page, 'credit');
  await page.locator('[data-credit-payment="' + CUSTOMER_ID + '"]').click();
  const amount = page.locator('#creditPaymentForm [name="amount"]');
  await expect(amount).toHaveAttribute('max', '100');
  await amount.fill('101');
  await page.locator('#creditPaymentForm button[type="submit"]').click();
  await expect(page.locator('#creditPaymentBackdrop')).toBeVisible();
  expect(await readStore(page, 'creditPayments')).toHaveLength(0);
});

test('Udhaar return with store credit restores stock and reduces linked customer debt', async ({ page }) => {
  await unlock(page);
  await acceptAppDialogs(page);
  const date = new Date().toISOString();
  await seed(page, {
    products: [productFixture({ stock: 9, batches: [{
      id: 'qa-batch-001', qty: 9, costPerPiece: 90, expiry: '',
      receivedAt: date, salePiecePrice: 120, salePackPrice: 700
    }] })],
    customers: [customerFixture()],
    sales: [{
      id: 'qa-credit-return-sale', receipt: 'QA-UDHAAR-RETURN-001', date,
      payment: 'Borrow', customerId: CUSTOMER_ID, customerName: 'QA Customer',
      total: 120, subtotal: 120, discount: 0, creditOutstanding: 120,
      items: [{
        productId: PRODUCT_ID, name: 'QA Test Milk 1L', qty: 1, stockQty: 1,
        unitType: 'piece', packSize: 6, price: 120, lineTotal: 120, unitCost: 90
      }]
    }]
  });
  await go(page, 'returns');
  await page.locator('#returnSaleSearch').fill('QA-UDHAAR-RETURN-001');
  await page.locator('[data-return-sale="qa-credit-return-sale"]').click();
  await page.locator('[data-return-index="0"]').fill('1');
  await page.locator('#returnRefundMethod').selectOption('Store credit');
  await page.locator('#confirmReturn').click();
  await expect(page.locator('#returnModalBackdrop')).toHaveCount(0);

  const returns = await readStore(page, 'returns');
  expect(returns).toHaveLength(1);
  expect(returns[0]).toMatchObject({
    saleId: 'qa-credit-return-sale', refundMethod: 'Store credit',
    refundTotal: 120, creditAdjustment: 120
  });
  const product = await readRecord(page, 'products', PRODUCT_ID);
  expect(product.stock).toBe(10);
  expect(product.batches.reduce((sum, batch) => sum + batch.qty, 0)).toBe(10);
  await go(page, 'credit');
  await expect(page.locator('#main')).toContainText('Settled');
});

test('Cash refund against a partially paid Udhaar sale persists the refund and debt adjustment separately', async ({ page }) => {
  await unlock(page);
  await acceptAppDialogs(page);
  const date = new Date().toISOString();
  await seed(page, {
    products: [productFixture({ stock: 9, batches: [{
      id: 'qa-batch-001', qty: 9, costPerPiece: 90, expiry: '', receivedAt: date
    }] })],
    customers: [customerFixture()],
    sales: [{
      id: 'qa-partial-cash-return-sale', receipt: 'QA-PARTIAL-CASH-RETURN', date,
      payment: 'Borrow', customerId: CUSTOMER_ID, customerName: 'QA Customer',
      total: 120, subtotal: 120, discount: 0, creditOutstanding: 120,
      items: [{ productId: PRODUCT_ID, name: 'QA Test Milk 1L', qty: 1, stockQty: 1,
        unitType: 'piece', packSize: 6, price: 120, lineTotal: 120, unitCost: 90 }]
    }],
    creditPayments: [{
      id: 'qa-initial-payment', customerId: CUSTOMER_ID, customerName: 'QA Customer',
      saleId: 'qa-partial-cash-return-sale', amount: 20, date,
      method: 'Cash', source: 'sale-checkout'
    }]
  });
  await go(page, 'returns');
  await page.locator('#returnSaleSearch').fill('QA-PARTIAL-CASH-RETURN');
  await page.locator('[data-return-sale="qa-partial-cash-return-sale"]').click();
  await page.locator('[data-return-index="0"]').fill('1');
  await page.locator('#returnRefundMethod').selectOption('Cash');
  await page.locator('#confirmReturn').click();
  await expect(page.locator('#returnModalBackdrop')).toHaveCount(0);

  const record = (await readStore(page, 'returns'))[0];
  expect(record.refundTotal).toBe(120);
  expect(record.creditAdjustment).toBe(120);
  await go(page, 'credit');
  await expect(page.locator('#main')).toContainText('Settled');
  // Audit note: the return UI currently records the full item refund as cash even though
  // only Rs 20 was collected. The balance calculator caps debt reduction to Rs 100.
  // This test captures the current persisted behaviour for a financial-policy review;
  // it does not certify that the customer cash refund amount is commercially correct.
});

test('Two partial returns cannot return more than the original sold quantity', async ({ page }) => {
  await unlock(page);
  await acceptAppDialogs(page);
  const date = new Date().toISOString();
  await seed(page, {
    products: [productFixture({ stock: 8, batches: [{ id: 'qa-batch-001', qty: 8, costPerPiece: 90, expiry: '', receivedAt: date }] })],
    sales: [{
      id: 'qa-multi-return-sale', receipt: 'QA-MULTI-RETURN-001', date,
      payment: 'Cash', total: 240, subtotal: 240, discount: 0,
      items: [{ productId: PRODUCT_ID, name: 'QA Test Milk 1L', qty: 2, stockQty: 2,
        unitType: 'piece', packSize: 6, price: 120, lineTotal: 240, unitCost: 90 }]
    }]
  });
  await go(page, 'returns');
  await page.locator('#returnSaleSearch').fill('QA-MULTI-RETURN-001');
  await page.locator('[data-return-sale="qa-multi-return-sale"]').click();
  await page.locator('[data-return-index="0"]').fill('1');
  await page.locator('#returnRefundMethod').selectOption('Cash');
  await page.locator('#confirmReturn').click();
  await expect(page.locator('#returnModalBackdrop')).toHaveCount(0);

  await page.locator('#returnSaleSearch').fill('QA-MULTI-RETURN-001');
  await page.locator('[data-return-sale="qa-multi-return-sale"]').click();
  await expect(page.locator('[data-return-index="0"]')).toHaveAttribute('max', '1');
  await page.locator('[data-return-index="0"]').fill('1');
  await page.locator('#returnRefundMethod').selectOption('Cash');
  await page.locator('#confirmReturn').click();
  await expect(page.locator('#returnModalBackdrop')).toHaveCount(0);
  const returns = await readStore(page, 'returns');
  expect(returns).toHaveLength(2);
  expect(returns.reduce((sum, item) => sum + item.items[0].qty, 0)).toBe(2);
  const product = await readRecord(page, 'products', PRODUCT_ID);
  expect(product.stock).toBe(10);
  expect(product.batches.reduce((sum, batch) => sum + batch.qty, 0)).toBe(10);
  await page.locator('#returnSaleSearch').fill('QA-MULTI-RETURN-001');
  await expect(page.locator('[data-return-sale="qa-multi-return-sale"]')).toHaveCount(0);
});
