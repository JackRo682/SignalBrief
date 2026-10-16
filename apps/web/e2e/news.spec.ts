import {test, expect} from '@playwright/test';

test('public news keeps source navigation available when the external widget fails', async ({page}) => {
  await page.route('https://s3.tradingview.com/external-embedding/embed-widget-timeline.js', route => route.abort());
  await page.goto('/news');
  await expect(page.getByRole('heading', {name: '주요 뉴스', exact: true, level: 1})).toBeVisible();
  await expect(page.getByRole('button', {name: '다시 시도'})).toBeVisible();
  await expect(page.getByRole('link', {name: 'TradingView에서 모든 뉴스 확인'})).toHaveAttribute('href', 'https://kr.tradingview.com/news/');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', {name: '다시 시도'}).click();
  await expect(page.getByRole('button', {name: '다시 시도'})).toBeVisible();
});
