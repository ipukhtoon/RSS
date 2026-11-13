'use strict';
const {test,expect}=require('@playwright/test');
test.beforeEach(async({page})=>{await page.route('https://www.gstatic.com/**',route=>route.abort());});
test('POS document loads, opens IndexedDB and presents the PIN lock screen',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/'); await expect(page).toHaveTitle(/Ronyal Super Store/i);
 await expect(page.locator('.app')).toBeVisible(); await expect(page.locator('#main')).toBeVisible();
 await expect(page.locator('#overlay')).toBeAttached(); await expect(page.locator('#pinBackdrop')).toBeVisible();
 await expect(page.locator('#pinTitle')).toContainText('Ronyal POS Locked');
 expect(errors,'uncaught browser errors').toEqual([]);
});
test('fresh profile creates all expected local POS database stores',async({page})=>{
 await page.goto('/'); await expect(page.locator('#pinBackdrop')).toBeVisible();
 const info=await page.evaluate(async()=>{const req=indexedDB.open('ronyal_super_store_db');return await new Promise((resolve,reject)=>{req.onsuccess=()=>{const db=req.result,stores=Array.from(db.objectStoreNames).sort(),version=db.version;db.close();resolve({version,stores})};req.onerror=()=>reject(req.error);req.onblocked=()=>reject(new Error('IndexedDB open blocked'))})});
 expect(info.version).toBeGreaterThanOrEqual(1);
 for(const name of ['products','sales','expenses','customers','suppliers','purchases','creditPayments','returns'])expect(info.stores).toContain(name);
});
test('desktop and mobile navigation containers and lock control exist',async({page})=>{
 await page.goto('/'); await expect(page.locator('#pinBackdrop')).toBeVisible();
 await expect(page.locator('#sideNav')).toBeAttached(); await expect(page.locator('#mobileNav')).toBeAttached();
 await expect(page.locator('#lockPosButton')).toBeAttached();
});