# Ronyal Super Store QA

This QA suite is deliberately isolated from the production POS data.

## What currently runs

The Playwright suite serves the checked-out repository revision locally inside GitHub Actions. Current tests cover app startup/owner unlock and read-only Products inventory rendering using a seeded product in a fresh browser context. They check pack/piece stock text, piece price, SKU and barcode search, fixture persistence, and uncaught browser JavaScript errors.

The inventory fixture is written only to the isolated Playwright browser context's IndexedDB. Tests do not use a real store Sync ID or write to production Firebase. No sale, purchase, return, payment, or report workflow is covered yet.

## Run it

1. Open the repository's **Actions** tab.
2. Select **Ronyal POS Automated QA**.
3. Select **Run workflow** and choose the `pos-automated-qa` branch.
4. Open the completed run and download the `ronyal-pos-qa-report` artifact.

The workflow also runs when this branch is updated and when relevant files are included in a pull request to main.

## Planned test sequence

Complete the remaining end-to-end coverage in this order, using isolated fixtures and explicit expected-value assertions. The Products/inventory area has initial read-only coverage only; product create/edit/delete and stock adjustments still need tests:

1. Products and inventory.
2. Batches, quantities, and costs.
3. Purchases and restocking.
4. Cash and other sales.
5. Udhaar and partial payments.
6. Customer ledger.
7. Returns and stock restoration.
8. **Udhaar returns** — verify returned quantities, stock restoration, refund/credit treatment, outstanding balance, payment history, and ledger consistency for credit sales.
9. Reports and profit calculations.
10. Data Health and reconciliation.
11. Firebase synchronization and offline operation.
12. Owner/cashier permissions.
13. Receipt printing.

A feature is not considered covered merely because its screen opens. Tests must exercise its important workflows, persistence, boundary cases, and effects on related records. For financial and stock workflows, assert both the individual record changes and the resulting cross-feature balances.

## Safety rules

- Never point destructive tests at the live store's Firebase Sync ID.
- Use a dedicated test store/database or a fully mocked persistence layer before adding write-flow tests.
- Do not treat a passing page-load test as proof that POS calculations are correct.
- AI-generated findings are recommendations. Review evidence and expected business rules before changing production code.
- Keep test changes on the QA branch and merge only after review.

## Current automated coverage (development branch)

The suite now includes these browser checks:

- App startup, owner PIN unlock, brand heading, and browser JavaScript errors.
- Products list using an isolated seeded product: pack/piece stock text, piece price, SKU search, barcode search, and IndexedDB fixture persistence.
- Product form required fields and cancel-without-write behavior.
- Batch cost editor display of remaining quantity and current per-piece cost; cancel-without-write behavior.
- Owner navigation across all application sections.
- Purchase restock form product search and stock/cost preview; verifies that merely opening the form does not write a purchase or alter stock.
- Credit/Udhaar customer and repayment search controls, plus return receipt/history search controls.
- Cashier access to sales work and redirect away from owner-only Reports, Data Health, and Settings.

These are primarily startup, navigation, UI-contract, and non-mutating checks. They do **not** yet prove the correctness of checkout, purchase submission, partial Udhaar collection, repayment allocation, customer balance arithmetic, Udhaar returns, batch depletion, stock reconciliation, profit reports, Firebase convergence, or physical receipt printing. Those require isolated transaction fixtures, deterministic business-rule assertions, and additional tests before any area can be called passed.

## Execution status

The original smoke test passed in GitHub Actions. A later run exposed a malformed test fixture (it seeded the wrong piece-price property); that fixture was corrected. The latest branch commits have not yet returned a GitHub Actions run result through the available GitHub status endpoint, so the expanded suite is **not yet verified green**. Do not treat newly added tests as passing until CI reports the result.
