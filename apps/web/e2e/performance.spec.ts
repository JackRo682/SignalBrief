import { test, expect, type Page } from '@playwright/test';
import {companyId, eventId, events, mobileFixture} from './mobile-fixture';

async function verifyMobileProgressiveNavigation(page: Page, summaryOnly: boolean) {
  const fixture = await mobileFixture(page, {summaryOnly}), navigationDocuments: string[] = [], completedRequests: string[] = [];
  let release!: () => void, holdSecondary = true, pendingPortfolio = false;
  const delayed = new Promise<void>(resolve => {release = resolve;});
  page.on('request', request => {if (request.isNavigationRequest() && request.frame() === page.mainFrame()) navigationDocuments.push(request.url());});
  page.on('requestfinished', request => {completedRequests.push(new URL(request.url()).pathname.replace(/^\/api/, ''));});
  // Next dev replays effects in Strict Mode. The first effect cancels its request;
  // a delayed fixture must not turn that cancelled request into another API read.
  await page.route('**/v1/portfolio', async route => {if (holdSecondary) {pendingPortfolio = true; await delayed;} if (route.request().failure()?.errorText === 'net::ERR_ABORTED') {await route.abort('aborted'); return;} await route.fallback();});
  await page.route('**/api/market?**', async route => {if (holdSecondary) await delayed; if (route.request().failure()?.errorText === 'net::ERR_ABORTED') {await route.abort('aborted'); return;} await route.fallback();});
  await page.goto('/today');
  const main = page.locator('main#mobile-main');
  await expect(page.locator('.m-event-card')).toHaveCount(4);
  await expect(page.locator('.m-event-card').first()).toContainText(events[0].headline);
  await expect(page.locator('.m-event-card').first()).toContainText(summaryOnly ? events[0].what_happened : events[0].fact_summary!);
  await expect.poll(() => pendingPortfolio).toBe(true);
  expect(fixture.state.apiCalls.filter(call => call.path === '/v1/portfolio')).toHaveLength(0);
  expect(fixture.state.apiCalls.some(call => call.path.startsWith('/v1/events/'))).toBe(false);
  holdSecondary = false; release();
  await expect.poll(() => fixture.state.apiCalls.filter(call => call.path === '/v1/portfolio').length).toBe(1);
  await expect.poll(() => completedRequests.filter(path => path === '/v1/portfolio').length).toBe(1);
  await expect(page.locator('.m-loading')).toHaveCount(0);
  const initialDocuments = navigationDocuments.length;
  const initialWatchReads = fixture.state.apiCalls.filter(call => call.path === '/v1/watchlist').length;
  await page.evaluate(() => {(window as Window & {__navigationMarker?: string}).__navigationMarker = 'retained';});
  const footer = page.getByRole('navigation', {name: '모바일 메뉴', exact: true});
  for (const [label, heading] of [['포트폴리오', '포트폴리오'], ['관심종목', '관심종목'], ['홈', '오늘의 변화']]) {
    await footer.getByRole('link', {name: label, exact: true}).click();
    await expect(main.getByRole('heading', {level: 1})).toContainText(heading);
    await expect(page.locator('.referenceGate')).toHaveCount(0);
  }
  await main.getByRole('navigation', {name: '바로가기', exact: true}).getByRole('link', {name: '캘린더', exact: true}).click();
  await expect(main.getByRole('heading', {level: 1})).toHaveText('캘린더');
  await expect(page.locator('.m-calendar-item')).toHaveCount(3);
  await footer.getByRole('link', {name: '홈', exact: true}).click();
  await main.getByRole('navigation', {name: '바로가기', exact: true}).getByRole('link', {name: '기업 타임라인', exact: true}).click();
  await expect(main.getByRole('heading', {level: 1})).toHaveText('기업 타임라인');
  await page.getByRole('combobox', {name: '타임라인 기업 선택', exact: true}).selectOption(companyId);
  await expect(page.locator('.m-timeline-item')).toHaveCount(3);
  await expect(page.locator('.m-timeline-item').first().getByRole('link', {name: 'SEC', exact: true})).toHaveAttribute('href', events[0].source_url);
  expect(navigationDocuments).toHaveLength(initialDocuments);
  expect(await page.evaluate(() => (window as Window & {__navigationMarker?: string}).__navigationMarker)).toBe('retained');
  expect(fixture.state.apiCalls.filter(call => call.path === '/v1/config')).toHaveLength(1);
  expect(fixture.state.apiCalls.filter(call => call.method === 'GET' && call.path === '/v1/me')).toHaveLength(1);
  expect(fixture.state.apiCalls.filter(call => call.method === 'PATCH' && call.path === '/v1/me')).toHaveLength(0);
  // Mobile hooks refresh owned collections on mount; auth remains shared across routes.
  expect(fixture.state.apiCalls.filter(call => call.path === '/v1/watchlist').length).toBeGreaterThan(initialWatchReads);
  expect(fixture.state.apiCalls.some(call => call.path.startsWith('/v1/events/'))).toBe(false);
  await page.locator('.m-timeline-item').first().getByRole('link').first().click();
  await expect(page).toHaveURL(new RegExp(`/events/${eventId}$`));
  await expect(main).toContainText(events[0].interpretation!);
  await page.getByRole('button', {name: /원문 인용 보기/}).click();
  await expect(page.locator('#mobile-event-evidence blockquote')).toHaveCount(4);
  await expect(page.locator('#mobile-event-evidence')).toContainText('Synthetic fixture: Revenue was USD 45,000 million');
  await expect.poll(() => completedRequests.filter(path => path === `/v1/events/${eventId}`).length).toBe(1);
  expect(navigationDocuments).toHaveLength(initialDocuments);
  expect(fixture.state.unexpected).toEqual([]);
  expect(fixture.state.runtimeErrors).toEqual([]);
  await expect(main.getByRole('alert')).toHaveCount(0);
}

async function verifyDesktopProgressiveNavigation(page: Page, summaryOnly: boolean) {
  const fixture = await mobileFixture(page, {summaryOnly}), navigationDocuments: string[] = [], completedRequests: string[] = [];
  let release!: () => void, holdSecondary = true, pendingPortfolio = false;
  const delayed = new Promise<void>(resolve => {release = resolve;});
  page.on('request', request => {if (request.isNavigationRequest() && request.frame() === page.mainFrame()) navigationDocuments.push(request.url());});
  page.on('requestfinished', request => {completedRequests.push(new URL(request.url()).pathname.replace(/^\/api/, ''));});
  await page.route('**/v1/portfolio', async route => {if (holdSecondary) {pendingPortfolio = true; await delayed;} if (route.request().failure()?.errorText === 'net::ERR_ABORTED') {await route.abort('aborted'); return;} await route.fallback();});
  await page.route('**/api/market?**', async route => {if (holdSecondary) await delayed; if (route.request().failure()?.errorText === 'net::ERR_ABORTED') {await route.abort('aborted'); return;} await route.fallback();});
  await page.goto('/today');
  await expect(page.locator('.pc-today-change')).toHaveCount(5);
  await expect(page.locator('.pc-today-change').first()).toContainText(events[0].headline);
  await expect(page.locator('.pc-today-change').first()).toContainText(events[0].what_happened);
  await expect.poll(() => pendingPortfolio).toBe(true);
  expect(fixture.state.apiCalls.filter(call => call.path === '/v1/portfolio')).toHaveLength(0);
  expect(fixture.state.apiCalls.some(call => call.path.startsWith('/v1/events/'))).toBe(false);
  holdSecondary = false; release();
  await expect.poll(() => fixture.state.apiCalls.filter(call => call.path === '/v1/portfolio').length).toBe(1);
  await expect.poll(() => completedRequests.filter(path => path === '/v1/portfolio').length).toBe(1);
  await expect(page.locator('.pc-today-summary').first()).toContainText('보유4');
  await expect(page.locator('.pc-loading')).toHaveCount(0);
  const initialDocuments = navigationDocuments.length;
  const initialWatchReads = fixture.state.apiCalls.filter(call => call.path === '/v1/watchlist').length;
  await page.evaluate(() => {(window as Window & {__navigationMarker?: string}).__navigationMarker = 'retained';});
  // The new PC pages and retained portfolio/calendar controller share the same
  // AuthProvider and keep navigation client-side across the layout boundary.
  await page.getByRole('navigation', {name:'주 메뉴',exact:true}).getByRole('link', {name:'포트폴리오',exact:true}).click();
  await expect(page.locator('[data-screen="setup"]')).toBeVisible();
  await page.locator('.nav [data-route="calendar"]').click();
  await expect(page.locator('[data-screen="calendar"]')).toBeVisible();
  // Calendar intentionally resolves its linked events for company/type filters.
  // Account for exactly those reads before checking that later feed/timeline
  // navigation performs no extra event-detail requests.
  const calendarDetailPaths = [...new Set(fixture.state.calendar.map(item => item.event_id).filter(Boolean))]
    .map(id => `/v1/events/${id}`).sort();
  const detailReads = () => fixture.state.apiCalls.filter(call => call.method === 'GET' && call.path.startsWith('/v1/events/')).map(call => call.path).sort();
  await expect(page.locator('#calendar .calGrid')).toBeVisible();
  await expect.poll(detailReads).toEqual(calendarDetailPaths);
  await expect.poll(() => completedRequests.filter(path => path.startsWith('/v1/events/')).sort()).toEqual(calendarDetailPaths);
  await page.locator('.nav [data-route="watch"]').click();
  await expect(page.locator('.pc-watch-table tbody tr')).toHaveCount(4);
  await page.getByRole('navigation', {name:'주 메뉴',exact:true}).getByRole('link', {name:'홈',exact:true}).click();
  await expect(page.locator('.pc-today-change')).toHaveCount(5);
  await page.getByRole('navigation', {name:'주 메뉴',exact:true}).getByRole('link', {name:'기업 타임라인',exact:true}).click();
  await page.getByRole('combobox', {name:'타임라인 기업 선택',exact:true}).selectOption(companyId);
  await expect(page.locator('.pc-timeline-item')).toHaveCount(3);
  await expect(page.locator('.pc-timeline-item').first()).toContainText(events[0].what_happened);
  await expect(page.locator('.pc-timeline-item').first().getByRole('link', {name:'SEC',exact:true})).toHaveAttribute('href', events[0].source_url);
  expect(navigationDocuments).toHaveLength(initialDocuments);
  expect(await page.evaluate(() => (window as Window & {__navigationMarker?: string}).__navigationMarker)).toBe('retained');
  expect(fixture.state.apiCalls.filter(call => call.path === '/v1/config')).toHaveLength(1);
  expect(fixture.state.apiCalls.filter(call => call.method === 'GET' && call.path === '/v1/me')).toHaveLength(1);
  expect(fixture.state.apiCalls.filter(call => call.method === 'PATCH' && call.path === '/v1/me')).toHaveLength(0);
  expect(initialWatchReads).toBe(1);
  expect(fixture.state.apiCalls.filter(call => call.path === '/v1/watchlist')).toHaveLength(1);
  expect(detailReads()).toEqual(calendarDetailPaths);
  await page.locator('.pc-timeline-event-title').first().click();
  await expect(page).toHaveURL(new RegExp(`/events/${eventId}$`));
  await expect(page.locator('.pc-event')).toContainText(events[0].interpretation!);
  await page.getByRole('link', {name:'근거 전체 보기',exact:true}).click();
  await expect(page.locator('.pc-evidence-source-quote blockquote')).toHaveCount(4);
  await expect(page.locator('.pc-evidence-source')).toContainText('Synthetic fixture: Revenue was USD 45,000 million');
  await expect.poll(() => completedRequests.filter(path => path === `/v1/events/${eventId}`).length).toBe(calendarDetailPaths.filter(path => path === `/v1/events/${eventId}`).length + 1);
  expect(detailReads()).toEqual([...calendarDetailPaths, `/v1/events/${eventId}`].sort());
  expect(navigationDocuments).toHaveLength(initialDocuments);
  expect(fixture.state.unexpected).toEqual([]);
  expect(fixture.state.runtimeErrors).toEqual([]);
  await expect(page.locator('#pc-main').getByRole('alert')).toHaveCount(0);
}

// Full typed fixtures exercise both complete and nullable feed summaries. Event
// facts are fetched on demand; the existing mobile checks above stay unchanged.
for (const legacy of [false, true]) {
 test(`menu transitions retain auth and progressively render ${legacy ? 'legacy' : 'compact'} responses`, async ({page}) => {
  if(test.info().project.name === 'mobile') await verifyMobileProgressiveNavigation(page, legacy);
  else await verifyDesktopProgressiveNavigation(page, legacy);
 });
}
