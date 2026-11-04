import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { companies, companyResources, fixtureNow, mobileFixture } from './mobile-fixture';
import {
  catalogSchema, companyDetailSchema, resourceSchema, sourceOverviewSchema,
  workspaceRequest, type Resource,
} from '../src/workspace/contracts';
import { dashboardSchema } from '../src/redesign/dashboard-contract';
import { calendarEntrySchema } from '../src/redesign/calendar-utils';

// Synthetic, isolated regression fixtures. The inherited catch-all rejects every
// unmocked API/provider request; no production session or provider is contacted.
const appleId = companies[1].id;
const externalId = '20000000-0000-4000-8000-000000000099';
const filingId = '40000000-0000-4000-8000-000000000099';
const sourceUrl = 'https://www.sec.gov/Archives/edgar/data/99999/synthetic-reliability.htm';
const numericQuote = 'Synthetic fixture: 42 units were reported for the test period.';
const externalIssuer = {
  provider: 'sec', provider_company_id: '0000099999', ticker: 'ORNX',
  name: 'Synthetic Orion Systems', market: 'US', company_id: null,
};
const apple = resourceSchema.parse({
  ...companyResources[1], title: 'Apple', company_name: 'Apple',
});
const external = resourceSchema.parse({
  ...companyResources[0], id: externalId, company_id: externalId,
  title: externalIssuer.name, company_name: externalIssuer.name,
  ticker: 'ORNX', market: 'US', summary: '', provider: 'sec',
});
const filing = resourceSchema.parse({
  ...apple, id: filingId, kind: 'filing', title: 'Synthetic verified disclosure',
  summary: 'Synthetic source excerpt for browser regression.', provider: 'sec',
  source_url: sourceUrl, published_at: '2026-10-02T08:00:00Z',
  publication_precision: 'date', category: '10-Q',
});
const approved = resourceSchema.parse({
  ...filing, id: '50000000-0000-4000-8000-000000000099', kind: 'us_analysis',
  filing_id: filingId, title: 'Synthetic reviewed excerpt',
  reviewed_at: '2026-10-03T08:00:00Z', coverage: 'excerpt',
});
const calendarEntries = [
  { id: '80000000-0000-4000-8000-000000000091', company_id: appleId,
    title: 'Synthetic October official event', occurs_on: '2026-10-12' },
  { id: '80000000-0000-4000-8000-000000000092', company_id: appleId,
    title: 'Synthetic November official event', occurs_on: '2026-11-15' },
  { id: '80000000-0000-4000-8000-000000000093', company_id: companies[0].id,
    title: 'Synthetic other-company event', occurs_on: '2026-11-16' },
].map(item => calendarEntrySchema.parse({
  ...item, event_id: null, origin: 'official_ir', source_url: sourceUrl,
  source_timezone: 'America/Los_Angeles', verified_at: fixtureNow,
  quote: `Synthetic official notice: ${item.title} on ${item.occurs_on}.`,
}));
const collectedCalendarEntries = [
  { id: '80000000-0000-4000-8000-000000000094', company_id: companies[0].id,
    title: 'Synthetic newly collected upcoming event', occurs_on: '2026-10-14' },
  { id: '80000000-0000-4000-8000-000000000095', company_id: companies[0].id,
    title: 'Synthetic newly collected past event', occurs_on: '2026-10-04' },
].map(item => calendarEntrySchema.parse({
  ...item, event_id: null, origin: 'official_ir', source_url: sourceUrl,
  source_timezone: 'America/Los_Angeles', verified_at: fixtureNow,
  quote: `Synthetic official notice: ${item.title} on ${item.occurs_on}.`,
}));

function matchesQuery(resource: Resource, query: string) {
  const normalized = query.normalize('NFKC').replace(/\s+/g, '').toLowerCase();
  if (!normalized) return true;
  const alias = normalized === '애플' ? 'aapl' : normalized;
  return `${resource.title}${resource.company_name}${resource.ticker}`
    .replace(/\s+/g, '').toLowerCase().includes(alias);
}

async function reliabilityFixture(page: Page) {
  const base = await mobileFixture(page, { empty: true });
  const state = {
    dashboardFails: false, companyFails: false, profileFails: false,
    calendarFails: false, discoveryFails: false, resolutionFails: false,
    externalRegistered: false, externalReady: false,
    collectionCompanyId: null as string | null, collectionPending: false, collectionReady: false,
    coverageQueries: [] as (string | null)[],
    workspaceCalls: [] as { action: string; p: Record<string, unknown> }[],
    lookupQueries: [] as string[], calendarQueries: [] as string[],
    discoveryQueries: [] as string[], resolutionBodies: [] as Record<string, unknown>[],
  };
  const directory = () => [companyResources[0], apple, ...(state.externalRegistered ? [external] : [])];
  const resources = () => [...directory(), filing, approved];

  await page.route('**/api/news?**', route => route.fulfill({ json: {
    provider: 'NAVER', query: '엔비디아', retrievedAt: fixtureNow, items: [],
  } }));
  await page.route('**/api/company-profile?**', async route => {
    if (state.profileFails) {
      await route.fulfill({ status: 502, json: { error: { code: 'profile_unavailable' } } });
      return;
    }
    const id = new URL(route.request().url()).searchParams.get('company_id');
    const company = directory().find(item => item.id === id)!;
    await route.fulfill({ json: {
      status: 'verified', company_id: id, provider: 'SEC EDGAR',
      fetched_at: fixtureNow, source_sha256: 'a'.repeat(64), source_url: sourceUrl,
      profile: {
        corp_code: '0000099999', ticker: company.ticker, name: company.title,
        english_name: company.title, ceo: null, established_on: null, address: null,
        website: 'https://www.sec.gov/', industry_description: 'Synthetic test industry',
        industry_code: '9999', fiscal_month: '12',
      },
    } });
  });
  await page.route('**/api/company-discovery**', async route => {
    const request = route.request();
    expect(request.headers().authorization).toMatch(/^Bearer /);
    if (request.method() === 'GET') {
      const query = new URL(request.url()).searchParams.get('q') ?? '';
      state.discoveryQueries.push(query);
      if (state.discoveryFails) {
        await route.fulfill({ status: 502, json: { error: { code: 'directory_unavailable' } } });
        return;
      }
      const items = /ornx|orion/i.test(query) ? [externalIssuer]
        : matchesQuery(apple, query) ? [{ ...externalIssuer, name: apple.title,
          ticker: apple.ticker, company_id: appleId, market: apple.market }]
          : [];
      await route.fulfill({ json: { items, total: items.length, source_status: 'ready' } });
      return;
    }
    expect(request.method()).toBe('POST');
    const body = request.postDataJSON() as Record<string, unknown>;
    state.resolutionBodies.push(body);
    if (state.resolutionFails) {
      await route.fulfill({ status: 502, json: { error: { code: 'collection_unavailable' } } });
      return;
    }
    if (body.company_id) {
      expect(body).toEqual({ company_id: externalId });
      state.externalReady = true;
    } else {
      expect(body).toEqual({ provider: 'sec', provider_company_id: '0000099999', ticker: 'ORNX' });
      state.externalRegistered = true;
    }
    await route.fulfill({ json: {
      company_id: externalId, hydration_status: state.externalReady ? 'ready' : 'unavailable',
    } });
  });

  await page.route('**/v1/companies?**', async route => {
    const query = new URL(route.request().url()).searchParams.get('q') ?? '';
    state.lookupQueries.push(query);
    await route.fulfill({ json: directory().filter(item => matchesQuery(item, query)).map(item => ({
      id: item.id, name: item.company_name, ticker: item.ticker, market: item.market,
      provider: 'sec', is_demo: false, last_ingested_at: fixtureNow,
    })) });
  });
  await page.route('**/v1/watchlist', async route => {
    expect(route.request().method()).toBe('GET');
    await route.fulfill({ json: {
      id: '10000000-0000-4000-8000-000000000002', name: 'Synthetic watchlist',
      items: directory().filter(item => base.state.watched.has(item.id)).map(item => ({
        id: item.id, name: item.company_name, ticker: item.ticker, market: item.market,
        provider: 'sec', is_demo: false, last_ingested_at: fixtureNow,
      })),
    } });
  });
  await page.route('https://test-project.supabase.co/rest/v1/rpc/sb_calendar_coverage', async route => {
    const headers = {
      'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': route.request().headers()['access-control-request-headers']
        ?? 'authorization,apikey,content-type,x-client-info',
    };
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers }); return;
    }
    expect(route.request().method()).toBe('POST');
    expect(route.request().headers().authorization).toMatch(/^Bearer /);
    const payload = route.request().postDataJSON() as { p_company_id: string | null };
    expect(Object.keys(payload)).toEqual(['p_company_id']);
    expect(payload.p_company_id === null || directory().some(item => item.id === payload.p_company_id)).toBe(true);
    state.coverageQueries.push(payload.p_company_id);
    const selected = state.collectionCompanyId && payload.p_company_id ? {
      company_id: payload.p_company_id, source_count: 1, has_error: false,
      pending: payload.p_company_id === state.collectionCompanyId && state.collectionPending,
      last_success_at: payload.p_company_id === state.collectionCompanyId && !state.collectionReady ? null : fixtureNow,
    } : null;
    await route.fulfill({ headers, json: {
      registered_companies: 2, covered_companies: 2,
      pending_companies: state.collectionPending ? 1 : 0,
      pending_company_ids: state.collectionPending && state.collectionCompanyId ? [state.collectionCompanyId] : [],
      selected,
    } });
  });
  await page.route('https://test-project.supabase.co/rest/v1/calendar_items?**', async route => {
    const request = route.request();
    const headers = {
      'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': request.headers()['access-control-request-headers']
        ?? 'authorization,apikey,content-type,x-client-info',
    };
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers }); return;
    }
    const url = new URL(request.url());
    state.calendarQueries.push(url.search);
    expect(request.method()).toBe('GET');
    expect(request.headers().authorization).toMatch(/^Bearer /);
    expect(url.searchParams.get('calendar_status')).toBe('eq.confirmed');
    if (state.calendarFails) {
      await route.fulfill({ status: 503, headers, json: { code: 'temporary_unavailable', message: 'Synthetic outage' } });
      return;
    }
    const id = url.searchParams.get('id')?.replace(/^eq\./, '');
    const companyFilter = url.searchParams.get('company_id');
    const company = companyFilter?.startsWith('eq.') ? companyFilter.slice(3) : undefined;
    const companyList = companyFilter?.startsWith('in.') ? companyFilter.slice(4, -1).split(',') : undefined;
    const orCompanies = url.searchParams.get('or')?.match(/company_id\.in\.\(([^)]*)\)/)?.[1].split(',');
    const origin = url.searchParams.get('origin');
    const bounds = url.searchParams.getAll('occurs_on');
    const from = bounds.find(value => value.startsWith('gte.'))?.slice(4);
    const until = bounds.find(value => value.startsWith('lte.'))?.slice(4);
    const available = state.collectionCompanyId
      ? [...calendarEntries.filter(item => item.company_id !== state.collectionCompanyId),
        ...(state.collectionReady ? collectedCalendarEntries : [])]
      : calendarEntries;
    const rows = available.filter(item => (!id || item.id === id)
      && (!company || item.company_id === company)
      && (!companyList || companyList.includes(item.company_id!))
      && (!orCompanies || item.origin === 'user' || orCompanies.includes(item.company_id!))
      && (origin !== 'eq.user' || item.origin === 'user')
      && (origin !== 'neq.user' || item.origin !== 'user')
      && (!from || item.occurs_on >= from) && (!until || item.occurs_on <= until));
    const descending = url.searchParams.get('order')?.startsWith('occurs_on.desc');
    rows.sort((a, b) => (descending ? b.occurs_on.localeCompare(a.occurs_on) : a.occurs_on.localeCompare(b.occurs_on))
      || a.id.localeCompare(b.id));
    await route.fulfill({ headers, json: rows.slice(0, Number(url.searchParams.get('limit') ?? 500)) });
  });
  await page.route('**/api/workspace', async route => {
    const payload = route.request().postDataJSON() as { action: string; p: Record<string, unknown> };
    workspaceRequest.parse(payload);
    const { action, p } = payload;
    state.workspaceCalls.push(payload);
    if (action === 'catalog' || action === 'design_directory') {
      const kind = String(p.kind ?? '');
      let matches = (action === 'design_directory' ? directory() : resources()).filter(item =>
        matchesQuery(item, String(p.q ?? ''))
        && (!p.company_id || item.company_id === p.company_id)
        && (!p.market || item.market === p.market)
        && (!p.source || (item.provider ?? 'sec') === p.source)
        && (!p.category || item.category === p.category));
      if (action === 'design_directory' && p.market_group && !['all', 'overseas'].includes(String(p.market_group))) matches = [];
      const counts = matches.reduce<Record<string, number>>((result, item) => {
        result[item.kind] = (result[item.kind] ?? 0) + 1; return result;
      }, {});
      const selected = matches.filter(item => !kind || item.kind === kind
        || kind === 'document' && ['filing', 'document'].includes(item.kind)
        || kind === 'analysis' && ['event', 'us_analysis', 'dart_analysis'].includes(item.kind));
      const offset = Number(p.offset ?? 0), limit = Number(p.limit ?? 20);
      await route.fulfill({ json: catalogSchema.parse({
        items: selected.slice(offset, offset + limit), total: selected.length,
        counts, markets: ['NASDAQ', 'US'], next_offset: offset + limit < selected.length ? offset + limit : null,
      }) });
      return;
    }
    if (action === 'design_dashboard') {
      if (state.dashboardFails) {
        await route.fulfill({ status: 503, json: { error: { code: 'temporarily_unavailable' } } });
        return;
      }
      const inRange = (day: string) => day >= String(p.start_date) && day <= String(p.end_date);
      const included = !p.company_id || p.company_id === appleId;
      const filings = included && inRange('2026-10-02') ? [filing] : [];
      const analyses = included && inRange('2026-10-03') ? [approved] : [];
      const events = calendarEntries.filter(item => inRange(item.occurs_on)
        && (!p.company_id || item.company_id === p.company_id))
        .map(item => ({ ...item, company_name: item.company_id === appleId ? 'Apple' : companies[0].name }));
      await route.fulfill({ json: dashboardSchema.parse({
        as_of: fixtureNow, timezone: 'Asia/Seoul', start_date: p.start_date, end_date: p.end_date,
        filing_count: filings.length, analysis_count: analyses.length, event_count: events.length,
        filings, analyses, events,
      }) });
      return;
    }
    if (action === 'source_overview') {
      await route.fulfill({ json: sourceOverviewSchema.parse({
        companies: directory().length, filing_count: 1, published_count: 1,
        filings: [filing], analyses: [approved], historical_events: [],
        calendar: calendarEntries.filter(item => !p.company_id || item.company_id === p.company_id),
        historical_calendar: [], scope: 'all', following_count: 0, fallback_to_all: false,
        monitoring: [], saved_count: 0, unread_count: 0,
      }) });
      return;
    }
    if (action === 'company') {
      if (state.companyFails) {
        await route.fulfill({ status: 502, json: { error: { code: 'company_unavailable' } } });
        return;
      }
      const company = directory().find(item => item.id === p.id)!;
      const documents = company.id === externalId
        ? state.externalReady ? [{ ...filing, company_id: externalId, company_name: external.title, ticker: 'ORNX' }] : []
        : [filing];
      await route.fulfill({ json: companyDetailSchema.parse({
        company, events: [], analyses: company.id === appleId ? [approved] : [], documents,
        numeric_evidence: company.id === appleId ? [{
          id: 'synthetic-approved-claim-1', filing_id: filingId, kind: 'us_analysis',
          title: approved.title, claim_text: 'Synthetic approved numeric excerpt.',
          quote: numericQuote, source_url: sourceUrl,
          published_at: '2026-10-02T08:00:00Z', reviewed_at: '2026-10-03T08:00:00Z',
        }] : [],
        facts: [], watching: false, holding: false,
      }) });
      return;
    }
    await route.fallback();
  });
  return { base, state };
}
type Fixture = Awaited<ReturnType<typeof reliabilityFixture>>;

async function finish(page: Page, info: TestInfo, fixture: Fixture) {
  expect(fixture.base.state.unexpected, 'All API/provider requests must stay inside the synthetic fixture').toEqual([]);
  expect(fixture.base.state.runtimeErrors, 'No React/hydration/runtime errors').toEqual([]);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth))
    .toBeLessThanOrEqual(1);
  await page.screenshot({ path: info.outputPath('verified-screen.png'), fullPage: true, animations: 'disabled' });
}

function calendarPanels(page: Page) {
  const lists = page.locator('.rd-calendar-side-lists section');
  return {
    grid: page.locator('.rd-calendar-grid'),
    upcoming: lists.filter({ has: page.getByRole('heading', { name: /^다가오는 일정/ }) }),
    past: lists.filter({ has: page.getByRole('heading', { name: /^지난 일정/ }) }),
  };
}

function expectNoCalendarWrites(fixture: Fixture, followed: string[] = []) {
  expect([...fixture.base.state.watched].sort()).toEqual([...followed].sort());
  expect(fixture.base.state.apiCalls.filter(call => call.method !== 'GET')).toEqual([]);
  expect(fixture.base.state.reminderCalls.filter(call => call.action !== 'list')).toEqual([]);
  expect(fixture.state.resolutionBodies).toEqual([]);
}

async function expectCollectedCalendar(page: Page) {
  const panels = calendarPanels(page);
  await expect(panels.grid.getByRole('link', { name: new RegExp(collectedCalendarEntries[0].title) })).toBeVisible();
  await expect(panels.grid.getByRole('link', { name: new RegExp(collectedCalendarEntries[1].title) })).toBeVisible();
  await expect(panels.upcoming.getByRole('link', { name: new RegExp(collectedCalendarEntries[0].title) })).toBeVisible();
  await expect(panels.past.getByRole('link', { name: new RegExp(collectedCalendarEntries[1].title) })).toBeVisible();
  await expect(page.getByText('공식 일정을 수집하고 있습니다. 완료되면 이 화면에 자동으로 표시됩니다.', { exact: true })).toHaveCount(0);
}

test('home opens recent records and can recover from an intentionally empty day filter', async ({ page }, info) => {
  const fixture = await reliabilityFixture(page);
  await page.goto('/today');
  const main = page.locator('main');
  await main.getByRole('button', { name: '조회 설정', exact: true }).click();
  await expect(main.getByRole('button', { name: '최근 1개월', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(main.getByLabel('시작일', { exact: true })).toHaveValue('2026-09-07');
  await expect(main.getByLabel('종료일', { exact: true })).toHaveValue('2026-10-06');
  await main.getByRole('tab', { name: '공시', exact: true }).click();
  const activity = main.locator('#home-activity-panel');
  await expect(activity.getByRole('link', { name: filing.title, exact: true })).toBeVisible();
  await expect(main.getByRole('link', { name: /기간 내 공개 공시/ })).toContainText('1건');
  await main.getByRole('button', { name: '오늘', exact: true }).click();
  await expect(main.getByRole('link', { name: /기간 내 공개 공시/ })).toContainText('0건');
  await expect(activity.getByRole('link', { name: filing.title, exact: true })).toHaveCount(0);
  await main.getByRole('button', { name: '최근 1개월', exact: true }).click();
  await expect(activity.getByRole('link', { name: filing.title, exact: true })).toBeVisible();
  await finish(page, info, fixture);
});

test('a dashboard request failure remains an error instead of becoming a zero count', async ({ page }, info) => {
  const fixture = await reliabilityFixture(page);
  fixture.state.dashboardFails = true;
  await page.goto('/today');
  const main = page.locator('main');
  const metric = main.getByRole('link', { name: /기간 내 공개 공시/ });
  await expect(metric).toContainText('조회 불가');
  await expect(metric).not.toContainText('0건');
  await expect(main.getByRole('alert')).toBeVisible();
  fixture.state.dashboardFails = false;
  await main.getByRole('alert').getByRole('button', { name: '다시 시도', exact: true }).click();
  await expect(metric).toContainText('1건');
  await expect(main.getByRole('alert')).toHaveCount(0);
  await finish(page, info, fixture);
});

test('a new search clears a previous company and source scope and keeps its URL state', async ({ page }, info) => {
  const fixture = await reliabilityFixture(page);
  await page.goto(`/search?kind=document&q=old&company_id=${companies[0].id}&source=dart&market=KOSPI&category=annual&days=30&offset=20`);
  const main = page.locator('main');
  await expect(main.getByRole('combobox', { name: '출처', exact: true })).toHaveValue('dart');
  await main.getByRole('textbox', { name: '기업명, 티커 또는 키워드 검색', exact: true }).fill('애플');
  await main.getByRole('textbox', { name: '기업명, 티커 또는 키워드 검색', exact: true }).press('Enter');
  await expect(page).toHaveURL(url => url.pathname === '/search' && url.searchParams.get('q') === '애플'
    && ['company_id', 'source', 'market', 'category', 'days', 'offset', 'kind'].every(key => !url.searchParams.has(key)));
  await expect(main.getByRole('combobox', { name: '출처', exact: true })).toHaveValue('');
  await expect(main.getByRole('link', { name: /^Apple AAPL/ })).toBeVisible();
  await main.getByRole('navigation', { name: '검색 유형' }).getByRole('button', { name: /^공시/ }).click();
  await expect(page).toHaveURL(url => url.searchParams.get('q') === '애플' && url.searchParams.get('kind') === 'document');
  await expect(main.getByRole('link', { name: new RegExp(filing.title) })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(url => url.searchParams.get('q') === '애플' && !url.searchParams.has('kind'));
  await expect(main.getByRole('link', { name: /^Apple AAPL/ })).toBeVisible();
  await finish(page, info, fixture);
});

test('official company discovery retries failures and opens a recoverable company detail', async ({ page }, info) => {
  const fixture = await reliabilityFixture(page);
  fixture.state.discoveryFails = true;
  await page.goto('/explore');
  const main = page.locator('main');
  await main.getByRole('group', { name: '시장', exact: true }).getByRole('button', { name: '해외주식', exact: true }).click();
  const search = main.getByRole('textbox', { name: '기업명, 티커 또는 키워드 검색', exact: true });
  await search.fill('ORNX');
  await search.press('Enter');
  const discovery = main.locator('.rd-discovery');
  await expect(discovery.getByRole('alert')).toContainText('공식 기업목록에 연결하지 못했습니다.');
  await expect(discovery).not.toContainText('일치하는 결과가 없습니다');
  fixture.state.discoveryFails = false;
  await discovery.getByRole('button', { name: '기업목록 다시 시도', exact: true }).click();
  const open = discovery.getByRole('button', { name: 'Synthetic Orion Systems 기업정보 열기', exact: true });
  await expect(open).toBeVisible();
  fixture.state.resolutionFails = true;
  await open.click();
  await expect(discovery.getByRole('button', { name: '기업정보 다시 시도', exact: true })).toBeVisible();
  await expect(page).toHaveURL(url => url.pathname === '/explore'
    && url.searchParams.get('q') === 'ORNX' && url.searchParams.get('market_group') === 'overseas');
  fixture.state.resolutionFails = false;
  await discovery.getByRole('button', { name: '기업정보 다시 시도', exact: true }).click();
  await expect(page).toHaveURL(url => url.pathname === `/companies/${externalId}`
    && url.searchParams.get('selected_ticker') === 'ORNX'
    && url.searchParams.get('collection') === 'unavailable');
  const detail = page.getByTestId('redesign-company-detail');
  await expect(detail.getByRole('heading', { name: externalIssuer.name, exact: true })).toBeVisible();
  await expect(detail).toContainText('공식 자료 업데이트를 완료하지 못했습니다.');
  await page.goBack();
  await expect(page).toHaveURL(url => url.pathname === '/explore'
    && url.searchParams.get('q') === 'ORNX' && url.searchParams.get('market_group') === 'overseas');
  await expect(search).toHaveValue('ORNX');
  await expect(main.getByRole('button', { name: '해외주식', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.reload();
  await expect(search).toHaveValue('ORNX');
  await expect(main.getByRole('button', { name: '해외주식', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => fixture.state.workspaceCalls.filter(call => call.action === 'design_directory').at(-1)?.p)
    .toMatchObject({ q: 'ORNX', market_group: 'overseas', offset: 0 });
  await page.goto(`/companies/${externalId}?tab=disclosures`);
  await expect(detail.getByRole('heading', { name: externalIssuer.name, exact: true })).toBeVisible();
  await expect(detail.getByRole('tab', { name: '공시', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(detail).not.toContainText('공식 자료 업데이트를 완료하지 못했습니다.');
  expect(fixture.state.resolutionBodies).toHaveLength(2);
  await detail.getByRole('button', { name: '공식 자료 다시 불러오기', exact: true }).click();
  await expect(page).toHaveURL(url => url.pathname === `/companies/${externalId}`
    && url.searchParams.get('tab') === 'disclosures' && !url.searchParams.has('collection'));
  await expect(detail).toContainText('공식 자료를 다시 확인했습니다.');
  await expect(detail.getByRole('tabpanel').getByRole('link', { name: new RegExp(filing.title) })).toBeVisible();
  expect(fixture.state.resolutionBodies).toHaveLength(3);
  await finish(page, info, fixture);
});

test('company data and profile failures each offer recovery without losing the selected company', async ({ page }, info) => {
  const fixture = await reliabilityFixture(page);
  fixture.state.companyFails = true;
  fixture.state.profileFails = true;
  await page.goto(`/companies/${appleId}`);
  const detail = page.getByTestId('redesign-company-detail');
  await expect(detail.getByRole('alert')).toBeVisible();
  await expect(detail.getByRole('heading', { name: 'Apple', exact: true })).toHaveCount(0);
  fixture.state.companyFails = false;
  await detail.getByRole('alert').getByRole('button', { name: '다시 시도', exact: true }).click();
  await expect(detail.getByRole('heading', { name: 'Apple', exact: true })).toBeVisible();
  const profile = detail.getByRole('region', { name: '기업 기본정보' });
  await expect(profile.getByRole('button', { name: '기업정보 다시 시도', exact: true })).toBeVisible();
  fixture.state.profileFails = false;
  await profile.getByRole('button', { name: '기업정보 다시 시도', exact: true }).click();
  await expect(profile).toContainText('Synthetic test industry');
  await expect(detail.getByRole('heading', { name: '승인 분석의 수치 근거', exact: true })).toBeVisible();
  await expect(detail.locator('.rd-detail-citation blockquote')).toHaveText(numericQuote);
  await expect(detail.locator('.rd-detail-citation').getByRole('link', { name: /^공식 원문/ }))
    .toHaveAttribute('href', sourceUrl);
  await expect(detail.locator('.rd-detail-citation').getByRole('link', { name: /^승인 분석 열기/ }))
    .toHaveAttribute('href', `/documents/${filingId}?kind=filing&analysis=us`);
  await detail.getByRole('tab', { name: '공시', exact: true }).click();
  await expect(page).toHaveURL(`/companies/${appleId}?tab=disclosures`);
  await page.reload();
  await expect(detail.getByRole('tab', { name: '공시', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(detail.getByRole('tabpanel').getByRole('link', { name: new RegExp(filing.title) })).toBeVisible();
  await finish(page, info, fixture);
});

test('calendar aliases use server search and monthly navigation opens the correct occurrence', async ({ page }, info) => {
  const fixture = await reliabilityFixture(page);
  await page.goto('/calendar');
  const main = page.locator('main');
  await expect(main.getByRole('heading', { name: '2026년 10월', exact: true })).toBeVisible();
  await main.getByRole('textbox', { name: '기업명 또는 티커 검색', exact: true }).fill('애플');
  await expect.poll(() => fixture.state.lookupQueries).toContain('애플');
  await main.getByRole('checkbox', { name: 'Apple (AAPL)', exact: true }).check();
  await expect(main.getByRole('radio', { name: '특정 기업 선택', exact: true })).toBeChecked();
  await main.getByRole('button', { name: '다음 기간', exact: true }).click();
  await expect(main.getByRole('heading', { name: '2026년 11월', exact: true })).toBeVisible();
  const cell = main.getByRole('region', { name: '2026-11-15', exact: true });
  await expect(cell.getByRole('link', { name: /Synthetic November official event/ })).toBeVisible();
  await expect(main.locator('.rd-calendar-grid').getByRole('link', { name: /Synthetic other-company event/ })).toHaveCount(0);
  await main.getByRole('button', { name: '다음 기간', exact: true }).click();
  await expect(main.getByRole('heading', { name: '2026년 12월', exact: true })).toBeVisible();
  await main.getByRole('button', { name: '가장 가까운 일정 보기 · 2026-11-15', exact: true }).click();
  await expect(main.getByRole('heading', { name: '2026년 11월', exact: true })).toBeVisible();
  await cell.getByRole('link', { name: /Synthetic November official event/ }).click();
  await expect(page).toHaveURL(`/events/${calendarEntries[1].id}?kind=calendar`);
  await expect(page.getByRole('heading', { name: calendarEntries[1].title, exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: '공식 출처 ↗', exact: true })).toHaveAttribute('href', sourceUrl);
  await expect(page.getByRole('tabpanel')).toContainText(calendarEntries[1].quote!);
  await expect(page.getByRole('tabpanel')).toContainText('2026년 11월 15일 · 날짜 기준');
  await expect(page.getByRole('tabpanel')).toContainText('정확한 시간·장소는 공식 원문에서 확인하세요.');
  await expect(page.getByRole('tabpanel')).not.toContainText('원문에 확인된 세부 시간·장소 정보가 없습니다.');
  await finish(page, info, fixture);
});

test('calendar collection polling fills all selected-company date ranges without reloading', async ({ page }, info) => {
  await page.clock.install({ time: new Date(fixtureNow) });
  const fixture = await reliabilityFixture(page);
  fixture.state.collectionCompanyId = companies[0].id;
  fixture.state.collectionPending = true;
  fixture.state.externalRegistered = true;
  const navigations: string[] = [];
  page.on('request', request => {
    if (request.isNavigationRequest() && request.resourceType() === 'document' && request.frame() === page.mainFrame()) navigations.push(request.url());
  });
  await page.goto('/calendar');
  const main = page.locator('main'), panels = calendarPanels(page);
  const nvidia = main.getByRole('checkbox', { name: `${companies[0].name} (${companies[0].ticker})`, exact: true });
  const appleChoice = main.getByRole('checkbox', { name: 'Apple (AAPL)', exact: true });
  const externalChoice = main.getByRole('checkbox', { name: 'Synthetic Orion Systems (ORNX)', exact: true });
  const collecting = main.getByText('공식 일정을 수집하고 있습니다. 완료되면 이 화면에 자동으로 표시됩니다.', { exact: true });
  await nvidia.check();
  await expect(main.getByRole('radio', { name: '특정 기업 선택', exact: true })).toBeChecked();
  await expect.poll(() => fixture.state.coverageQueries.at(-1)).toBe(companies[0].id);
  await expect(main.getByText('공식 일정을 수집하고 있습니다. 완료되면 이 화면에 자동으로 표시됩니다.', { exact: true })).toBeVisible();
  const refresh = main.getByRole('button', { name: '일정 새로고침', exact: true });
  await expect(refresh).toBeEnabled();
  await expect(panels.grid.getByRole('link')).toHaveCount(0);
  await expect(panels.upcoming.getByRole('heading')).toHaveText(/다가오는 일정\s*…/);
  await expect(panels.past.getByRole('heading')).toHaveText(/지난 일정\s*…/);
  await expect(main.getByText('확인된 예정 일정이 없습니다.', { exact: true })).toHaveCount(0);
  await expect(main.getByText('확인된 지난 일정이 없습니다.', { exact: true })).toHaveCount(0);
  await expect(main.getByText('선택한 기간과 기업 범위에 수집된 일정이 없습니다.', { exact: true })).toHaveCount(0);
  // A pending issuer must match the actual two-company selection, not merely
  // the global pending count returned when no single company ID is supplied.
  await appleChoice.check();
  await expect(collecting).toBeVisible();
  await expect(panels.past.getByRole('heading')).toHaveText(/지난 일정\s*…/);
  await nvidia.uncheck();
  await externalChoice.check();
  await expect(refresh).toBeEnabled();
  await expect(appleChoice).toBeChecked();await expect(externalChoice).toBeChecked();
  await expect(collecting).toHaveCount(0);
  await expect(panels.past.getByRole('heading')).toHaveText(/지난 일정\s*0/);
  await expect(panels.past.getByText('확인된 지난 일정이 없습니다.', { exact: true })).toBeVisible();
  await appleChoice.uncheck();
  await nvidia.check();
  await expect(nvidia).toBeChecked();await expect(externalChoice).toBeChecked();
  await expect(appleChoice).not.toBeChecked();
  await expect(collecting).toBeVisible();
  await expect(refresh).toBeEnabled();
  await expect(panels.grid.getByRole('link')).toHaveCount(0);
  await expect(panels.past.getByRole('heading')).toHaveText(/지난 일정\s*…/);
  const selection = `(origin.eq.user,company_id.in.(${[companies[0].id, externalId].sort().join(',')}))`;
  const initialRanges = [...new Set(fixture.state.calendarQueries.filter(query => new URLSearchParams(query).get('or') === selection))].sort();
  expect(initialRanges).toHaveLength(3);
  const before = fixture.state.calendarQueries.length;
  expectNoCalendarWrites(fixture);

  fixture.state.collectionPending = false;
  fixture.state.collectionReady = true;
  await page.clock.runFor(10000);
  await expectCollectedCalendar(page);
  expect([...new Set(fixture.state.calendarQueries.slice(before))].sort()).toEqual(initialRanges);
  await expect(panels.grid.getByRole('link', { name: /Synthetic October official event/ })).toHaveCount(0);
  await expect(page).toHaveURL(/\/calendar$/);
  expect(navigations).toHaveLength(1);
  expectNoCalendarWrites(fixture);
  await finish(page, info, fixture);
});

test('calendar collection keeps scope honest and stops polling until an explicit refresh', async ({ page }, info) => {
  await page.clock.install({ time: new Date(fixtureNow) });
  const fixture = await reliabilityFixture(page);
  fixture.state.collectionCompanyId = companies[0].id;
  fixture.state.collectionPending = true;
  fixture.state.externalRegistered = true;
  const followed = [companies[0].id, appleId];
  followed.forEach(id => fixture.base.state.watched.add(id));
  const navigations: string[] = [];
  page.on('request', request => {
    if (request.isNavigationRequest() && request.resourceType() === 'document' && request.frame() === page.mainFrame()) navigations.push(request.url());
  });
  await page.goto('/calendar');
  const main = page.locator('main'), panels = calendarPanels(page);
  const nvidia = main.getByRole('checkbox', { name: `${companies[0].name} (${companies[0].ticker})`, exact: true });
  const appleChoice = main.getByRole('checkbox', { name: 'Apple (AAPL)', exact: true });
  const all = main.getByRole('radio', { name: '전체 기업', exact: true });
  const selected = main.getByRole('radio', { name: '특정 기업 선택', exact: true });
  const refresh = main.getByRole('button', { name: '일정 새로고침', exact: true });
  const collecting = main.getByText('공식 일정을 수집하고 있습니다. 완료되면 이 화면에 자동으로 표시됩니다.', { exact: true });
  await nvidia.check();
  await expect(selected).toBeChecked();
  await all.check();
  await expect(nvidia).not.toBeChecked();
  await expect(appleChoice).not.toBeChecked();
  await appleChoice.check();
  await expect(selected).toBeChecked();
  await expect(nvidia).not.toBeChecked();
  await expect.poll(() => fixture.state.coverageQueries.at(-1)).toBe(appleId);
  await expect.poll(() => fixture.state.calendarQueries.some(query => new URLSearchParams(query).get('or') === `(origin.eq.user,company_id.in.(${appleId}))`)).toBe(true);
  await main.getByRole('radio', { name: '관심 기업', exact: true }).check();
  await expect(appleChoice).not.toBeChecked();
  await expect(nvidia).not.toBeChecked();
  await expect(collecting).toBeVisible();
  await expect(panels.past.getByRole('heading')).toHaveText(/지난 일정\s*…/);
  expectNoCalendarWrites(fixture, followed);
  // The server queue can move to an unrelated issuer while the owner's two
  // followed companies remain unchanged. Refresh is a read, never a follow.
  fixture.state.collectionCompanyId = externalId;
  await expect(refresh).toBeEnabled();
  await refresh.click();
  await expect(refresh).toBeEnabled();
  await expect(collecting).toHaveCount(0);
  await expect(panels.past.getByRole('heading')).toHaveText(/지난 일정\s*0/);
  await expect(panels.past.getByText('확인된 지난 일정이 없습니다.', { exact: true })).toBeVisible();
  expect(fixture.state.collectionPending).toBe(true);
  expectNoCalendarWrites(fixture, followed);
  fixture.state.collectionCompanyId = companies[0].id;
  await nvidia.check();
  await expect(selected).toBeChecked();
  await expect(nvidia).toBeChecked();
  await expect(appleChoice).not.toBeChecked();
  await expect.poll(() => fixture.state.coverageQueries.at(-1)).toBe(companies[0].id);
  await all.check();
  await expect(nvidia).not.toBeChecked();
  await expect.poll(() => fixture.state.coverageQueries.at(-1)).toBe(null);
  await expect(refresh).toBeEnabled();
  await expect(panels.grid.getByRole('link', { name: /Synthetic October official event/ })).toBeVisible();
  await expect(panels.past.getByRole('heading')).toHaveText(/지난 일정\s*…/);
  const initialRanges = [...new Set(fixture.state.calendarQueries.filter(query => {
    const params = new URLSearchParams(query); return !params.has('or') && !params.has('company_id') && !params.has('origin');
  }))].sort();
  expect(initialRanges).toHaveLength(3);
  const initialCoverage = fixture.state.coverageQueries.length;
  for (let poll = 1; poll <= 12; poll++) {
    await page.clock.runFor(10000);
    await expect.poll(() => fixture.state.coverageQueries.length).toBe(initialCoverage + poll);
    await expect(refresh).toBeEnabled();
  }
  await expect(main.getByText('공식 일정 수집이 계속 진행 중입니다. 잠시 후 일정 새로고침을 눌러 확인해 주세요.', { exact: true })).toBeVisible();
  await page.clock.runFor(30000);
  expect(fixture.state.coverageQueries).toHaveLength(initialCoverage + 12);
  const before = fixture.state.calendarQueries.length;
  fixture.state.collectionPending = false;
  fixture.state.collectionReady = true;
  await refresh.click();
  await expectCollectedCalendar(page);
  await expect(panels.grid.getByRole('link', { name: /Synthetic October official event/ })).toBeVisible();
  expect([...new Set(fixture.state.calendarQueries.slice(before))].sort()).toEqual(initialRanges);
  await expect(all).toBeChecked();
  await expect(nvidia).not.toBeChecked();
  await expect(appleChoice).not.toBeChecked();
  expect(navigations).toHaveLength(1);
  expectNoCalendarWrites(fixture, followed);
  await finish(page, info, fixture);
});

test('calendar request errors remain visible and retry restores the month', async ({ page }, info) => {
  const fixture = await reliabilityFixture(page);
  fixture.state.calendarFails = true;
  await page.goto('/calendar');
  const grid = page.locator('.rd-calendar-grid-card');
  await expect(grid.getByRole('alert')).toContainText('일정을 불러오지 못했습니다.');
  await expect(grid).not.toContainText('등록된 일정이 없습니다.');
  fixture.state.calendarFails = false;
  await grid.getByRole('alert').getByRole('button', { name: '다시 시도', exact: true }).click();
  await expect(grid.getByRole('alert')).toHaveCount(0);
  await expect(grid.getByRole('link', { name: /Synthetic October official event/ })).toBeVisible();
  await finish(page, info, fixture);
});

test('watchlist discovers an unregistered issuer, follows explicitly, and persists before removal', async ({ page }, info) => {
  const fixture = await reliabilityFixture(page);
  await page.goto('/watchlist');
  const main = page.locator('main');
  await main.getByRole('textbox', { name: '관심 기업 검색', exact: true }).fill('ORNX');
  const select = main.getByRole('button', { name: 'Synthetic Orion Systems 관심 기업에 추가', exact: true });
  await expect(select).toBeVisible();
  expect(fixture.state.resolutionBodies).toEqual([]);
  expect(fixture.base.state.watched.size).toBe(0);
  await select.click();
  const card = main.locator('.rd-w-card').filter({ hasText: externalIssuer.name });
  await expect(card).toBeVisible();
  await expect(page).toHaveURL(/\/watchlist$/);
  expect(fixture.state.resolutionBodies).toHaveLength(1);
  expect(fixture.base.state.watched.has(externalId)).toBe(true);
  expect(fixture.base.state.apiCalls.filter(call => call.method === 'PUT'
    && call.path === `/v1/watchlist/${externalId}`)).toHaveLength(1);
  await page.reload();
  await expect(card).toBeVisible();
  await card.locator('summary').click();
  await card.getByRole('button', { name: 'Synthetic Orion Systems 팔로우 취소', exact: true }).click();
  await expect(card).toHaveCount(0);
  expect(fixture.base.state.watched.has(externalId)).toBe(false);
  await finish(page, info, fixture);
});

test('calendar discovers an unregistered issuer and saves personal events only explicitly', async ({ page }, info) => {
  const fixture = await reliabilityFixture(page);
  await page.goto('/calendar');
  const main = page.locator('main');
  await main.getByRole('textbox', { name: '기업명 또는 티커 검색', exact: true }).fill('ORNX');
  await main.getByRole('button', { name: 'Synthetic Orion Systems 일정 조회 기업으로 선택', exact: true }).click();
  await expect(main.getByRole('radio', { name: '특정 기업 선택', exact: true })).toBeChecked();
  await expect(main.getByRole('checkbox', { name: 'Synthetic Orion Systems (ORNX)', exact: true })).toBeChecked();
  await expect.poll(() => fixture.state.calendarQueries.some(query =>
    new URLSearchParams(query).get('or') === `(origin.eq.user,company_id.in.(${externalId}))`)).toBe(true);
  await expect(main.locator('.rd-calendar-grid').getByRole('link')).toHaveCount(0);
  await expect(page).toHaveURL(/\/calendar$/);
  expect(fixture.state.resolutionBodies).toHaveLength(1);
  expect(fixture.base.state.watched.size).toBe(0);
  expect(fixture.base.state.apiCalls.filter(call => call.method !== 'GET')).toEqual([]);
  await main.getByRole('button', { name: '개인 일정 추가', exact: true }).click();
  const form = page.getByRole('dialog');
  await form.getByLabel('제목', { exact: true }).fill('Synthetic explicit-save reminder');
  await form.getByLabel('날짜', { exact: true }).fill('2026-11-10');
  const companySearch = form.getByLabel('관련 기업 검색', { exact: true });
  await companySearch.fill('ORNX');
  await companySearch.press('Enter');
  const choose = form.getByRole('button', { name: 'Synthetic Orion Systems (ORNX) · 관련 기업으로 선택', exact: true });
  await expect(choose).toBeVisible();
  expect(fixture.base.state.apiCalls.filter(call => call.method === 'POST' && call.path === '/v1/calendar')).toEqual([]);
  await choose.click();
  await expect(form.getByRole('combobox', { name: '관련 기업 (선택)', exact: true })).toHaveValue(externalId);
  expect(fixture.base.state.apiCalls.filter(call => call.method === 'POST' && call.path === '/v1/calendar')).toEqual([]);
  await form.getByRole('button', { name: '일정 저장', exact: true }).click();
  await expect(form).toHaveCount(0);
  const saved = fixture.base.state.apiCalls.filter(call => call.method === 'POST' && call.path === '/v1/calendar');
  expect(saved).toHaveLength(1);
  expect(saved[0].body).toMatchObject({ title: 'Synthetic explicit-save reminder', occurs_on: '2026-11-10', company_id: externalId });
  expect(fixture.base.state.watched.size).toBe(0);
  await finish(page, info, fixture);
});
