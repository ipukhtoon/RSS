# Confirmed POS issues found by Playwright

## POS-QA-001 — Physical stock reconciliation rejects valid numeric counts

- **Severity:** High
- **Area:** Data Health → Reconcile stock
- **Classification:** Confirmed production-code defect
- **Detected by:** `Owner stock reconciliation creates adjustment batch and audit trail`

### Reproduction

1. Sign in as Owner.
2. Create or locate a product with stock 10 pieces and batch total 8 pieces.
3. Open Data Health.
4. Choose **Reconcile stock**.
5. Enter `12` as the physically verified quantity and press **Continue**.

### Expected

The app should accept the whole-number count, ask for final confirmation, then save product stock 12, a 4-piece stock-reconciliation batch, and an audit entry.

### Actual

The app rejects the valid value with **“Enter a whole number of pieces. No changes were made.”** No stock adjustment or audit record is saved.

### Root cause

The numeric validation in `reconcileProductStock()` uses a double-escaped digit class in a JavaScript regular-expression literal:

```js
/^\\d+$/
```

That pattern matches a literal backslash followed by `d` characters, not decimal digits. It therefore rejects ordinary values such as `12`.

### Smallest safe correction

Change the validation to a single escaped digit class:

```js
/^\d+$/
```

Then rerun the Playwright reconciliation test and the complete POS regression suite. No production change has been made in this QA PR.
