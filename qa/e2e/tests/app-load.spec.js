const { test, expect } = require('@playwright/test');

async function unlockAsOwner(page) {
  await page.goto('/');
  await expect(page.locator('#pinBackdrop')).toBeVisible();
  for (const digit of '9999') {
    await page.locator(`[data-pin-key="${digit}"]`).click();
  }
  await expect(page.locator('#pinBackdrop')).toHaveCount(0);
}

async function unlockAsCashier(page) {
  await page.goto('/');
  await expect(page.locator('#pinBackdrop')).toBeVisible();
  for (const digit of '1234') {
    await page.locator(`[data-pin-key="${digit}"]`).click();
  }
  await expect(page.locator('#pinBackdrop')).toHaveCount(0);
}

async function seedProduct(page) {
  await page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('ronyal_super_store_db', 7);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction('products', 'readwrite');
      tx.objectStore('products').put({
        id: 'qa-product-001',
        name: 'QA Test Milk 1L',
        category: 'QA Fixtures',
        sku: 'QA-SKU-001',
        barcode: '890000000001',
        pieceBarcode: '',
        saleMode: 'both',
        packSize: 6,
        price: 120,
        piecePriceEntered: true,
        packPrice: 700,
        cost: 90,
        stock: 18,
        lowStock: 5,
        batches: [{ id: 'qa-batch-001', qty: 18, costPerPiece: 90, expiry: '' }],
        searchTokens: ['qa', 'test', 'milk', '1l', 'qa-sku-001', '890', '900', '000', '000', '001']
      });
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('Fixture seed aborted'));
    };
  }));
}

test('POS loads and renders its main application shell', async ({ page }) => {
  const uncaughtErrors = [];
  page.on('pageerror', error => uncaughtErrors.push(error.message));

  await page.goto('/');
  await unlockAsOwner(page);
  await expect(page).toHaveTitle('Ronyal Super Store');
  await expect(page.locator('.app')).toBeVisible();
  await expect(page.locator('.top h1')).toHaveText('Ronyal Super Store');
  await expect(page.locator('#main')).not.toContainText('Could not start POS');

  await expect.poll(() => uncaughtErrors).toEqual([]);
});

test('Products inventory list loads seeded product and searches by SKU', async ({ page }) => {
  const uncaughtErrors = [];
  page.on('pageerror', error => uncaughtErrors.push(error.message));

  await unlockAsOwner(page);
  await expect(page.locator('#main')).toContainText('Dashboard');
  await seedProduct(page);

  await page.locator('[data-view="products"]').first().click();
  await expect(page.locator('#productsTable')).toContainText('QA Test Milk 1L');
  await expect(page.locator('#productsTable')).toContainText('18 pieces (3 full packs)');
  await expect(page.locator('#productsTable')).toContainText('Rs 120.00');

  await page.locator('#productSearch').fill('QA-SKU-001');
  await expect(page.locator('#productsTable')).toContainText('QA Test Milk 1L');
  await expect(page.locator('#productsTable')).not.toContainText('No products found');

  await page.locator('#productSearch').fill('890000000001');
  await expect(page.locator('#productsTable')).toContainText('QA Test Milk 1L');

  const saved = await page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('ronyal_super_store_db', 7);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction('products', 'readonly');
      const get = tx.objectStore('products').get('qa-product-001');
      get.onsuccess = () => resolve(get.result);
      get.onerror = () => reject(get.error);
      tx.oncomplete = () => db.close();
    };
  }));
  expect(saved.stock).toBe(18);
  expect(saved.batches).toHaveLength(1);
  expect(saved.batches[0].qty).toBe(18);

  await expect.poll(() => uncaughtErrors).toEqual([]);
});


test('Products add form exposes required inventory fields and cancel does not write data', async ({ page }) => {
  const uncaughtErrors = [];
  page.on('pageerror', error => uncaughtErrors.push(error.message));

  await unlockAsOwner(page);
  await page.locator('[data-view="products"]').first().click();
  await page.locator('#addProduct').click();

  const form = page.locator('#productForm');
  await expect(form).toBeVisible();
  await expect(form.locator('input[name="name"]')).toHaveAttribute('required', '');
  await expect(form.locator('input[name="packSize"]')).toBeVisible();
  await expect(form.locator('input[name="stock"]')).toHaveAttribute('required', '');
  await expect(form.locator('#productPiecePrice')).toBeVisible();
  await expect(form.locator('#productPackPrice')).toBeVisible();
  await expect(form.locator('#productCostInput')).toBeVisible();

  const before = await page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('ronyal_super_store_db', 7);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction('products', 'readonly');
      const count = tx.objectStore('products').count();
      count.onsuccess = () => resolve(count.result);
      count.onerror = () => reject(count.error);
      tx.oncomplete = () => db.close();
    };
  }));

  await page.locator('#cancelProduct').click();
  await expect(page.locator('#productForm')).toHaveCount(0);

  const after = await page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('ronyal_super_store_db', 7);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction('products', 'readonly');
      const count = tx.objectStore('products').count();
      count.onsuccess = () => resolve(count.result);
      count.onerror = () => reject(count.error);
      tx.oncomplete = () => db.close();
    };
  }));
  expect(after).toBe(before);
  await expect.poll(() => uncaughtErrors).toEqual([]);
});


test('Batch cost editor lists remaining batch quantity and current unit cost', async ({ page }) => {
  const uncaughtErrors = [];
  page.on('pageerror', error => uncaughtErrors.push(error.message));

  await unlockAsOwner(page);
  await seedProduct(page);
  await page.locator('[data-view="products"]').first().click();
  await expect(page.locator('#productsTable')).toContainText('QA Test Milk 1L');

  await page.locator('[data-edit-batch-costs="qa-product-001"]').first().click();
  await expect(page.locator('#batchCostTitle')).toHaveText('Remaining batch costs');
  await expect(page.locator('#overlay')).toContainText('Remaining: 18 pc');
  await expect(page.locator('#overlay')).toContainText('Rs 90.00 / pc');
  await expect(page.locator('[data-batch-cost-index="0"]')).toHaveValue('90.00');

  await page.locator('#cancelBatchCosts').click();
  await expect(page.locator('#batchCostTitle')).toHaveCount(0);

  const saved = await page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('ronyal_super_store_db', 7);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction('products', 'readonly');
      const get = tx.objectStore('products').get('qa-product-001');
      get.onsuccess = () => resolve(get.result);
      get.onerror = () => reject(get.error);
      tx.oncomplete = () => db.close();
    };
  }));
  expect(saved.batches[0].costPerPiece).toBe(90);
  expect(saved.batches[0].qty).toBe(18);
  await expect.poll(() => uncaughtErrors).toEqual([]);
});


test('Owner can open every POS section without database or JavaScript errors', async ({ page }) => {
  const uncaughtErrors = [];
  page.on('pageerror', error => uncaughtErrors.push(error.message));

  await unlockAsOwner(page);

  const sections = [
    ['dashboard', 'Dashboard'],
    ['pos', 'New Sale'],
    ['products', 'Products'],
    ['purchases', 'Purchases / Restock'],
    ['expiry', 'Expiry Management'],
    ['dataHealth', 'Data Health'],
    ['sales', 'Sales'],
    ['returns', 'Returns'],
    ['credit', 'Credit / Udhaar'],
    ['reports', 'Reports'],
    ['settings', 'Backup & Settings']
  ];

  for (const [id, label] of sections) {
    await page.locator('#sideNav').locator('[data-view="' + id + '"]').click();
    await expect(page.locator('#main')).not.toContainText('Could not load local database');
    await expect(page.locator('#main')).not.toContainText('Could not start POS');
    await expect(page.locator('#main')).not.toBeEmpty();
    await expect(page.locator('#sideNav').locator('[data-view="' + id + '"]')).toHaveClass(/active/);
  }

  await expect.poll(() => uncaughtErrors).toEqual([]);
});


test('Purchase restock form previews a selected product without changing inventory', async ({ page }) => {
  const uncaughtErrors = [];
  page.on('pageerror', error => uncaughtErrors.push(error.message));

  await unlockAsOwner(page);
  await seedProduct(page);
  await page.locator('#sideNav').locator('[data-view="purchases"]').click();

  await page.locator('#openPurchaseForm').click();
  const form = page.locator('#purchaseForm');
  await expect(form).toBeVisible();

  await page.locator('#purchaseProductSearch').fill('QA-SKU-001');
  const productOption = page.locator('[data-purchase-product="qa-product-001"]');
  await expect(productOption).toBeVisible();
  await productOption.click();

  await expect(page.locator('#purchaseProduct')).toHaveValue('qa-product-001');
  await expect(page.locator('#purchaseProductInfo')).toContainText('Current stock: 18 pieces');
  await expect(page.locator('#purchaseCalculation')).toContainText('Stock to add: 6 pieces');
  await expect(page.locator('#purchaseCalculation')).toContainText('New stock: 24 pieces');

  const saved = await page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('ronyal_super_store_db', 7);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction(['products', 'purchases'], 'readonly');
      const productRequest = tx.objectStore('products').get('qa-product-001');
      const purchaseCount = tx.objectStore('purchases').count();
      const result = {};
      productRequest.onsuccess = () => result.product = productRequest.result;
      purchaseCount.onsuccess = () => result.purchaseCount = purchaseCount.result;
      tx.oncomplete = () => { db.close(); resolve(result); };
      tx.onerror = () => reject(tx.error);
    };
  }));
  expect(saved.product.stock).toBe(18);
  expect(saved.product.batches[0].qty).toBe(18);
  expect(saved.purchaseCount).toBe(0);

  await page.locator('#closePurchaseForm').click();
  await expect(page.locator('#purchaseFormPanel')).toBeHidden();
  await expect.poll(() => uncaughtErrors).toEqual([]);
});

test('Credit ledger and returns screens expose their core search and entry controls', async ({ page }) => {
  const uncaughtErrors = [];
  page.on('pageerror', error => uncaughtErrors.push(error.message));

  await unlockAsOwner(page);

  await page.locator('#sideNav').locator('[data-view="credit"]').click();
  await expect(page.locator('#main')).toContainText('Credit / Udhaar');
  await expect(page.locator('#creditCustomerForm')).toBeVisible();
  await expect(page.locator('#creditCustomerForm input[name="name"]')).toHaveAttribute('required', '');
  await expect(page.locator('#creditCustomerSearch')).toBeVisible();
  await expect(page.locator('#repaymentSearch')).toBeVisible();

  await page.locator('#sideNav').locator('[data-view="returns"]').click();
  await expect(page.locator('#main')).toContainText('Returns');
  await expect(page.locator('#returnSaleSearch')).toBeVisible();
  await expect(page.locator('#returnHistorySearch')).toBeVisible();
  await expect.poll(() => uncaughtErrors).toEqual([]);
});


test('Cashier can access sales work but owner-only sections redirect safely', async ({ page }) => {
  const uncaughtErrors = [];
  page.on('pageerror', error => uncaughtErrors.push(error.message));

  await unlockAsCashier(page);
  await page.locator('#sideNav').locator('[data-view="products"]').click();
  await expect(page.locator('#main')).toContainText('Products');

  await page.locator('#sideNav').locator('[data-view="pos"]').click();
  await expect(page.locator('#main')).toContainText('New Sale');

  for (const id of ['reports', 'dataHealth', 'settings']) {
    await page.locator('#sideNav').locator('[data-view="' + id + '"]').click();
    await expect(page.locator('#main')).toContainText('Dashboard');
    await expect(page.locator('#sideNav').locator('[data-view="dashboard"]')).toHaveClass(/active/);
  }

  await expect.poll(() => uncaughtErrors).toEqual([]);
});

// QA suite revision: trigger the complete browser test suite on the current branch head.

// Trigger a full pull-request QA run after marking the draft PR ready.
