'use strict';
const { expect } = require('@playwright/test');
async function unlock(page, pin='9999') {
 await page.goto('/');
 const modal=page.locator('#pinBackdrop'); await expect(modal).toBeVisible();
 for (const digit of pin) await modal.locator(`[data-pin-key="${digit}"]`).click();
 await expect(modal).toHaveCount(0,{timeout:10000});
 await expect(page.locator('#main')).not.toContainText('Starting Ronyal Super Store POS');
}
async function navigate(page, view) {
 const nav=page.locator('#sideNav');
 if (await nav.isVisible()) { await nav.locator(`[data-view="${view}"]`).click(); }
 else { await page.locator('#mobileMoreButton').click(); await page.locator(`#mobileMoreMenu [data-view="${view}"]`).click(); }
 await page.waitForTimeout(120);
}
async function readStores(page, names=['products','sales','expenses','customers','suppliers','purchases','creditPayments','returns']) {
 return page.evaluate(async names=>{const req=indexedDB.open('ronyal_super_store_db');const db=await new Promise((resolve,reject)=>{req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)});const tx=db.transaction(names,'readonly');const values={};await Promise.all(names.map(name=>new Promise((resolve,reject)=>{const r=tx.objectStore(name).getAll();r.onsuccess=()=>{values[name]=r.result;resolve()};r.onerror=()=>reject(r.error)})));await new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error)});db.close();return values},names);
}
async function seedStores(page, records) {
 await page.evaluate(async records=>{const names=Object.keys(records),req=indexedDB.open('ronyal_super_store_db');const db=await new Promise((resolve,reject)=>{req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)});await new Promise((resolve,reject)=>{const tx=db.transaction(names,'readwrite');for(const name of names){const os=tx.objectStore(name);for(const row of records[name])os.put(row)}tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error)});db.close()},records);
}
async function confirmAppDialog(page, accept=true) {
 const dialog=page.locator('.app-dialog-backdrop'); await expect(dialog).toBeVisible();
 await dialog.getByRole('button',{name:accept?'Confirm':'Cancel',exact:true}).click();
}
module.exports={unlock,navigate,readStores,seedStores,confirmAppDialog};