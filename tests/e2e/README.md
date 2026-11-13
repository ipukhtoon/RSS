# Playwright POS audit

This browser-level layer complements, and does not replace, the existing Node.js integrity tests in tests/pos-integrity.test.cjs.

## Run locally

    npm install
    npx playwright install chromium
    npm test
    npm run test:e2e

The suite starts a dependency-free static server at 127.0.0.1:4173. Every test gets a fresh browser context/profile and isolated IndexedDB and localStorage.

## Evidence

CI retains the HTML report, JUnit XML, traces, screenshots and videos for failed tests. A green smoke suite is not a complete financial POS audit.

## Audit expansion plan

The next suites must seed deterministic test records in an isolated browser profile and exercise the real UI end-to-end: product CRUD; batch allocation and cost edits; purchase/restock; cash checkout; Udhaar checkout and repayments; customer ledger; cash and Udhaar partial/full returns; sale reversal; report totals and historical costs; Data Health reconciliation; offline mode and Firebase reconnect/conflict handling; owner/cashier access; and receipt/print output. Financial scenarios must assert visible totals and resulting IndexedDB records, stock and batch balances. Never point tests at a user's live browser profile or production store data.
