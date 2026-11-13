const { test, expect } = require('@playwright/test');
const { productFixture, unlock, seed, readRecord, go } = require('./helpers');

test('FEFO costing and depletion use earliest-expiry eligible batches and ignore expired batches', async ({ page }) => {
  await unlock(page);
  const result = await page.evaluate(() => {
    const date = days => {
      const d = new Date();
      d.setDate(d.getDate() + days);
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    };
    const p = { id: 'fefo', stock: 12, cost: 50, packSize: 1, batches: [
      { id: 'later', qty: 5, costPerPiece: 200, expiry: date(10) },
      { id: 'expired', qty: 5, costPerPiece: 1, expiry: date(-1) },
      { id: 'sooner', qty: 2, costPerPiece: 100, expiry: date(1) }
    ] };
    const weightedCost = batchUnitCostForQuantity(p, 3);
    const available = availableStock(p);
    const deducted = deductBatchStock(p, 3);
    return { weightedCost, available, deducted, stock: p.stock, batches: p.batches };
  });
  expect(result.available).toBe(7);
  expect(result.weightedCost).toBeCloseTo(400 / 3, 5);
  expect(result.deducted).toBe(true);
  expect(result.stock).toBe(9);
  expect(result.batches.find(b => b.id === 'sooner').qty).toBe(0);
  expect(result.batches.find(b => b.id === 'later').qty).toBe(4);
  expect(result.batches.find(b => b.id === 'expired').qty).toBe(5);
});

test('Credit balance calculation isolates customers and applies repayments and store-credit returns without exceeding debt', async ({ page }) => {
  await unlock(page);
  const result = await page.evaluate(() => {
    const customers = [{ id: 'c1', name: 'One' }, { id: 'c2', name: 'Two' }];
    const sales = [
      { id: 's1', customerId: 'c1', payment: 'Borrow', total: 1000, creditOutstanding: 1000, date: '2026-11-01T10:00:00.000Z' },
      { id: 's2', customerId: 'c2', payment: 'Borrow', total: 500, creditOutstanding: 500, date: '2026-11-01T11:00:00.000Z' }
    ];
    const payments = [{ id: 'p1', customerId: 'c1', amount: 400, date: '2026-11-02T10:00:00.000Z' }];
    const returns = [
      { id: 'r1', saleId: 's1', customerId: 'c1', refundMethod: 'Store credit', refundTotal: 300, creditAdjustment: 300, date: '2026-11-03T10:00:00.000Z' },
      { id: 'r2', saleId: 's1', customerId: 'c1', refundMethod: 'No refund', refundTotal: 200, creditAdjustment: 0, date: '2026-11-04T10:00:00.000Z' },
      { id: 'r3', saleId: 's1', customerId: 'c1', refundMethod: 'Store credit', refundTotal: 900, creditAdjustment: 900, date: '2026-11-05T10:00:00.000Z' }
    ];
    return calculateCreditBalances(customers, sales, payments, returns);
  });
  expect(result.find(c => c.id === 'c1')).toMatchObject({ paid: 400, returned: 600, balance: 0 });
  expect(result.find(c => c.id === 'c2').balance).toBe(500);
});

test('Credit cash refund adjustment is capped at remaining debt after previous repayments', async ({ page }) => {
  await unlock(page);
  const result = await page.evaluate(() => {
    const c = { id: 'c1', name: 'One' };
    const s = { id: 's1', customerId: 'c1', payment: 'Borrow', total: 120, creditOutstanding: 120, date: '2026-11-01T10:00:00.000Z' };
    const p = [{ id: 'p1', customerId: 'c1', amount: 20, date: '2026-11-02T10:00:00.000Z' }];
    const r = [{ id: 'r1', saleId: 's1', customerId: 'c1', refundMethod: 'Cash', refundTotal: 120, creditAdjustment: 120, date: '2026-11-03T10:00:00.000Z' }];
    const balance = calculateCreditBalances([c], [s], p, r)[0];
    return { paid: balance.paid, returned: balance.returned, balance: balance.balance, recordedCashRefund: r[0].refundTotal };
  });
  expect(result).toEqual({ paid: 20, returned: 100, balance: 0, recordedCashRefund: 120 });
  // The return UI currently stores full refundTotal as cash and creditAdjustment.
  // This is an accounting-policy risk: the system needs a separately defined
  // cash-refund cap for a credit sale after earlier repayments.
});

test('Return eligibility and status aggregate prior partial returns by original sale item index', async ({ page }) => {
  await unlock(page);
  const result = await page.evaluate(() => {
    const sale = { id: 's1', items: [{ qty: 3 }, { qty: 1 }] };
    const returns = [
      { saleId: 's1', items: [{ saleItemIndex: 0, qty: 1 }] },
      { saleId: 's1', items: [{ saleItemIndex: 0, qty: 1 }, { saleItemIndex: 1, qty: 1 }] }
    ];
    return { available: saleHasItemsAvailableToReturn(sale, returns), status: getSaleReturnStatus(sale, returns) };
  });
  expect(result).toEqual({ available: true, status: 'Partially returned' });
});

test('Historical purchase costing uses the latest purchase before sale date and excludes later purchases', async ({ page }) => {
  await unlock(page);
  const cost = await page.evaluate(() => historicalPurchaseUnitCost(
    { date: '2026-11-10T12:00:00.000Z' },
    { productId: 'p1' },
    [
      { productId: 'p1', date: '2026-10-01', packSize: 6, costPack: 600 },
      { productId: 'p1', date: '2026-11-05', packSize: 6, costPack: 720 },
      { productId: 'p1', date: '2026-11-12', packSize: 6, costPack: 900 }
    ]
  ));
  expect(cost).toBe(120);
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
  await expect(page.locator('#batchCostTitle')).toHaveCount(0);
  const saved = await readRecord(page, 'products', p.id);
  expect(saved.batches[0].costPerPiece).toBe(80);
  expect(saved.batches[1].costPerPiece).toBe(95);
});
