import { expect, test, type Page } from '@playwright/test';
import { fixtureNow } from './mobile-fixture';
import { approved, researchWorkspaceFixture, type ResearchFixture } from './research-workspace-fixture';

// Isolated synthetic browser fixtures only. Never run this suite against production.
async function fitsViewport(page: Page) {
  await expect.poll(() => page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )).toBeLessThanOrEqual(1);
}
function clean(fixture: ResearchFixture) {
  expect(fixture.blockedRequests).toEqual([]);
  expect(fixture.state.unexpected).toEqual([]);
  expect(fixture.state.runtimeErrors).toEqual([]);
  expect(fixture.state.apiCalls.filter(call => call.method !== 'GET')).toEqual([]);
}

test('homepage A remains unchanged and ordinary users cannot select a preview', async ({ page }) => {
  const fixture = await researchWorkspaceFixture(page, { following: true });
  await page.clock.setFixedTime(new Date(fixtureNow));
  await page.goto('/today');
  const marker = page.locator('[data-home-experiment]');
  await expect(marker).toHaveAttribute('data-home-variant', 'A');
  await expect(page.locator('.rd-main > .rd-home')).toBeVisible();
  await expect(page.locator('[data-screen="redesign-home"]')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'B 미리보기' })).toHaveCount(0);
  await page.reload();
  await expect(marker).toHaveAttribute('data-home-variant', 'A');
  await page.goto('/today?home_preview=B');
  await expect(marker).toHaveAttribute('data-home-variant', 'A');
  await expect(marker).toHaveAttribute('data-home-preview', 'false');
  await expect(page.locator('.sb-home-b')).toHaveCount(0);
  await fitsViewport(page);
  clean(fixture);
});

test('administrator can compare both real layouts, use B controls, and return to assignment', async ({ page }, testInfo) => {
  const fixture = await researchWorkspaceFixture(page, { following: true });
  fixture.state.profile.is_admin = true;
  await page.clock.setFixedTime(new Date(fixtureNow));
  await page.goto('/today?home_preview=A&keep=1');
  const marker = page.locator('[data-home-experiment]');
  await expect(marker).toHaveAttribute('data-home-variant', 'A');
  await expect(page.locator('.rd-home-following .rd-home-update')).toHaveCount(3);
  await expect(page.getByRole('heading', { name: '관심 기업 1곳의 주요 소식을 모았습니다.', exact: true })).toBeVisible();
  await fitsViewport(page);
  await testInfo.attach(`home-A-${testInfo.project.name}`, {
    body: await page.screenshot({ fullPage: true }), contentType: 'image/png',
  });

  await page.getByRole('button', { name: 'B 미리보기', exact: true }).click();
  await expect(marker).toHaveAttribute('data-home-variant', 'B');
  await expect(marker).toHaveAttribute('data-home-preview', 'true');
  await expect(page.locator('.sb-home-b .rd-home-search')).toBeVisible();
  await expect(page.locator('[data-screen="redesign-home"]')).toHaveCount(1);
  await expect(page.locator('.rd-home-following .rd-home-update')).toHaveCount(3);
  await expect(page.getByRole('link', { name: /저장한 자료/ })).toHaveAttribute('href', '/saved');
  await fitsViewport(page);
  await testInfo.attach(`home-B-${testInfo.project.name}`, {
    body: await page.screenshot({ fullPage: true }), contentType: 'image/png',
  });
  await page.getByRole('tab', { name: '분석', exact: true }).click();
  await expect(page.locator('#home-activity-panel .rd-home-col-title')).toContainText(approved.title);
  await page.getByRole('button', { name: '조회 설정', exact: true }).click();
  await expect(page.locator('#home-filters')).toBeVisible();
  await fitsViewport(page);
  await page.getByRole('button', { name: '조회 설정', exact: true }).click();
  await page.getByRole('button', { name: '자동 배정', exact: true }).click();
  await expect(marker).toHaveAttribute('data-home-variant', 'A');
  await expect(marker).toHaveAttribute('data-home-preview', 'false');
  await expect(page).toHaveURL(/\/today\?keep=1$/);
  await expect(page.locator('.rd-main > .rd-home')).toBeVisible();
  clean(fixture);
});

test('B fits a narrow viewport and preserves genuine empty and retry states', async ({ page }) => {
  const fixture = await researchWorkspaceFixture(page, { emptyContent: true, newsError: true });
  fixture.state.profile.is_admin = true;
  await page.clock.setFixedTime(new Date(fixtureNow));
  await page.setViewportSize({ width: 320, height: 780 });
  await page.goto('/today?home_preview=B');
  await expect(page.locator('[data-home-experiment]')).toHaveAttribute('data-home-variant', 'B');
  await expect(page.locator('.rd-home-following')).toContainText('관심 기업을 추가하면');
  await expect(page.locator('#news .ws-error')).toBeVisible();
  await page.getByRole('button', { name: '조회 설정', exact: true }).click();
  await fitsViewport(page);
  fixture.control.newsError = false;
  await page.locator('#news .ws-error button').click();
  await expect(page.locator('#news .ws-error')).toHaveCount(0);
  await expect(page.locator('#home-activity-panel .rd-home-col-title')).toContainText('Synthetic company news article');
  await fitsViewport(page);
  clean(fixture);
});
