import { test, expect, type Page } from '@playwright/test';
import {companyId, eventId, events, mobileFixture} from './mobile-fixture';

async function verifyMobileProgressiveNavigation(page: Page, summaryOnly: boolean) {
  const fixture = await mobileFixture(page, {summaryOnly}), navigationDocuments: string[] = [];
  let release!: () => void, holdSecondary = true, pendingPortfolio = false;
  const delayed = new Promise<void>(resolve => {release = resolve;});
  page.on('request', request => {if (request.isNavigationRequest() && request.frame() === page.mainFrame()) navigationDocuments.push(request.url());});
  await page.route('**/v1/portfolio', async route => {if (holdSecondary) {pendingPortfolio = true; await delayed;} await route.fallback();});
  await page.route('**/api/market?**', async route => {if (holdSecondary) await delayed; await route.fallback();});
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
  await page.getByLabel('타임라인 기업 선택', {exact: true}).selectOption(companyId);
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
  expect(fixture.state.apiCalls.filter(call => call.path === `/v1/events/${eventId}`)).toHaveLength(1);
  expect(navigationDocuments).toHaveLength(initialDocuments);
  expect(fixture.state.unexpected).toEqual([]);
  expect(fixture.state.runtimeErrors).toEqual([]);
  await expect(main.getByRole('alert')).toHaveCount(0);
}

// Isolated API fixtures verify the real Next app, AuthProvider and injected navigation.
// No Google accounts, Supabase credentials, or production endpoints are used.
for (const legacy of [false, true]) {
test(`menu transitions retain auth and progressively render ${legacy ? 'legacy' : 'compact'} responses`, async ({ page }) => {
  if (test.info().project.name === 'mobile') {
    // The strict mobile contract supports null summaries, then opens full evidence on demand.
    // Desktop keeps its existing partial legacy-payload enrichment coverage below.
    await verifyMobileProgressiveNavigation(page, legacy);
    return;
  }
  const calls: string[] = [], documents: string[] = [];
  const company = { id: '00000001-0000-4000-8000-000000000001', name: 'Synthetic US company', ticker: 'TEST', market: 'NASDAQ', provider: 'sec', is_demo: true, last_ingested_at: null };
  const event = { id: '00000011-0000-4000-8000-000000000001', company, headline: 'Synthetic verified change', what_happened: 'Persisted summary', published_at: new Date().toISOString(), source_provider: 'sec', source_url: 'https://example.com/evidence', ranking: { reason: 'Synthetic fixture' },
    fact_summary: 'Persisted quote', change_summary: [{ field: 'revenue', previous_value: '10', current_value: '12' }], interpretation: 'Reviewed interpretation', source_document: { id: 'document', title: 'Synthetic source', source_url: 'https://example.com/evidence' } };
  const card = legacy ? Object.fromEntries(Object.entries(event).filter(([key]) => !['fact_summary', 'change_summary', 'interpretation', 'source_document'].includes(key))) : event;
  let release!: () => void;
  const delayed = new Promise<void>(resolve => { release = resolve; });
  let holdSecondary = true;
  page.on('request', request => { if (request.isNavigationRequest() && request.frame() === page.mainFrame()) documents.push(request.url()); });
  await page.addInitScript(() => sessionStorage.setItem('signalbrief.demo.token', 'isolated-synthetic-token'));
  await page.route('**/v1/**', async route => {
    const path = new URL(route.request().url()).pathname;
    const endpoint = path.replace(/^\/api/, ''); calls.push(route.request().method()+" "+endpoint);
    let data: unknown = [];
    if (endpoint === '/v1/config') data = { demo_mode: true, demo_admin_enabled: false, auth_mode: 'demo' };
    else if (endpoint === '/v1/me') data = { id: 'synthetic-user', display_name: 'Test', density: 'advanced', onboarding_completed: true, analytics_consent: false, is_admin: false, demo_mode: true };
    else if (endpoint === '/v1/feed') data = { items: [card], total: 1 };
    else if (endpoint === '/v1/companies') data = [company];
    else if (endpoint === '/v1/watchlist') data = { id: 'watch', name: 'Watch', items: [company] };
    else if (endpoint === '/v1/portfolio') data = { id: 'portfolio', name: 'Portfolio', positions: [] };
    else if (endpoint.endsWith('/timeline')) data = [card];
    else if (endpoint.startsWith('/v1/events/')) data = { event, facts: [{ quote: 'Persisted quote', validation_status: 'supported' }], changes: event.change_summary, brief: { interpretation: event.interpretation }, document: event.source_document };
    if (holdSecondary && (['/v1/calendar', '/v1/portfolio'].includes(endpoint) || endpoint.startsWith('/v1/events/'))) await delayed;
    await route.fulfill({ json: data, headers: { 'Access-Control-Allow-Origin': '*' } });
  });
  await page.route('**/api/market?**', async route => {
    if (holdSecondary) await delayed;
    await route.fulfill({ json: { quotes: [] } });
  });
  await page.goto('/today');
  await expect(page.locator('.todayItem')).toContainText('Persisted summary');
  if (!legacy) {
    await expect(page.locator('.todayItem')).toContainText('Persisted quote');
    expect(calls.some(path => path.includes('/v1/events/'))).toBe(false);
  }
  holdSecondary = false; release();
  await expect(page.locator('.todayItem')).toContainText('Persisted quote');
  await expect(page.locator('.todayItem')).toContainText('Reviewed interpretation');
  await expect(page.locator('#portfolioSummary')).toContainText('등록된 보유종목');
  const reloadCount = documents.length;
  await page.evaluate(() => { (window as Window & { __navigationMarker?: string }).__navigationMarker = 'retained'; });
  for (const [route, screen] of [['portfolio', 'setup'], ['calendar', 'calendar'], ['watch', 'setup'], ['today', 'today']]) {
    if (test.info().project.name === 'mobile') await page.getByRole('button', { name: '메뉴 열기', exact: true }).click();
    await page.locator(`.nav [data-route="${route}"]`).click();
    await expect(page.locator(`[data-screen="${screen}"]`)).toBeVisible();
    await expect(page.locator('.referenceGate')).toHaveCount(0);
  }
  expect(documents).toHaveLength(reloadCount);
  expect(await page.evaluate(() => (window as Window & { __navigationMarker?: string }).__navigationMarker)).toBe('retained');
  expect(calls.filter(path => path === 'GET /v1/config')).toHaveLength(1);
  expect(calls.filter(path => path === 'GET /v1/me')).toHaveLength(1);
  expect(calls.filter(path => path === 'PATCH /v1/me')).toHaveLength(0);
  expect(calls.filter(path => path === 'GET /v1/watchlist')).toHaveLength(1);
  if (test.info().project.name === 'mobile') await page.getByRole('button', { name: '메뉴 열기', exact: true }).click();
  await page.locator('.nav [data-route="timeline"]').click();
  await expect(page.locator('#timeline')).toContainText('Reviewed interpretation');
  await expect(page.locator('#reports a')).toHaveAttribute('href', 'https://example.com/evidence');
  if (!legacy) expect(calls.some(path => path.includes('/v1/events/'))).toBe(false);
});
}
