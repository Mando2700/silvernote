import { expect, test } from '@playwright/test';

const PAGES = [
  { path: '/', heading: null },
  { path: '/terminal', heading: 'Terminal' },
  { path: '/explorer', heading: 'Market explorer' },
  { path: '/macro', heading: 'Macro' },
  { path: '/calendar', heading: 'Calendar' },
  { path: '/news', heading: 'News' },
  { path: '/watchlists', heading: 'Watchlists' },
  { path: '/portfolio', heading: 'Portfolio' },
  { path: '/journal', heading: 'Decision journal' },
  { path: '/lab', heading: 'Research lab' },
  { path: '/notes', heading: null },
  { path: '/backtest', heading: 'Backtest' },
  { path: '/learn', heading: 'Learn' },
  { path: '/settings', heading: 'Settings' },
  { path: '/company/AAPL', heading: null },
];

for (const page of PAGES) {
  test(`${page.path} renders cleanly`, async ({ page: browser }) => {
    const errors: string[] = [];
    browser.on('pageerror', (error) => errors.push(error.message));
    browser.on('console', (message) => {
      // Network failures of third-party logos and hydration noise from extensions are not app errors.
      if (message.type() === 'error' && !/Failed to load resource|favicon|logo/i.test(message.text())) errors.push(message.text());
    });
    const response = await browser.goto(page.path, { waitUntil: 'domcontentloaded' });
    expect(response?.status(), 'HTTP status').toBeLessThan(400);
    if (page.heading) await expect(browser.getByRole('heading', { level: 1, name: page.heading })).toBeVisible({ timeout: 30_000 });
    else await expect(browser.locator('main')).toBeVisible();
    await browser.waitForTimeout(1500);
    // No horizontal page scroll at any width (the mobile regression from the audit).
    const overflow = await browser.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, 'horizontal overflow in px').toBeLessThanOrEqual(1);
    expect(errors, errors.join('\n')).toEqual([]);
  });
}

test('command line routes NVDA FA to financials', async ({ page }) => {
  await page.goto('/explorer');
  await page.keyboard.press('/');
  await page.getByPlaceholder(/Ticker, page or command/).fill('NVDA FA');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/company\/NVDA\?tab=financials/, { timeout: 30_000 });
});
