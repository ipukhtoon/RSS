# Ronyal Super Store QA

This QA suite is deliberately isolated from the production POS data.

## What currently runs

The initial Playwright smoke test serves the checked-out repository revision locally inside GitHub Actions. It verifies the document title, main POS shell, brand heading, and uncaught browser JavaScript errors.

It does not sign into a real store, create sales, modify IndexedDB records, or write to the production Firebase store.

## Run it

1. Open the repository's **Actions** tab.
2. Select **Ronyal POS Automated QA**.
3. Select **Run workflow** and choose the `pos-automated-qa` branch.
4. Open the completed run and download the `ronyal-pos-qa-report` artifact.

The workflow also runs when this branch is updated and when relevant files are included in a pull request to main.

## Planned test coverage

Expand the suite incrementally with isolated fixtures and explicit expected-value assertions for products, batches, purchases, sales, partial Udhaar payments, customer ledgers, returns, reports, Data Health, permissions, offline behaviour, and Firebase synchronization.

## Safety rules

- Never point destructive tests at the live store's Firebase Sync ID.
- Use a dedicated test store/database or a fully mocked persistence layer before adding write-flow tests.
- Do not treat a passing page-load test as proof that POS calculations are correct.
- AI-generated findings are recommendations. Review evidence and expected business rules before changing production code.
- Keep test changes on the QA branch and merge only after review.
