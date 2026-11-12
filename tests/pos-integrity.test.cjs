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

test('Data Health is read-only and includes requested diagnostics', () => {
  assert.match(html, /async function dataHealthPage\(\)/);
  for (const label of ['Duplicate sale reversal', 'Stock \/ batch mismatch', 'Batch cost outlier', 'Sale below cost']) {
    assert.ok(html.includes(label), 'missing diagnostic: ' + label);
  }
  assert.match(html, /no automatic corrections/i);
});
