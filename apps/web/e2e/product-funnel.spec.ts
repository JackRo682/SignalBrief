import {expect, test, type Page} from '@playwright/test';
import {companies, companyResources, fixtureNow, mobileFixture, userId} from './mobile-fixture';
import {emptyActivityFixture, overviewFixture} from './admin-overview-fixture';
import {operationMetricKeys, operationsSnapshotSchema} from '../src/admin-logs/operations-contracts';
import {trafficRequest, trafficSummary} from '../src/acquisition/contracts';
import {catalogSchema, workspaceRequest} from '../src/workspace/contracts';

// Fixture-only browser checks. Requests to analytics vendors and live accounts
// are intercepted; the product funnel is sent exclusively to /api/traffic.
const productKinds = new Set(['search_used', 'filter_used', 'event_detail_click', 'event_detail_view']);
type Captured = {payload: Record<string, unknown>; authorization: string | undefined};
const consentBanner = (page: Page) => page.getByRole('complementary', {name: '선택적 방문 통계'});
const productEvents = (calls: Captured[]) => calls.filter(call => productKinds.has(String(call.payload.kind)));

async function productFixture(page: Page, options: Parameters<typeof mobileFixture>[1] = {}) {
  const fixture = await mobileFixture(page, options);
  await page.route('**/api/company-discovery**', async route => {
    const request = route.request();
    expect(request.method()).toBe('GET');
    expect(request.headers().authorization).toMatch(/^Bearer /);
    const query = (new URL(request.url()).searchParams.get('q') ?? '').toLowerCase();
    const items = companies.filter(company => `${company.name} ${company.ticker}`.toLowerCase().includes(query))
      .map((company, index) => ({provider: 'sec', provider_company_id: String(index + 1).padStart(10, '0'),
        ticker: company.ticker, name: company.name, market: company.market, company_id: company.id}));
    await route.fulfill({json: {items, total: items.length, source_status: 'ready'}});
  });
  await page.route('**/api/workspace', async route => {
    const request = workspaceRequest.parse(route.request().postDataJSON());
    if (request.action !== 'design_directory') {
      await route.fallback();
      return;
    }
    expect(route.request().method()).toBe('POST');
    expect(route.request().headers().authorization).toMatch(/^Bearer /);
    fixture.state.calls.push(request);
    const {p} = request, query = (p.q ?? '').toLowerCase(), offset = p.offset ?? 0, limit = p.limit ?? 20;
    const items = companyResources.filter(item => `${item.title} ${item.ticker}`.toLowerCase().includes(query)
      && ['all', 'overseas'].includes(p.market_group ?? 'all'));
    await route.fulfill({json: catalogSchema.parse({items: items.slice(offset, offset + limit), total: items.length,
      counts: {company: items.length}, markets: ['NASDAQ'], next_offset: offset + limit < items.length ? offset + limit : null})});
  });
  return fixture;
}

async function captureTraffic(page: Page, calls: Captured[]) {
  await page.route('**/api/traffic', async route => {
    expect(route.request().method()).toBe('POST');
    calls.push({payload: route.request().postDataJSON(), authorization: route.request().headers().authorization});
    await route.fulfill({json: {recorded: true}});
  });
  await page.route('**/api/public-stats', route => route.fulfill({json: {}}));
  await page.route('https://www.googletagmanager.com/**', route => route.fulfill({
    contentType: 'application/javascript', body: '/* isolated vendor transport */',
  }));
  await page.route('https://*.google-analytics.com/**', route => route.abort());
  await page.route('https://*.clarity.ms/**', route => route.abort());
}

async function anonymous(page: Page) {
  await page.clock.setFixedTime(new Date(fixtureNow));
  await page.route('**/*', async route => {
    const hostname = new URL(route.request().url()).hostname;
    if (hostname !== 'localhost' && hostname !== '127.0.0.1') {
      await route.abort();
      return;
    }
    await route.fallback();
  });
  await page.route('**/v1/config', route => route.fulfill({
    json: {auth_mode: 'supabase', demo_mode: false, demo_admin_enabled: false},
  }));
  await page.route('**/api/auth-config', route => route.fulfill({
    json: {url: 'https://test-project.supabase.co', publishableKey: 'sb_publishable_isolated_fixture'},
  }));
}

async function agree(page: Page) {
  await expect(consentBanner(page)).toBeVisible();
  await consentBanner(page).getByRole('button', {name: '동의', exact: true}).click();
  await expect(consentBanner(page)).toBeHidden();
}

async function searchAndFilter(page: Page, query: string) {
  const input = page.getByRole('textbox', {name: '기업명, 티커 또는 키워드 검색', exact: true});
  await input.fill(query);
  await input.press('Enter');
  await expect.poll(() => new URL(page.url()).searchParams.get('q')).toBe(query);
  await page.getByRole('combobox', {name: '출처', exact: true}).selectOption('sec');
  await expect.poll(() => new URL(page.url()).searchParams.get('source')).toBe('sec');
}

test('a consented visitor reaches search, filtering and an official detail without exporting content', async ({page}) => {
  const calls: Captured[] = [];
  await anonymous(page);
  await captureTraffic(page, calls);
  await page.goto('/');
  expect(productEvents(calls)).toEqual([]);
  await agree(page);
  await expect.poll(() => calls.some(call => call.payload.kind === 'page_view' && call.payload.page === 'home')).toBe(true);
  const landing = calls.find(call => call.payload.kind === 'page_view' && call.payload.page === 'home')!;
  expect(landing.authorization).toBeUndefined();

  const fixture = await productFixture(page, {analyticsConsent: true});
  await captureTraffic(page, calls);
  await page.goto('/search');
  await expect(page.getByRole('heading', {name: '검색', exact: true})).toBeVisible();
  const query = 'NVDA private-query@example.invalid';
  await searchAndFilter(page, query);
  await expect.poll(() => productEvents(calls).map(call => call.payload.kind)).toEqual(['search_used', 'filter_used']);

  await page.goto('/calendar');
  const occurrence = fixture.state.calendar[0];
  const entry = page.locator('.rd-calendar-grid').getByRole('link', {name: new RegExp(occurrence.title)});
  await expect(entry).toBeVisible();
  await entry.click();
  await expect(page.getByRole('heading', {level: 1, name: occurrence.title, exact: true})).toBeVisible();
  await expect.poll(() => productEvents(calls).map(call => call.payload.kind)).toEqual([
    'search_used', 'filter_used', 'event_detail_click', 'event_detail_view',
  ]);
  await page.getByRole('tab', {name: '문서', exact: true}).click();
  await page.getByRole('tab', {name: '개요', exact: true}).click();
  expect(productEvents(calls).filter(call => call.payload.kind === 'event_detail_view')).toHaveLength(1);

  const expected = [
    {kind: 'search_used', page: 'search'},
    {kind: 'filter_used', page: 'search', filter_type: 'source'},
    {kind: 'event_detail_click', page: 'calendar', event_kind: 'calendar'},
    {kind: 'event_detail_view', page: 'event_detail', event_kind: 'calendar'},
  ];
  const baseKeys = ['action', 'id', 'kind', 'page', 'product_consent_version', 'secret', 'source', 'visitor_id'];
  for (const [index, call] of productEvents(calls).entries()) {
    const optionalKeys = index === 1 ? ['filter_type'] : index >= 2 ? ['event_kind'] : [];
    expect(Object.keys(call.payload).sort()).toEqual([...baseKeys, ...optionalKeys].sort());
    expect(call.payload).toMatchObject({...expected[index], action: 'record', source: 'direct', product_consent_version: '2026-11-20'});
    expect(call.payload.visitor_id).toBe(landing.payload.visitor_id);
    expect(call.payload.secret).toMatch(/^[a-f0-9]{64}$/);
    expect(call.authorization).toMatch(/^Bearer /);
    const serialized = JSON.stringify(call.payload);
    for (const privateValue of [query, occurrence.id, occurrence.company_id!, occurrence.title, userId]) {
      expect(serialized).not.toContain(privateValue);
    }
    expect(serialized).not.toMatch(/https?:\/\/|@example\.invalid/);
  }
  expect(new Set(productEvents(calls).map(call => call.payload.id)).size).toBe(4);
  expect(fixture.state.unexpected).toEqual([]);
  expect(fixture.state.runtimeErrors).toEqual([]);
});

test('missing or denied browser consent, disabled account analytics and admins suppress the product funnel', async ({page}) => {
  const fixture = await productFixture(page, {analyticsConsent: true});
  const calls: Captured[] = [];
  await captureTraffic(page, calls);
  await page.goto('/search');
  await searchAndFilter(page, 'missing-consent-query');
  expect(productEvents(calls)).toEqual([]);
  await consentBanner(page).getByRole('button', {name: '거절 / 동의 철회', exact: true}).click();
  await expect(consentBanner(page)).toBeHidden();
  await searchAndFilter(page, 'denied-consent-query');
  expect(productEvents(calls)).toEqual([]);

  // A public consent grant alone cannot override a disabled account preference.
  await page.goto('/privacy');
  await page.getByRole('button', {name: '방문 통계 설정', exact: true}).click();
  await agree(page);
  fixture.state.profile.analytics_consent = false;
  await page.goto('/search');
  await searchAndFilter(page, 'account-opted-out-query');
  expect(productEvents(calls)).toEqual([]);

  fixture.state.profile.analytics_consent = true;
  fixture.state.profile.is_admin = true;
  await page.goto('/search');
  await searchAndFilter(page, 'administrator-query');
  expect(productEvents(calls)).toEqual([]);
  expect(fixture.state.unexpected).toEqual([]);
  expect(fixture.state.runtimeErrors).toEqual([]);
});

test('late consent does not replay a viewed detail and failed detail loading is not a conversion', async ({page}) => {
  const fixture = await productFixture(page, {analyticsConsent: true});
  const calls: Captured[] = [];
  await captureTraffic(page, calls);
  const occurrence = fixture.state.calendar[0];
  await page.goto(`/events/${occurrence.id}?kind=calendar`);
  await expect(page.getByRole('heading', {level: 1, name: occurrence.title, exact: true})).toBeVisible();
  expect(productEvents(calls)).toEqual([]);
  await agree(page);
  await page.getByRole('tab', {name: '문서', exact: true}).click();
  await page.getByRole('tab', {name: '개요', exact: true}).click();
  expect(productEvents(calls)).toEqual([]);

  const failed = fixture.state.calendar[1];
  await page.route('https://test-project.supabase.co/rest/v1/calendar_items?**', async route => {
    const request = route.request();
    if (request.method() !== 'GET' || new URL(request.url()).searchParams.get('id') !== `eq.${failed.id}`) {
      await route.fallback();
      return;
    }
    await route.fulfill({status: 400, headers: {'Access-Control-Allow-Origin': '*'}, json: {message: 'isolated calendar failure'}});
  });
  await page.goto(`/events/${failed.id}?kind=calendar`);
  await expect(page.getByRole('alert').filter({hasText: '일정을 불러오지 못했습니다.'})).toBeVisible();
  await expect(page.getByRole('heading', {level: 1, name: failed.title, exact: true})).toHaveCount(0);
  expect(productEvents(calls)).toEqual([]);
  expect(fixture.state.unexpected).toEqual([]);
  expect(fixture.state.runtimeErrors).toEqual([]);
});

test('the administrator sees ordered browser conversion separately from total consented actions', async ({page}, info) => {
  const fixture = await productFixture(page);
  fixture.state.profile.is_admin = true;
  const queries: {from: string; to: string}[] = [];
  await page.route('**/api/admin/overview', async route => {
    await route.fulfill({json: overviewFixture(route.request().postDataJSON(), false, fixtureNow)});
  });
  await page.route('**/api/admin/user-logs', route => route.fulfill({json: emptyActivityFixture(fixtureNow)}));
  await page.route('**/api/traffic', async route => {
    expect(route.request().headers().authorization).toMatch(/^Bearer /);
    const request = trafficRequest.parse(route.request().postDataJSON());
    if (request.action !== 'summary') throw new Error('Administrator fixture must not emit customer events');
    queries.push({from: request.from, to: request.to});
    // Deliberately different browser/action counts: synthetic QA values only.
    await route.fulfill({json: trafficSummary.parse({
      generated_at: fixtureNow,
      totals: {visitors: 100, pageviews: 130, starts: 20, requests: 5, signups: 12, onboarded: 10},
      daily: [], sources: [],
      product: {
        landing_visitors: 100, engaged_visitors: 40, detail_click_visitors: 15, detail_view_visitors: 10,
        search_events: 90, filter_events: 65, detail_click_events: 28, detail_view_events: 22,
      },
    })});
  });
  await page.route('https://test-project.supabase.co/rest/v1/rpc/sb_reference_*', async route => {
    const request = route.request(), name = new URL(request.url()).pathname.split('/').at(-1);
    if (name !== 'sb_reference_ops' && name !== 'sb_reference_users') {
      await route.fallback();
      return;
    }
    const headers = {
      'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': request.headers()['access-control-request-headers'] ?? 'authorization,apikey,content-type,x-client-info',
    };
    if (request.method() === 'OPTIONS') {
      await route.fulfill({status: 204, headers});
      return;
    }
    expect(request.headers().authorization).toMatch(/^Bearer /);
    if (name === 'sb_reference_users') {
      await route.fulfill({headers, json: []});
      return;
    }
    const {p} = request.postDataJSON();
    await route.fulfill({headers, json: operationsSnapshotSchema.parse({
      metrics: Object.fromEntries(operationMetricKeys.map(key => [key, {
        value: 0, delta: null, spark: [], note: 'Synthetic isolated QA fixture',
      }])),
      since: `${p.start}T00:00:00+09:00`, until: `${p.end}T23:59:59+09:00`,
      review: [], failures: [], citations: [], duplicates: [], reports: [],
    })});
  });
  await page.route('**/v1/ops/**', async route => {
    const path = new URL(route.request().url()).pathname;
    expect(route.request().headers().authorization).toMatch(/^Bearer /);
    expect(route.request().method()).toBe('GET');
    if (path.endsWith('/queues')) await route.fulfill({json: {failed_runs: []}});
    else if (path.endsWith('/documents') || path.endsWith('/audit')) await route.fulfill({json: []});
    else throw new Error(`Unexpected administrator fixture endpoint: ${path}`);
  });

  await page.goto('/ops');
  await expect(page.getByRole('heading', {level: 1, name: '운영 현황', exact: true})).toBeVisible();
  const funnel = page.getByRole('region', {name: '방문 → 탐색 → 이벤트 상세', exact: true});
  await expect(funnel).toBeVisible();
  const stages = funnel.locator('.traffic-metrics > div');
  await expect(stages.locator('strong')).toHaveText(['100', '40', '15', '10']);
  await expect(stages.nth(1)).toContainText('이전 단계 대비 40.0%');
  await expect(stages.nth(2)).toContainText('이전 단계 대비 37.5%');
  await expect(stages.nth(3)).toContainText('이전 단계 대비 66.7%');
  await expect(funnel).toContainText('홈 방문 → 상세 화면 확인: 10.0%');
  await expect(funnel.getByRole('heading', {name: '기간 내 전체 동의 활동', exact: true})).toBeVisible();
  for (const [label, count] of [['검색 실행', '90'], ['필터 변경', '65'], ['이벤트 상세 클릭', '28'], ['상세 화면 확인', '22']]) {
    await expect(funnel.getByRole('row').filter({has: page.getByRole('cell', {name: label, exact: true})}).getByRole('cell')).toHaveText([label, count]);
  }
  await expect(funnel).toContainText('위 전환 단계의 브라우저 수와 다릅니다.');
  expect(queries.at(-1)).toEqual({
    from: await page.getByLabel('시작일', {exact: true}).inputValue(),
    to: await page.getByLabel('종료일', {exact: true}).inputValue(),
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2)).toBe(true);
  await funnel.screenshot({path: info.outputPath(`synthetic-product-funnel-${info.project.name}.png`), animations: 'disabled'});
  expect(fixture.state.unexpected).toEqual([]);
  expect(fixture.state.runtimeErrors).toEqual([]);
});
