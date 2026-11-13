'use strict';
const {test,expect}=require('@playwright/test');
const {unlock,navigate,readStores,seedStores,confirmAppDialog}=require('./helpers.cjs');
test.beforeEach(async({page})=>{await page.route('https://www.gstatic.com/**',route=>route.abort());});

test('duplicate-ID batches keep independent cost edits and audit trails',async({page})=>{
 await unlock(page);
 await seedStores(page,{products:[{id:'dup-cost-p',name:'Duplicate Batch Cost Fixture',sku:'DUP-COST',saleMode:'piece',piecePriceEntered:true,price:40,packPrice:40,packSize:1,cost:10,stock:5,lowStock:1,batches:[
  {id:'same-batch-id',qty:2,costPerPiece:10,expiry:'',receivedAt:'2026-01-01T00:00:00.000Z'},
  {id:'same-batch-id',qty:3,costPerPiece:20,expiry:'',receivedAt:'2026-02-01T00:00:00.000Z'}
 ]}]});
 await navigate(page,'products'); await page.locator('#productSearch').fill('Duplicate Batch Cost Fixture');
 await page.locator('[data-edit-batch-costs="dup-cost-p"]').click();
 await page.locator('[data-batch-cost-index="0"]').fill('12.50');
 await page.locator('[data-batch-cost-index="1"]').fill('25.75');
 await page.locator('#saveBatchCosts').click(); await confirmAppDialog(page,true);
 await expect(page.locator('#overlay .modal-back')).toHaveCount(0);
 const db=await readStores(page),p=db.products.find(x=>x.id==='dup-cost-p');
 expect(p.batches).toHaveLength(2); expect(p.batches[0].costPerPiece).toBe(12.5); expect(p.batches[1].costPerPiece).toBe(25.75);
 expect(p.batches[0].costAudit.at(-1).previousCostPerPiece).toBe(10); expect(p.batches[1].costAudit.at(-1).previousCostPerPiece).toBe(20);
});

test('Udhaar cash return reduces outstanding balance after a partial repayment',async({page})=>{
 await unlock(page);
 const old=new Date(Date.now()-86400000).toISOString(),now=new Date().toISOString();
 await seedStores(page,{
  products:[{id:'credit-return-p',name:'Credit Return Fixture',sku:'CR-RETURN',saleMode:'piece',piecePriceEntered:true,price:50,packPrice:50,packSize:1,cost:10,stock:2,lowStock:1,batches:[{id:'credit-return-b',qty:2,costPerPiece:10,expiry:'',receivedAt:old}]}],
  customers:[{id:'credit-return-c',name:'Credit Return Customer',phone:'03000000004',createdAt:old}],
  sales:[{id:'credit-return-sale',receipt:'RSS-PW-CREDIT-RETURN',date:old,customerId:'credit-return-c',customerName:'Credit Return Customer',customerPhone:'03000000004',items:[{productId:'credit-return-p',name:'Credit Return Fixture',qty:2,stockQty:2,unitType:'piece',packSize:1,price:50,lineTotal:100,unitCost:10}],subtotal:100,discount:0,total:100,payment:'Borrow',initialPaymentAmount:20,creditOutstanding:80,status:'completed'}],
  creditPayments:[{id:'credit-return-payment',customerId:'credit-return-c',customerName:'Credit Return Customer',amount:10,date:now,method:'Cash'}]
 });
 await navigate(page,'returns'); await page.locator('#returnSaleSearch').fill('RSS-PW-CREDIT-RETURN');
 await page.locator('[data-return-sale="credit-return-sale"]').first().evaluate(el=>el.click());
 await page.locator('#returnItemForm [data-return-index="0"]').fill('1');
 await page.locator('#returnRefundMethod').selectOption('Cash');
 await page.locator('#confirmReturn').click(); await confirmAppDialog(page,true);
 await expect(page.locator('#overlay .modal-back')).toHaveCount(0);
 const db=await readStores(page),ret=db.returns.find(x=>x.saleId==='credit-return-sale');
 expect(ret.creditAdjustment).toBe(50); expect(db.products.find(x=>x.id==='credit-return-p').stock).toBe(3);
 await navigate(page,'credit'); await expect(page.locator('#creditCustomerList')).toContainText('Credit Return Customer');
 await expect(page.locator('#creditCustomerList')).toContainText('Rs 20.00');
});

test('historical sale cost is immutable after remaining batch cost correction',async({page})=>{
 await unlock(page); const date=new Date().toISOString();
 await seedStores(page,{
  products:[{id:'history-cost-p',name:'Historical Cost Fixture',sku:'HIST-COST',saleMode:'piece',piecePriceEntered:true,price:50,packPrice:50,packSize:1,cost:10,stock:1,lowStock:1,batches:[{id:'history-cost-b',qty:1,costPerPiece:10,expiry:'',receivedAt:date}]}],
  sales:[{id:'history-cost-sale',receipt:'RSS-PW-HIST-COST',date,items:[{productId:'history-cost-p',name:'Historical Cost Fixture',qty:2,stockQty:2,unitType:'piece',packSize:1,price:50,lineTotal:100,unitCost:10}],subtotal:100,discount:0,total:100,payment:'Cash',status:'completed'}],
  returns:[{id:'history-cost-return',saleId:'history-cost-sale',receipt:'RSS-PW-HIST-COST',date,items:[{saleItemIndex:0,productId:'history-cost-p',name:'Historical Cost Fixture',qty:1,unitRefund:50,lineRefund:50,stockQty:1,unitCost:10}],refundTotal:50,refundMethod:'Cash'}]
 });
 await navigate(page,'products'); await page.locator('#productSearch').fill('Historical Cost Fixture');
 await page.locator('[data-edit-batch-costs="history-cost-p"]').click();
 await page.locator('[data-batch-cost-index="0"]').fill('99');
 await page.locator('#saveBatchCosts').click(); await confirmAppDialog(page,true);
 const db=await readStores(page);
 expect(db.products.find(x=>x.id==='history-cost-p').batches[0].costPerPiece).toBe(99);
 expect(db.sales.find(x=>x.id==='history-cost-sale').items[0].unitCost).toBe(10);
});

test('legacy product without batch records remains sellable and is migrated on checkout',async({page})=>{
 await unlock(page);
 await seedStores(page,{products:[{id:'legacy-batch-p',name:'Legacy Batch Fixture',sku:'LEGACY-BATCH',saleMode:'piece',piecePriceEntered:true,price:20,packPrice:20,packSize:1,cost:7,stock:3,expiry:'',updatedAt:new Date().toISOString()}]});
 await navigate(page,'pos'); await page.locator('#posSearch').fill('Legacy Batch Fixture');
 await page.locator('#posProducts [data-add-cart]').click(); await page.locator('#cashReceived').fill('20');
 await page.locator('#completeSale').click(); await page.locator('#confirmSaleNow').click(); await expect(page.locator('#receipt')).toBeVisible();
 const db=await readStores(page),p=db.products.find(x=>x.id==='legacy-batch-p');
 expect(p.stock).toBe(2); expect(p.batches.length).toBeGreaterThan(0);
 expect(p.batches.reduce((n,b)=>n+Number(b.qty||0),0)).toBe(2);
 expect(db.sales.find(x=>x.items.some(i=>i.productId==='legacy-batch-p')).items[0].unitCost).toBe(7);
});

test('Data Health rejects fractional physical counts without changing inventory',async({page})=>{
 await unlock(page);
 await seedStores(page,{products:[{id:'count-validation-p',name:'Count Validation Fixture',sku:'COUNT-VALID',saleMode:'piece',piecePriceEntered:true,price:30,packPrice:30,packSize:1,cost:10,stock:5,lowStock:1,batches:[{id:'count-validation-b',qty:3,costPerPiece:10,expiry:'',receivedAt:new Date().toISOString()}]}]});
 await navigate(page,'dataHealth');
 await page.locator('[data-health-product="count-validation-p"][data-health-action="reconcile-stock"]').click();
 await page.locator('.app-dialog-input').fill('2.5');
 await page.locator('.app-dialog-backdrop').getByRole('button',{name:'Continue'}).click();
 await expect(page.locator('#toast')).toContainText('Enter a whole number');
 const db=await readStores(page);
 expect(db.products.find(x=>x.id==='count-validation-p').stock).toBe(5);
 expect(db.products.find(x=>x.id==='count-validation-p').batches[0].qty).toBe(3);
});
