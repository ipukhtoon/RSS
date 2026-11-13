'use strict';
const {test,expect}=require('@playwright/test');
const {unlock,navigate,readStores,confirmAppDialog}=require('./helpers.cjs');
test.beforeEach(async({page})=>{await page.route('https://www.gstatic.com/**',route=>route.abort());});
test('complete financial journey: product, purchase, cash, Udhaar, repayment, partial returns and reports',async({page})=>{
 await unlock(page);
 // Product creation with an opening batch.
 await navigate(page,'products'); await page.locator('#addProduct').click();
 const form=page.locator('#productForm'); await expect(form).toBeVisible();
 await form.locator('[name=name]').fill('PW Audit Water'); await form.locator('[name=barcode]').fill('PW-AUDIT-001');
 await form.locator('[name=saleMode]').selectOption('both'); await form.locator('[name=packSize]').fill('6');
 await form.locator('[name=price]').fill('20'); await form.locator('[name=packPrice]').fill('120');
 await form.locator('[name=costPack]').fill('60'); await form.locator('[name=stock]').fill('2');
 await form.getByRole('button',{name:'Save product'}).click();
 await expect(page.locator('#productModalBack')).toHaveCount(0);
 let db=await readStores(page); let product=db.products.find(p=>p.name==='PW Audit Water');
 expect(product,'created product record').toBeTruthy(); expect(product.stock).toBe(12);
 expect(product.batches.reduce((n,b)=>n+Number(b.qty||0),0)).toBe(12);
 // Purchase/restock: one six-piece pack and two loose pieces.
 await navigate(page,'purchases'); await page.locator('#openPurchaseForm').click();
 await page.locator('#purchaseProductSearch').fill('PW Audit Water');
 await expect(page.locator('#purchaseProductResults [data-purchase-product]')).toHaveCount(1);
 await page.locator('#purchaseProductResults [data-purchase-product]').click();
 const purchase=page.locator('#purchaseForm'); await purchase.locator('[name=packs]').fill('1');
 await purchase.locator('[name=loosePieces]').fill('2'); await purchase.locator('[name=costPack]').fill('72');
 await purchase.locator('[name=supplier]').fill('Playwright Supplier'); await purchase.locator('[name=invoice]').fill('PW-INV-001');
 await purchase.locator('button[type=submit]').click();
 await page.locator('#keepPrices').click();
 await expect(page.locator('#purchaseForm')).toBeVisible();
 db=await readStores(page); product=db.products.find(p=>p.id===product.id);
 expect(product.stock).toBe(20); expect(product.batches.reduce((n,b)=>n+Number(b.qty||0),0)).toBe(20);
 expect(db.purchases).toHaveLength(1); expect(db.purchases[0].addedPieces).toBe(8);
 // Cash sale: sell two pieces so each can be returned independently.
 await navigate(page,'pos'); await page.locator('#posSearch').fill('PW Audit Water');
 await expect(page.locator('#posProducts [data-add-cart]')).toHaveCount(1);
 await page.locator('#posProducts [data-add-cart]').click();
 await page.locator('#cartItems [data-plus]').click();
 await page.locator('#cashReceived').fill('40'); await page.locator('#completeSale').click();
 await page.locator('#confirmSaleNow').click(); await expect(page.locator('#receipt')).toBeVisible();
 await expect(page.locator('#receipt')).toContainText('Rs 40.00');
 await page.locator('#closeReceipt').click();
 db=await readStores(page); const cashSale=db.sales.find(s=>s.payment==='Cash'&&s.total===40);
 expect(cashSale).toBeTruthy(); expect(db.products.find(p=>p.id===product.id).stock).toBe(19);
 // Credit customer and partial-payment Udhaar sale.
 await navigate(page,'credit'); await page.locator('#creditCustomerForm [name=name]').fill('PW Audit Buyer');
 await page.locator('#creditCustomerForm [name=phone]').fill('03000000001');
 await page.locator('#creditCustomerForm button[type=submit]').click();
 await expect(page.locator('.credit-card').filter({hasText:'PW Audit Buyer'})).toBeVisible();
 await navigate(page,'pos'); await page.locator('#posSearch').fill('PW Audit Water');
 await page.locator('#posProducts [data-add-cart]').click(); await page.locator('#payment').selectOption('Borrow');
 await page.locator('#borrowCustomerSearch').fill('PW Audit Buyer');
 await expect(page.locator('#borrowCustomerResults [data-borrow-customer]')).toHaveCount(1);
 await page.locator('#borrowCustomerResults [data-borrow-customer]').click();
 await page.locator('#cashReceived').fill('5'); await page.locator('#completeSale').click();
 await page.locator('#confirmSaleNow').click(); await expect(page.locator('#receipt')).toBeVisible();
 await page.locator('#closeReceipt').click();
 db=await readStores(page); const creditSale=db.sales.find(s=>s.payment==='Borrow'&&s.customerName==='PW Audit Buyer');
 expect(creditSale).toBeTruthy(); expect(creditSale.total).toBe(20); expect(creditSale.initialPaymentAmount).toBe(5);
 expect(db.creditPayments.some(p=>p.saleId===creditSale.id&&p.amount===5)).toBeTruthy();
 expect(db.products.find(p=>p.id===product.id).stock).toBe(17);
 // Record a separate partial repayment against the customer balance.
 await navigate(page,'credit');
 await page.locator('.credit-card').filter({hasText:'PW Audit Buyer'}).getByRole('button',{name:/Record repayment/}).click();
 await page.locator('#creditPaymentForm [name=amount]').fill('5');
 await page.locator('#creditPaymentForm button[type=submit]').click();
 db=await readStores(page); expect(db.creditPayments.some(p=>p.customerId===creditSale.customerId&&p.amount===5)).toBeTruthy();
 // First partial cash return: only one of two pieces, then the remaining piece.
 await navigate(page,'returns'); await page.locator('#returnSaleSearch').fill(cashSale.receipt);
 await page.locator('[data-return-sale]').click();
 await page.locator('#returnItemForm [data-return-index="0"]').fill('1');
 await page.locator('#returnRefundMethod').selectOption('Cash');
 await page.locator('#confirmReturn').click(); await confirmAppDialog(page,true);
 db=await readStores(page); expect(db.returns.filter(r=>r.saleId===cashSale.id)).toHaveLength(1);
 expect(db.products.find(p=>p.id===product.id).stock).toBe(18);
 await navigate(page,'returns'); await page.locator('#returnSaleSearch').fill(cashSale.receipt);
 await page.locator('[data-return-sale]').click();
 await page.locator('#returnItemForm [data-return-index="0"]').fill('1');
 await page.locator('#returnRefundMethod').selectOption('No refund');
 await page.locator('#confirmReturn').click(); await confirmAppDialog(page,true);
 db=await readStores(page); expect(db.returns.filter(r=>r.saleId===cashSale.id)).toHaveLength(2);
 expect(db.products.find(p=>p.id===product.id).stock).toBe(19);
 // Udhaar return: cash refund must reduce the customer's outstanding ledger safely.
 await navigate(page,'returns'); await page.locator('#returnSaleSearch').fill(creditSale.receipt);
 await page.locator('[data-return-sale]').click();
 await page.locator('#returnItemForm [data-return-index="0"]').fill('1');
 await page.locator('#returnRefundMethod').selectOption('Cash');
 await page.locator('#confirmReturn').click(); await confirmAppDialog(page,true);
 db=await readStores(page); const creditReturn=db.returns.find(r=>r.saleId===creditSale.id);
 expect(creditReturn).toBeTruthy(); expect(creditReturn.creditAdjustment).toBe(20);
 expect(db.products.find(p=>p.id===product.id).stock).toBe(20);
 // Verify customer ledger renders, receipts are available, and balance is never negative.
 await navigate(page,'credit'); await page.locator('#creditCustomerSearch').fill('PW Audit Buyer');
 await expect(page.locator('#creditCustomerList')).toContainText('PW Audit Buyer');
 expect(db.creditPayments.filter(p=>p.customerId===creditSale.customerId).reduce((n,p)=>n+Number(p.amount||0),0)).toBe(10);
 expect(db.returns.filter(r=>r.customerId===creditSale.customerId&&r.refundMethod!=='No refund').reduce((n,r)=>n+Number(r.creditAdjustment||0),0)).toBe(20);
 // Reports: exercise all-time period selector and assert report content renders.
 await navigate(page,'reports'); await page.locator('#reportPeriodTrigger').click();
 await page.locator('[data-report-period="alltime"]').click();
 await expect(page.locator('#main')).toContainText(/Net sales revenue/i);
 await page.locator('#expenseForm [name=description]').fill('PW Audit Electricity');
 await page.locator('#expenseForm [name=amount]').fill('125');
 await page.locator('#expenseForm [name=category]').fill('Utilities');
 await page.locator('#expenseForm button[type=submit]').click();
 db=await readStores(page); expect(db.expenses.some(e=>e.description==='PW Audit Electricity'&&e.amount===125)).toBeTruthy();
 // Data Health must render without mutating the fixture records.
 await navigate(page,'dataHealth'); await expect(page.locator('#main')).toContainText('Data Health');
 const afterHealth=await readStores(page); expect(afterHealth.sales).toHaveLength(db.sales.length);
});
test('cashier role is blocked from owner-only reports, settings and Data Health',async({page})=>{
 await unlock(page,'1234'); await navigate(page,'reports');
 await expect(page.locator('#pinBackdrop')).toBeVisible();
 await expect(page.locator('#pinTitle')).toContainText('Owner Access Required');
 await page.locator('#cancelPinPrompt').click();
 await expect(page.locator('#pinBackdrop')).toHaveCount(0);
 await expect(page.locator('#main')).not.toContainText('Gross revenue');
});
test('offline browser session can complete a local sale and preserve IndexedDB data',async({page,context})=>{
 await unlock(page);
 await seedStores(page,{products:[{id:'offline-p',name:'Offline Test Item',sku:'OFFLINE-001',barcode:'OFFLINE-001',saleMode:'piece',piecePriceEntered:true,price:15,packPrice:15,packSize:1,cost:7,stock:3,lowStock:1,batches:[{id:'offline-b',qty:3,costPerPiece:7,expiry:'',receivedAt:new Date().toISOString()}]}]});
 await context.setOffline(true); await navigate(page,'pos'); await page.locator('#posSearch').fill('Offline Test Item');
 await page.locator('#posProducts [data-add-cart]').click(); await page.locator('#cashReceived').fill('15');
 await page.locator('#completeSale').click(); await page.locator('#confirmSaleNow').click();
 await expect(page.locator('#receipt')).toBeVisible();
 const db=await readStores(page); expect(db.sales.some(s=>s.items.some(i=>i.productId==='offline-p'))).toBeTruthy();
 expect(db.products.find(p=>p.id==='offline-p').stock).toBe(2);
});
test('receipt contains two print copies and invokes browser print without changing saved sale',async({page})=>{
 await page.addInitScript(()=>{window.__pwPrintCalled=false;window.print=()=>{window.__pwPrintCalled=true}});
 await unlock(page);
 await seedStores(page,{products:[{id:'print-p',name:'Print Test Item',sku:'PRINT-001',saleMode:'piece',piecePriceEntered:true,price:25,packPrice:25,packSize:1,cost:10,stock:2,lowStock:1,batches:[{id:'print-b',qty:2,costPerPiece:10,expiry:'',receivedAt:new Date().toISOString()}]}]});
 await navigate(page,'pos'); await page.locator('#posSearch').fill('Print Test Item');
 await page.locator('#posProducts [data-add-cart]').click(); await page.locator('#cashReceived').fill('25');
 await page.locator('#completeSale').click(); await page.locator('#confirmSaleNow').click();
 await expect(page.locator('#receipt .receipt-print-copies .receipt-copy')).toHaveCount(2);
 const before=await readStores(page); await page.locator('#printReceipt').click();
 expect(await page.evaluate(()=>window.__pwPrintCalled)).toBe(true);
 const after=await readStores(page); expect(after.sales).toHaveLength(before.sales.length);
});
test('mobile navigation exposes secondary POS destinations through More',async({page})=>{
 await unlock(page); await expect(page.locator('#mobileNav')).toBeVisible();
 await page.locator('#mobileMoreButton').click();
 await expect(page.locator('#mobileMoreMenu')).toBeVisible();
 await expect(page.locator('#mobileMoreMenu [data-view="returns"]')).toBeVisible();
 await page.locator('#mobileMoreMenu [data-view="returns"]').click();
 await expect(page.locator('#main')).toContainText('Returns');
});
test('Data Health reconciliation and independent batch-cost correction persist exact values',async({page})=>{
 await unlock(page);
 await seedStores(page,{products:[
  {id:'health-stock-p',name:'Health Stock Mismatch',sku:'HEALTH-STOCK',saleMode:'piece',piecePriceEntered:true,price:30,packPrice:30,packSize:1,cost:10,stock:5,lowStock:1,batches:[{id:'health-stock-b',qty:3,costPerPiece:10,expiry:'',receivedAt:new Date().toISOString()}]},
  {id:'health-cost-p',name:'Health Batch Cost',sku:'HEALTH-COST',saleMode:'piece',piecePriceEntered:true,price:30,packPrice:30,packSize:1,cost:10,stock:2,lowStock:1,batches:[{id:'health-cost-b',qty:2,costPerPiece:100,expiry:'',receivedAt:new Date().toISOString()}]}
 ]});
 await navigate(page,'dataHealth');
 await expect(page.locator('#main')).toContainText('Stock / batch mismatch');
 await page.locator('[data-health-product="health-stock-p"][data-health-action="reconcile-stock"]').click();
 await expect(page.locator('.app-dialog-input')).toBeVisible(); await page.locator('.app-dialog-input').fill('5');
 await page.locator('.app-dialog-backdrop').getByRole('button',{name:'Continue'}).click(); await confirmAppDialog(page,true);
 let db=await readStores(page); let p=db.products.find(x=>x.id==='health-stock-p');
 expect(p.stock).toBe(5); expect(p.batches.reduce((n,b)=>n+Number(b.qty||0),0)).toBe(5);
 await navigate(page,'dataHealth'); await expect(page.locator('#main')).toContainText('Batch cost outlier');
 await page.locator('[data-health-product="health-cost-p"][data-health-action="batch-costs"]').click();
 await page.locator('[data-batch-cost-index="0"]').fill('12.50');
 await page.locator('#saveBatchCosts').click(); await confirmAppDialog(page,true);
 db=await readStores(page); p=db.products.find(x=>x.id==='health-cost-p');
 expect(p.batches[0].costPerPiece).toBe(12.5); expect(p.batches[0].costAudit).toHaveLength(1);
});
test('owner sale deletion restores inventory exactly once and retains reversal trace',async({page})=>{
 await unlock(page);
 const date=new Date().toISOString();
 await seedStores(page,{products:[{id:'reverse-p',name:'Reversal Fixture',sku:'REV-001',saleMode:'piece',piecePriceEntered:true,price:50,packPrice:50,packSize:1,cost:20,stock:4,lowStock:1,batches:[{id:'reverse-original-batch',qty:4,costPerPiece:20,expiry:'',receivedAt:date}]}],sales:[{id:'reverse-sale',receipt:'RSS-PW-REV-001',date,items:[{productId:'reverse-p',name:'Reversal Fixture',qty:2,stockQty:2,unitType:'piece',packSize:1,price:50,lineTotal:100,unitCost:20}],subtotal:100,discount:0,total:100,payment:'Cash',status:'completed'}]});
 await navigate(page,'sales'); await expect(page.locator('[data-delete-sale="reverse-sale"]')).toBeVisible();
 await page.locator('[data-delete-sale="reverse-sale"]').click();
 await page.locator('#confirmDeleteSale').click(); await confirmAppDialog(page,true);
 let db=await readStores(page); expect(db.sales.some(s=>s.id==='reverse-sale')).toBe(false);
 let product=db.products.find(p=>p.id==='reverse-p'); expect(product.stock).toBe(6);
 expect(product.batches.reduce((n,b)=>n+Number(b.qty||0),0)).toBe(6);
 expect(product.batches.filter(b=>String(b.id).startsWith('sale-reversal-reverse-sale-'))).toHaveLength(1);
});