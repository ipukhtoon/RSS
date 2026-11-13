const { test, expect } = require('@playwright/test');

test('POS loads and renders its main application shell', async ({ page }) => {
  const uncaughtErrors = [];
  page.on('pageerror', error => uncaughtErrors.push(error.message));

  await page.goto('/');
  await expect(page).toHaveTitle('Ronyal Super Store');
  await expect(page.locator('.app')).toBeVisible();
  await expect(page.locator('.top h1')).toHaveText('Ronyal Super Store');

  // Allow the app's startup and local database initialization to complete.
  await page.waitForTimeout(3000);

  expect(uncaughtErrors, 'Uncaught browser JavaScript errors').toEqual([]);
});
