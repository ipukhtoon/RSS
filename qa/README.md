# Ronyal Super Store POS — Playwright QA

This branch contains an isolated browser QA environment for the Ronyal Super Store POS. It is not merged into production.

## Run locally or in GitHub Actions

- Workflow: **Ronyal POS Automated QA**.
- Trigger: pull-request updates targeting `main` or manual workflow dispatch. A shared concurrency group cancels stale QA runs when a newer revision arrives.
- Runtime: Node 22 + Playwright Chromium.
- Test app: local static server at `127.0.0.1:4173`.
- Isolation: fresh Playwright browser contexts and a dedicated seeded IndexedDB database per test; service workers are blocked.
- Evidence: HTML report, JSON results, failure screenshots, traces and videos.
- Consolidated Markdown report: `qa/AUDIT-REPORT.md` (generated from the Playwright JSON output and included in the workflow artifact).

Download the `ronyal-pos-qa-report` artifact from the completed Actions run. The coverage matrix is in `qa/COVERAGE-MATRIX.md`.

## Automated workflow coverage

The current suite includes real browser workflows and persisted-record assertions for:

1. Products and inventory display/search, plus product form validation/cancel.
2. FEFO batch cost valuation and stock depletion, expired-batch exclusion, duplicate-ID batch cost editing.
3. Purchase submission with pack and loose-piece conversion, supplier/invoice, cost and batch-stock reconciliation.
4. Cash checkout, sale-time cost snapshot, change, stock deduction and underpayment rejection.
5. Udhaar checkout with initial partial payment, later repayment and overpayment guard.
6. Customer balance arithmetic and customer isolation.
7. Cash/store-credit returns, stock restoration, repeated partial returns and return quantity caps.
8. Udhaar returns with store-credit debt reduction, plus cash-refund-after-partial-payment audit scenario.
9. Reports: net revenue, returned COGS, estimated gross profit, inventory cost/retail valuation and older-sale return period policy.
10. Data Health diagnostics and owner physical stock reconciliation with audit trail.
11. Offline local IndexedDB availability.
12. Owner/cashier access boundaries.
13. Receipt DOM, browser print adapter and mocked Android native bridge invocation.

A test passes only when its explicit assertions pass. The generated report lists each executed case and its result.

## Important limitations — never mislabel these as passed

- **Firebase cloud sync is not yet executed.** No production Sync ID is loaded. A dedicated Firebase Emulator or isolated test Firebase project is required to prove Firestore upload/download, offline queue replay, conflict resolution and multi-device convergence.
- **Physical receipt printing is not executed.** Browser printing and the Android bridge are tested with mocks; a real Android APK, Android PrintManager and 58/88mm printer are required to verify paper output.
- The suite does not certify every possible product, payment, date-period, purchase-edit, PIN recovery, or concurrency edge case. Review the coverage matrix.
- A green CI run proves only the named assertions in that run, not the whole POS in every environment.

## Confirmed regression finding

The full browser suite exposed a production defect in owner stock reconciliation: the numeric-count validator uses a double-escaped digit regex and rejects valid values such as `12`. The reconciliation regression is retained as an **expected failure** until the production fix is approved and applied. See `qa/KNOWN-ISSUES.md` for reproduction, impact and the minimal correction. No production source has been changed in this PR.

## Financial review item

The Udhaar cash-refund scenario records a full item refund in `refundTotal` and `creditAdjustment`, while the balance calculation caps the debt reduction at the remaining outstanding amount. For a partially paid Rs 120 credit sale with Rs 20 previously collected, the current code can record Rs 120 cash refund while reducing only Rs 100 of debt. The test preserves evidence of this current behaviour; the correct cash-refund policy (cash refund capped to payments received, store credit, or another explicit accounting rule) requires owner decision before any production fix.

## Safety boundaries

- Never run destructive tests against the live store database or live Firebase Sync ID.
- Test data exists only inside Playwright browser contexts and is discarded after each test.
- No production `index.html` change is included in this QA work.
- QA findings are not automatically fixed. Confirm business policy and review evidence before production changes.
- PR #5 remains draft/unmerged until the QA suite and its limits are reviewed.
