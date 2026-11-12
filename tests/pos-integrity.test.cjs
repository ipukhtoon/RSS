'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const inlineScripts = [];
let cursor = 0;
while ((cursor = html.indexOf('<script', cursor)) !== -1) {
  const openEnd = html.indexOf('>', cursor);
  if (openEnd < 0) break;
  const close = html.indexOf('</script>', openEnd);
  if (close < 0) break;
  const source = html.slice(openEnd + 1, close);
  if (source.trim()) inlineScripts.push(source);
  cursor = close + 9;
}

test('all inline JavaScript parses', () => {
  assert.ok(inlineScripts.length > 0);
  inlineScripts.forEach((source, index) => {
    assert.doesNotThrow(() => new Function(source), 'inline script ' + index);
  });
});

test('backup schema remains version 5', () => {
  assert.match(html, /schemaVersion\s*:\s*5/);
});

test('sale reversal uses a deterministic sale and item identity', () => {
  assert.match(html, /sale-reversal-\$\{String\(latest\.id\)\}-\$\{index\}/);
  assert.match(html, /sourceItemIndex:index/);
  assert.match(html, /db\.transaction\(\['products','sales'\],'readwrite'\)/);
});

test('only one sale-reversal creation path remains', () => {
  assert.equal((html.match(/sale-reversal-/g) || []).length, 1);
});

test('product form warns on pack and piece price mismatch', () => {
  assert.match(html, /Pack price differs from pack size/);
});

test('purchase form checks duplicate product, quantity and unit cost', () => {
  assert.match(html, /Possible duplicate purchase/);
  assert.match(html, /600000/);
});

test('checkout shows a non-blocking below-cost warning', () => {
  assert.match(html, /Below-cost warning/);
  assert.match(html, /batchUnitCostForQuantity\(p,units\)\*units/);
});

test('Data Health ignores products without batch tracking but still detects tracked mismatches', () => {
  assert.match(html, /if\(bs\.length&&sum!==stock\)add\('Stock \/ batch mismatch'/);
});

test('Data Health is read-only and includes requested diagnostics', () => {
  assert.match(html, /async function dataHealthPage\(\)/);
  for (const label of ['Duplicate sale reversal', 'Stock \/ batch mismatch', 'Batch cost outlier', 'Sale below cost']) {
    assert.ok(html.includes(label), 'missing diagnostic: ' + label);
  }
  assert.match(html, /no automatic corrections/i);
});

test('receipt prices are grouped in first-seen order and validated against line total', () => {
  const vm = require('node:vm');
  const start = html.indexOf('function receiptPriceGroups(item){');
  const end = html.indexOf('function receiptPriceSubline(item){', start);
  assert.ok(start >= 0 && end > start, 'receipt grouping helper exists');
  const source = html.slice(start, end);
  const warnings = [];
  const context = { console: { warn: (...args) => warnings.push(args) } };
  vm.runInNewContext(source + ';this.group=receiptPriceGroups;', context);
  const single = context.group({qty:1,price:100,lineTotal:100,unitPrices:[100]});
  assert.deepEqual(JSON.parse(JSON.stringify(single.groups)), [{count:1,price:100}]);
  assert.equal(single.show, false);
  const mixed = context.group({qty:4,price:100,lineTotal:410,unitPrices:[100,100,100,110]});
  assert.deepEqual(JSON.parse(JSON.stringify(mixed.groups)), [{count:3,price:100},{count:1,price:110}]);
  const pack = context.group({qty:2,unitType:'pack',price:300,lineTotal:600,unitPrices:[300,300]});
  assert.equal(pack.isPack, true);
  assert.equal(pack.show, true);
  const legacy = context.group({qty:3,price:25,lineTotal:75});
  assert.deepEqual(JSON.parse(JSON.stringify(legacy.groups)), [{count:3,price:25}]);
  const mismatch = context.group({qty:2,price:50,lineTotal:120,unitPrices:[50,50]});
  assert.equal(mismatch, null);
  assert.equal(warnings.length, 1);
});

test('receipt uses grouped muted sub-lines and unit labels for piece and pack quantities', () => {
  assert.match(html, /receiptPriceSubline\(i\)/);
  assert.match(html, /i\.unitType==='pack'\?'pack':'pc'/);
  assert.match(html, /receipt-price-breakdown/);
  assert.doesNotMatch(html, /Prices: \$\{prices\.map/);
});

test('remaining batch cost correction is owner-gated, audited and excludes zero-quantity batches', () => {
  const start = html.indexOf('async function editRemainingBatchCosts(productId){');
  const end = html.indexOf('function normalizeProductName', start);
  assert.ok(start >= 0 && end > start);
  const source = html.slice(start, end);
  assert.match(source, /requireOwnerAccess\('correct remaining stock batch costs'\)/);
  assert.match(source, /product\.batches\.filter\(b=>Number\(b\.qty\)>0\)/);
  assert.match(source, /costAudit\.push/);
  assert.match(source, /previousCostPerPiece/);
  assert.match(source, /newCostPerPiece/);
  assert.match(source, /Historical sale costs were not changed/);
  assert.doesNotMatch(source, /put\('sales'/);
});

test('mobile tables become stacked cards instead of requiring horizontal swipes', () => {
  assert.match(html, /\.table-wrap tbody\{display:grid!important/);
  assert.match(html, /\.table-wrap tbody td:before\{content:attr\(data-label\)/);
  assert.match(html, /labelResponsiveTables\(document\)/);
  assert.match(html, /data-label/);
  assert.match(html, /\.receipt-items\{table-layout:fixed!important\}/);
});

test('data health findings identify products and return to data health after closing product editor', () => {
  assert.match(html, /health-finding-card/);
  assert.match(html, /productName\(x\.productId\)/);
  assert.match(html, /health-product-name/);
  assert.match(html, /showProductForm\(p,\{returnView:'dataHealth'\}\)/);
  assert.match(html, /options\.returnView\)\{view=options\.returnView;render\(\)\}/);
});

test('app-wide mobile card polish covers tables, modal rows, and common card components', () => {
  assert.match(html, /\.table-wrap tbody td\{grid-template-columns:minmax\(0,34%\) minmax\(0,1fr\)!important/);
  assert.match(html, /#returnItemForm \.table-wrap tbody tr/);
  assert.match(html, /\.credit-card\{padding:11px!important/);
  assert.match(html, /\.product-list \.product-card\{padding:10px!important/);
  assert.match(html, /\.sale-confirm-item\{align-items:flex-start!important/);
  assert.match(html, /\.receipt-screen-copy,\.receipt-copy\{padding:10px!important/);
});

test('mobile product identifiers are separated and blank table headers never create Column labels', () => {
  assert.match(html, /product-identifiers/);
  assert.match(html, /Pack barcode:/);
  assert.match(html, /Piece barcode:/);
  assert.match(html, /SKU:/);
  assert.match(html, /if\(label\).*removeAttribute\('data-label'\)/);
  assert.doesNotMatch(html, /Column '\+\(index\+1\)/);
  assert.match(html, /\.product-table-name\{display:flex!important;flex-direction:column!important/);
  assert.match(html, /\.panel \.actions,\.modal \.actions/);
});

test('final mobile alignment keeps product actions grouped and return controls positioned', () => {
 assert.match(html,/product-row-actions/);
 assert.match(html,/product-batch-count/);
 assert.match(html,/dashboard-customer-name/);
 assert.match(html,/return-item-name-cell/);
 assert.match(html,/return-qty-cell/);
 assert.match(html,/return-modal-actions/);
 assert.match(html,/\.product-table-name \.product-photo-thumb\{align-self:flex-start!important/);
});

test('mobile sales history uses structured receipt cards and keeps desktop table', () => {
 assert.match(html,/class="sales-mobile-cards"/);
 assert.match(html,/class="sale-card"/);
 assert.match(html,/class="sale-customer"/);
 assert.match(html,/data-receipt=/);
 assert.match(html,/data-delete-sale=/);
 assert.match(html,/class="sales-desktop-table"/);
 assert.match(html,/\.sale-payment \.field-label,\.sale-payment strong,\.sale-customer\{width:100%;text-align:right\}/);
});

test('mobile record tables use card rows and preserve RSS button palette', () => {
 assert.match(html,/Unified RSS mobile record cards/);
 assert.match(html,/\.table-wrap tbody tr\{display:grid!important;grid-template-columns:minmax\(0,1fr\)!important/);
 assert.match(html,/\.table-wrap tbody td button\.secondary/);
 assert.match(html,/\.table-wrap tbody td button\.danger/);
 assert.match(html,/class="action-btn secondary view-receipt"/);
 assert.match(html,/class="action-btn danger delete-sale"/);
});
