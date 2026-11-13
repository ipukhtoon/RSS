'use strict';
const { defineConfig, devices } = require('@playwright/test');
module.exports = defineConfig({
 testDir:'./tests/e2e', fullyParallel:false, forbidOnly:!!process.env.CI,
 retries:process.env.CI?1:0, workers:process.env.CI?1:undefined,
 reporter:process.env.CI?[['list'],['html',{outputFolder:'playwright-report',open:'never'}],['junit',{outputFile:'test-results/e2e-junit.xml'}]]:[['list'],['html',{outputFolder:'playwright-report',open:'never'}]],
 timeout:30000, expect:{timeout:8000},
 use:{baseURL:'http://127.0.0.1:4173',trace:'retain-on-failure',screenshot:'only-on-failure',video:'retain-on-failure',actionTimeout:10000},
 projects:[{name:'chromium-desktop',use:{...devices['Desktop Chrome'],viewport:{width:1440,height:1000}}},{name:'chromium-mobile',use:{...devices['Pixel 7'],defaultBrowserType:'chromium'}}],
 webServer:{command:'node tests/e2e/server.cjs',url:'http://127.0.0.1:4173',reuseExistingServer:!process.env.CI,timeout:15000}
});
