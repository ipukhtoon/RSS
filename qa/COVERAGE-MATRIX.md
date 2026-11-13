# Ronyal POS QA coverage matrix

This matrix separates browser execution from integrations that require dedicated infrastructure or physical hardware. A page opening is not a workflow pass.

| Area | Automated coverage in this branch | Current limits |
|---|---|---|
| Products and inventory | Seeded inventory, SKU/barcode search, pack/piece display, required form fields and cancel-without-write | Product create/edit/delete and all stock-adjustment paths need additional end-to-end cases |
| Batches, quantities and costs | FEFO batch valuation/depletion, expired-stock exclusion, duplicate-ID batch cost editing | More expiry write-off and negative reconciliation cases remain |
| Purchases and restocking | Real purchase form submission with packs plus loose pieces; record, cost, supplier, stock and batch assertions | Purchase edit/reversal and every cost-warning branch remain |
| Cash and other sales | Real cash checkout, sale snapshot, cash change, cost snapshot and stock depletion; underpayment blocked | Card, bank, wallet and split tender paths need separate cases |
| Udhaar and partial payments | Real Borrow checkout with initial partial payment and subsequent repayment; overpayment boundary | Multiple old-debt allocation and excess payment edge cases remain |
| Customer ledger | Customer balance arithmetic and repayment persistence through credit screen | WhatsApp export contents and complex multi-sale allocation need more cases |
| Returns and stock restoration | Real return flow and repeated partial returns; cumulative quantity limit and batch restoration | Simultaneous multi-device return race requires Firebase-backed integration |
| Udhaar returns | Real Borrow return with store credit; separate cash-refund-after-partial-payment scenario | Cash-refund amount versus debt adjustment needs explicit business-policy review |
| Reports and profit | Net revenue, return-adjusted COGS, gross profit, inventory cost/retail value and older-sale return period policy | CSV export content and every date/calendar period remain |
| Data Health and reconciliation | Mismatch/cost/below-cost diagnostics; owner reconciliation adds adjustment batch and audit trail | Multi-batch negative reconciliation and other issue repairs need cases |
| Firebase synchronization/offline | Offline browser retains local IndexedDB data | No live credentials or production Sync ID used; Firestore queue replay, conflict resolution and multi-device convergence are not tested |
| Owner/cashier permissions | Cashier sales/product access; owner-only Reports/Data Health/Settings PIN challenge | Recovery PIN, PIN changes and direct-call checks need additional tests |
| Receipt printing | Receipt DOM copies, browser print adapter and mocked Android bridge call/status | Physical Android PrintManager and 58/88mm paper output require device/printer |

## Isolation and safety

- Each Playwright test uses a fresh browser context and seeded local IndexedDB data.
- Service workers are blocked to avoid stale PWA cache interference.
- Firebase credentials and the live Store Sync ID are not loaded.
- No production POS source file is modified by this QA branch.
- Mocked print and offline tests are not presented as proof of physical printing or cloud synchronization.
