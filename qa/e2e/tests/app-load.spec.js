const { test, expect } = require('@playwright/test');

async function unlockAsOwner(page) {
  await page.goto('/');
  await expect(page.locator('#pinBackdrop')).toBeVisible();
  for (const digit of '9999') {
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
        piecePrice: 120,
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

  await expect.poll(() => uncaughtErrors).toEqual([]);
});
