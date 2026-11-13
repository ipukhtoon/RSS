const { expect } = require('@playwright/test');
const DB_NAME = 'ronyal_super_store_db';
const DB_VERSION = 7;
const PRODUCT_ID = 'qa-product-001';
const CUSTOMER_ID = 'qa-customer-001';

function tokens(values) {
  const out = new Set();
  for (const value of values) {
    const words = String(value || '').toLowerCase().trim().split(/[^a-z0-9]+/).filter(Boolean);
    for (const word of words) {
      out.add(word);
      if (word.length >= 3) for (let i = 0; i <= word.length - 3; i++) out.add(word.slice(i, i + 3));
    }
  }
  return [...out];
}
function productFixture(overrides = {}) {
  const p = {
    id: PRODUCT_ID, name: 'QA Test Milk 1L', category: 'QA Fixtures',
    sku: 'QA-SKU-001', barcode: '890000000001', pieceBarcode: '',
    saleMode: 'both', packSize: 6, price: 120, piecePriceEntered: true,
    packPrice: 700, cost: 90, stock: 10, lowStock: 2,
    batches: [{ id: 'qa-batch-001', qty: 10, costPerPiece: 90, expiry: '',
      receivedAt: new Date().toISOString(), salePiecePrice: 120, salePackPrice: 700 }]
  , ...overrides };
  p.searchTokens = tokens([p.name, p.sku, p.barcode, p.pieceBarcode, p.category]);
  return p;
}
function customerFixture(overrides = {}) {
  return { id: CUSTOMER_ID, name: 'QA Customer', phone: '03000000001',
    notes: 'Automated QA fixture', createdAt: new Date().toISOString(), ...overrides };
}
async function unlock(page, role = 'owner') {
  await page.goto('/');
  await expect(page.locator('#pinBackdrop')).toBeVisible();
  for (const digit of (role === 'cashier' ? '1234' : '9999')) {
    await page.locator('[data-pin-key="' + digit + '"]').click();
  }
  await expect(page.locator('#pinBackdrop')).toHaveCount(0);
}
async function acceptAppDialogs(page, promptValue = '12') {
  await page.evaluate(value => {
    window.appConfirm = async () => true;
    window.appAlert = async () => {};
    window.appPrompt = async () => String(value);
  }, promptValue);
}
async function seed(page, records = {}) {
  await page.evaluate(({ records, dbName, dbVersion }) => new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, dbVersion);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result, names = Object.keys(records), tx = db.transaction(names, 'readwrite');
      for (const name of names) {
        const store = tx.objectStore(name);
        for (const original of records[name]) {
          const row = structuredClone(original);
          if ((name === 'products' || name === 'sales') && !Array.isArray(row.searchTokens)) {
            const values = name === 'products'
              ? [row.name, row.sku, row.barcode, row.pieceBarcode, row.category]
              : [row.receipt, row.customerName, row.customerPhone];
            const out = new Set();
            for (const value of values) {
              const words = String(value || '').toLowerCase().trim().split(/[^a-z0-9]+/).filter(Boolean);
              for (const word of words) {
                out.add(word);
                if (word.length >= 3) for (let i = 0; i <= word.length - 3; i++) out.add(word.slice(i, i + 3));
              }
            }
            row.searchTokens = [...out];
          }
          store.put(row);
        }
      }
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('Fixture transaction aborted'));
    };
  }), { records, dbName: DB_NAME, dbVersion: DB_VERSION });
}
async function readStore(page, storeName) {
  return page.evaluate(({ dbName, dbVersion, storeName }) => new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, dbVersion);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result, tx = db.transaction(storeName, 'readonly'), get = tx.objectStore(storeName).getAll();
      get.onsuccess = () => resolve(get.result);
      get.onerror = () => reject(get.error);
      tx.oncomplete = () => db.close();
      tx.onerror = () => reject(tx.error);
    };
  }), { dbName: DB_NAME, dbVersion: DB_VERSION, storeName });
}
async function readRecord(page, storeName, id) {
  return page.evaluate(({ dbName, dbVersion, storeName, id }) => new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, dbVersion);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result, tx = db.transaction(storeName, 'readonly'), get = tx.objectStore(storeName).get(id);
      get.onsuccess = () => resolve(get.result || null);
      get.onerror = () => reject(get.error);
      tx.oncomplete = () => db.close();
      tx.onerror = () => reject(tx.error);
    };
  }), { dbName: DB_NAME, dbVersion: DB_VERSION, storeName, id });
}
async function go(page, view) {
  await page.locator('#sideNav [data-view="' + view + '"]').click();
  await expect(page.locator('#main')).not.toContainText('Could not load local database');
}
async function addFixtureProductToCart(page, sku = 'QA-SKU-001') {
  await go(page, 'pos');
  await page.locator('#posSearch').fill(sku);
  await expect(page.locator('[data-add-cart="' + PRODUCT_ID + '"]')).toBeVisible();
  await page.locator('[data-add-cart="' + PRODUCT_ID + '"]').click();
  await expect(page.locator('#completeSale')).toBeEnabled();
}
async function confirmSale(page) {
  await page.locator('#completeSale').click();
  await expect(page.locator('#saleConfirmBackdrop')).toBeVisible();
  await page.locator('#confirmSaleNow').click();
  await expect(page.locator('#receipt')).toBeVisible();
}
async function closeReceipt(page) {
  const button = page.locator('#closeReceipt');
  if (await button.count()) await button.click();
}
module.exports = {
  DB_NAME, DB_VERSION, PRODUCT_ID, CUSTOMER_ID, productFixture, customerFixture,
  unlock, acceptAppDialogs, seed, readStore, readRecord, go,
  addFixtureProductToCart, confirmSale, closeReceipt
};