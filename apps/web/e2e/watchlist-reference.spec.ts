import { expect, test, type Page, type Route, type TestInfo } from '@playwright/test';
import { companies, fixtureNow } from './mobile-fixture';
import { approved, filing, researchWorkspaceFixture, sourceUrl } from './research-workspace-fixture';
import { resourceSchema, sourceOverviewSchema, workspaceRequest } from '../src/workspace/contracts';
import { calendarEntrySchema } from '../src/redesign/calendar-utils';
import type { Company } from '../src/lib/contracts';

// Every identity, document, count, and mutation in this file is an isolated
// transport fixture. No provider or real account is read or written by the suite.
const referenceCompanies: Company[] = [
  { ...companies[0], name: 'NVIDIA' },
  { ...companies[3], name: 'Microsoft' },
  { ...companies[1], name: 'Apple' },
  { ...companies[2], id: '20000000-0000-4000-8000-000000000995', name: '삼성전자', ticker: '005930', market: 'KRX', provider: 'dart' },
];
const unrelated = { ...companies[4], name: 'Unfollowed synthetic issuer', market: 'LSE' };
const filingDays = ['2026-10-01', '2026-10-05', '2026-10-04', '2026-10-03'];
const reviewDays = ['2026-10-06', '2026-10-05', '2026-10-04', '2026-10-03'];
const records = [...referenceCompanies, unrelated].map((company, i) => {
  const disclosure = resourceSchema.parse({
    ...filing, id: `40000000-0000-4000-8000-${String(970 + i).padStart(12, '0')}`,
    company_id: company.id, company_name: company.name, ticker: company.ticker, market: company.market,
    title: `${company.name} 검증용 분기 공시`, published_at: `${filingDays[i] ?? '2026-10-06'}T01:00:00Z`,
    publication_precision: 'date', provider: company.provider === 'dart' ? 'dart' : 'sec',
  });
  const analysis = resourceSchema.parse({
    ...approved, id: disclosure.id, filing_id: disclosure.id,
    kind: company.provider === 'dart' ? 'dart_analysis' : 'us_analysis',
    company_id: company.id, company_name: company.name, ticker: company.ticker, market: company.market,
    title: `${company.name} 검증용 승인 분석`, published_at: disclosure.published_at,
    reviewed_at: `${reviewDays[i] ?? '2026-10-06'}T02:00:00Z`,
  });
  return { company_id: company.id, latest_filing: disclosure, latest_analysis: analysis,
    next_event: null, last_collected_at: fixtureNow, filing_count: 3 + i, analysis_count: 2 + i };
});
const dates = [
  { company_id: referenceCompanies[0].id, title: '검증용 분기 실적발표', occurs_on: '2026-10-26' },
  { company_id: referenceCompanies[1].id, title: '검증용 기업 설명회', occurs_on: '2026-10-22' },
  { company_id: referenceCompanies[3].id, title: '검증용 실적발표', occurs_on: '2026-10-10' },
  { company_id: referenceCompanies[3].id, title: '검증용 투자자 설명회', occurs_on: '2026-10-15' },
  { company_id: unrelated.id, title: 'Unfollowed event must stay hidden', occurs_on: '2026-10-07' },
  { company_id: referenceCompanies[0].id, title: 'Personal reminder must stay hidden', occurs_on: '2026-10-08', origin: 'user' },
  { company_id: referenceCompanies[3].id, title: 'Past event must stay hidden', occurs_on: '2026-10-05' },
  { company_id: referenceCompanies[0].id, title: 'Distant event must stay hidden', occurs_on: '2027-10-07' },
].map((entry, i) => calendarEntrySchema.parse({
  id: `80000000-0000-4000-8000-${String(970 + i).padStart(12, '0')}`,
  event_id: null, origin: 'official', quote: 'Synthetic official calendar fixture.',
  source_url: sourceUrl, source_timezone: 'Asia/Seoul', verified_at: fixtureNow, ...entry,
}));

function cors(route: Route) {
  return {
    'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': route.request().headers()['access-control-request-headers']
      ?? 'authorization,apikey,content-type,x-client-info',
  };
}

async function referenceFixture(page: Page) {
  const base = await researchWorkspaceFixture(page);
  base.state.preferences.locale = 'ko';
  referenceCompanies.forEach(company => base.state.watched.add(company.id));
  base.state.preferences.muted_companies = [referenceCompanies[2].id];
  const control = { removeFails: false, preferenceFails: false, calendarFails: false };
  const servedWatchlistScopes = new Set<string>();
  await page.route('**/v1/watchlist', async route => {
    expect(route.request().method()).toBe('GET');
    expect(route.request().headers().authorization).toMatch(/^Bearer /);
    base.state.apiCalls.push({ method: 'GET', path: '/v1/watchlist', body: null });
    servedWatchlistScopes.add(`in.(${[...base.state.watched].sort().join(',')})`);
    await route.fulfill({ json: {
      id: '10000000-0000-4000-8000-000000000002', name: 'Synthetic reference watchlist',
      items: referenceCompanies.filter(company => base.state.watched.has(company.id)),
    } });
  });
  await page.route('**/v1/companies?**', async route => {
    expect(route.request().method()).toBe('GET');
    expect(route.request().headers().authorization).toMatch(/^Bearer /);
    const query = (new URL(route.request().url()).searchParams.get('q') ?? '').toLowerCase();
    await route.fulfill({ json: referenceCompanies.filter(company =>
      `${company.name} ${company.ticker}`.toLowerCase().includes(query)) });
  });
  await page.route('**/v1/watchlist/*', async route => {
    expect(route.request().headers().authorization).toMatch(/^Bearer /);
    if (control.removeFails && route.request().method() === 'DELETE') {
      const path = new URL(route.request().url()).pathname;
      base.state.apiCalls.push({ method: 'DELETE', path: path.slice(path.indexOf('/v1/')), body: null });
      await route.fulfill({ status: 503, json: { error: { code: 'synthetic_remove_failure' } } });
      return;
    }
    await route.fallback();
  });
  await page.route('**/api/workspace', async route => {
    const payload = workspaceRequest.parse(route.request().postDataJSON());
    if (payload.action === 'preferences_save' && control.preferenceFails) {
      base.state.calls.push(payload);
      await route.fulfill({ status: 503, json: { error: { code: 'synthetic_preference_failure' } } });
      return;
    }
    if (payload.action !== 'source_overview') { await route.fallback(); return; }
    expect(route.request().headers().authorization).toMatch(/^Bearer /);
    base.state.calls.push(payload);
    // Deliberately return an all-company fallback, even after the watchlist is
    // empty. Personal rows/sidebar must be constrained by the watchlist itself.
    await route.fulfill({ json: sourceOverviewSchema.parse({
      companies: records.length, filing_count: 25, published_count: 20,
      filings: records.map(row => row.latest_filing), analyses: records.map(row => row.latest_analysis),
      historical_events: [], calendar: [], historical_calendar: [],
      scope: 'all', following_count: base.state.watched.size, fallback_to_all: true,
      monitoring: records,
    }) });
  });
  await page.route('https://test-project.supabase.co/rest/v1/calendar_items?**', async route => {
    const headers = cors(route);
    if (route.request().method() === 'OPTIONS') { await route.fulfill({ status: 204, headers }); return; }
    expect(route.request().method()).toBe('GET');
    expect(route.request().headers().authorization).toMatch(/^Bearer /);
    const params = new URL(route.request().url()).searchParams;
    base.calendarQueries.push(params.toString());
    // A write can refresh the calendar while the replacement watchlist read is
    // pending. Each request must still use an actually returned personal scope.
    expect(servedWatchlistScopes.has(params.get('company_id') ?? '')).toBe(true);
    expect(params.get('origin')).toBe('neq.user');
    expect(params.get('calendar_status')).toBe('eq.confirmed');
    expect(params.has('or')).toBe(false);
    expect(params.getAll('occurs_on')).toEqual(['gte.2026-10-06', 'lte.2027-10-06']);
    await route.fulfill(control.calendarFails
      ? { status: 503, headers, json: { message: 'Synthetic calendar outage' } }
      : { headers, json: [...dates, dates[2]] });
  });
  return { ...base, referenceControl: control };
}
type ReferenceFixture = Awaited<ReturnType<typeof referenceFixture>>;

function expectClean(fixture: ReferenceFixture) {
  expect(fixture.blockedRequests, 'No price, portfolio, or unrelated provider calls').toEqual([]);
  expect(fixture.state.unexpected, 'Every request stays inside the isolated fixtures').toEqual([]);
  expect(fixture.state.runtimeErrors, 'No React or hydration errors').toEqual([]);
}

async function viewportFits(page: Page) {
  await expect.poll(() => page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth),
  'Watchlist must fit the viewport').toBeLessThanOrEqual(1);
}

async function screenshot(page: Page, info: TestInfo, name: string) {
  await viewportFits(page);
  await page.screenshot({ path: info.outputPath(`${name}.png`), fullPage: true, animations: 'disabled' });
}

async function companyStyles(page: Page) {
  return page.locator('[data-screen="redesign-companies"]').evaluate(element => {
    const selectors = ['h1', '.rd-companies', '.rd-company-card', '.rd-company-card-top'];
    return Object.fromEntries(selectors.map(selector => {
      const style = getComputedStyle(element.querySelector(selector)!);
      return [selector, { display: style.display, columns: style.gridTemplateColumns,
        fontSize: style.fontSize, padding: style.padding, gap: style.gap,
        color: style.color, background: style.backgroundColor, border: style.border,
      }];
    }));
  });
}

test('reference layout keeps personal data scoped, supports filters, and preserves the Companies screen', async ({ page }, info) => {
  const mobile = info.project.name === 'mobile';
  await page.setViewportSize({ width: mobile ? 320 : 1259, height: 900 });
  const fixture = await referenceFixture(page);
  await page.goto('/explore');
  await expect(page.locator('.rd-company-card')).toHaveCount(companies.length);
  const before = await companyStyles(page);
  const nav = page.getByRole('navigation', { name: '주 메뉴', exact: true });
  await nav.getByRole('link', { name: '관심 기업', exact: true }).click();
  await expect(nav.getByRole('link', { name: '관심 기업', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(nav.getByRole('link', { name: '기업', exact: true })).not.toHaveAttribute('aria-current', 'page');
  const watchlist = page.locator('[data-screen="redesign-watchlist"]');
  const cards = watchlist.locator('.rd-w-card');
  const names = cards.locator('.rd-p-company-identity strong');
  await expect(watchlist.getByRole('heading', { name: '관심 기업', exact: true })).toBeVisible();
  await expect(names).toHaveText(referenceCompanies.map(company => company.name));
  await expect(cards.locator('.rd-w-activity')).toHaveCount(12);
  const upcoming = watchlist.getByRole('region', { name: '다가오는 일정', exact: true });
  await expect(upcoming.locator('.rd-w-event')).toHaveCount(4);
  await expect(upcoming.locator('time')).toHaveText(['2026년 10월 10일', '2026년 10월 15일', '2026년 10월 22일', '2026년 10월 26일']);
  await expect(watchlist).not.toContainText(/must stay hidden|Unfollowed synthetic issuer/);
  await expect(upcoming.locator('time').first()).toHaveAttribute('datetime', '2026-10-10');
  await expect(cards.first().getByRole('link', { name: `다음 일정 ${dates[0].title}`, exact: true }))
    .toHaveAttribute('href', `/events/${dates[0].id}?kind=calendar`);
  await expect(watchlist.locator('.rd-w-ranking .rd-w-side-company')).toHaveText(referenceCompanies.map(company => company.name));
  await expect(watchlist.locator('.rd-w-ranking').first()).toContainText('공시 3건 · 분석 2건');
  await expect(watchlist.locator('.rd-w-panel').last()).toContainText('최신 자료순 · 누적 공시·승인 분석');

  const mainBox = await watchlist.locator('.rd-w-main').boundingBox();
  const sideBox = await watchlist.locator('.rd-w-sidebar').boundingBox();
  const tileBoxes = await cards.first().locator('.rd-w-activity').evaluateAll(elements =>
    elements.map(element => { const box = element.getBoundingClientRect(); return { x: box.x, y: box.y, width: box.width }; }));
  if (mobile) {
    expect(sideBox!.y).toBeGreaterThanOrEqual(mainBox!.y + mainBox!.height - 1);
    expect(tileBoxes[1].y).toBeGreaterThan(tileBoxes[0].y);
    expect(tileBoxes[2].y).toBeGreaterThan(tileBoxes[1].y);
  } else {
    expect(sideBox!.x).toBeGreaterThan(mainBox!.x + mainBox!.width);
    expect(Math.abs(sideBox!.y - mainBox!.y)).toBeLessThanOrEqual(1);
    expect(tileBoxes[1].x).toBeGreaterThan(tileBoxes[0].x);
    expect(tileBoxes[2].x).toBeGreaterThan(tileBoxes[1].x);
    expect(Math.abs(tileBoxes[2].y - tileBoxes[0].y)).toBeLessThanOrEqual(1);
    expect((await cards.first().boundingBox())!.height).toBeLessThan(150);
  }
  await screenshot(page, info, mobile ? 'watchlist-reference-320px' : 'watchlist-reference-desktop');

  const filters = watchlist.getByRole('group', { name: '관심 기업 필터', exact: true });
  await filters.getByRole('button', { name: '한국', exact: true }).focus();
  await filters.getByRole('button', { name: '한국', exact: true }).press('Enter');
  await expect(filters.getByRole('button', { name: '한국', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(names).toHaveText(['삼성전자']);
  await filters.getByRole('button', { name: '미국', exact: true }).click();
  await expect(names).toHaveText(['NVIDIA', 'Microsoft', 'Apple']);
  await filters.getByRole('button', { name: '알림 켬', exact: true }).click();
  await expect(names).toHaveText(['NVIDIA', 'Microsoft', '삼성전자']);
  await filters.getByRole('button', { name: '일정 예정', exact: true }).click();
  await expect(names).toHaveText(['NVIDIA', 'Microsoft', '삼성전자']);
  await filters.getByRole('button', { name: '전체', exact: true }).click();
  await watchlist.getByRole('combobox', { name: '관심 기업 정렬', exact: true }).selectOption('event');
  await expect(names).toHaveText(['삼성전자', 'Microsoft', 'NVIDIA', 'Apple']);
  await watchlist.getByRole('combobox', { name: '관심 기업 정렬', exact: true }).selectOption('name');
  await expect(names).toHaveText([...referenceCompanies].sort((a, b) => a.name.localeCompare(b.name, 'ko')).map(company => company.name));
  await watchlist.getByRole('textbox', { name: '관심 기업 검색', exact: true }).fill('MSFT');
  await expect(names).toHaveText(['Microsoft']);
  await viewportFits(page);
  await watchlist.getByRole('textbox', { name: '관심 기업 검색', exact: true }).fill('');
  await expect(cards).toHaveCount(4);
  await nav.getByRole('link', { name: '기업', exact: true }).click();
  await expect(nav.getByRole('link', { name: '기업', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.rd-company-card')).toHaveCount(companies.length);
  await expect(page.locator('.rd-w-page')).toHaveCount(0);
  expect(await companyStyles(page), 'Retained Watchlist CSS must not change Companies').toEqual(before);
  expect(fixture.state.apiCalls.filter(call => call.method !== 'GET')).toEqual([]);
  expectClean(fixture);
});

test('notification and overflow controls preserve failed writes and persist confirmed changes after reload', async ({ page }, info) => {
  await page.setViewportSize({ width: info.project.name === 'mobile' ? 320 : 1259, height: 900 });
  const fixture = await referenceFixture(page);
  await page.goto('/watchlist');
  const card = page.getByRole('article', { name: 'NVIDIA 관심 기업', exact: true });
  const toggle = card.getByRole('switch', { name: 'NVIDIA 알림', exact: true });
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  fixture.referenceControl.preferenceFails = true;
  await toggle.click();
  await expect(page.getByRole('alert').filter({ hasText: '서비스 업데이트를 준비 중입니다.' }).first()).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  expect(fixture.state.preferences.muted_companies).not.toContain(referenceCompanies[0].id);
  fixture.referenceControl.preferenceFails = false;
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await page.reload();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  expect(fixture.state.preferences.muted_companies).toContain(referenceCompanies[0].id);

  const menu = card.getByLabel('NVIDIA 메뉴', { exact: true });
  await menu.focus();
  await menu.press('Enter');
  await expect(card.locator('details')).toHaveAttribute('open', '');
  await menu.press('Escape');
  await expect(card.locator('details')).not.toHaveAttribute('open', '');
  await expect(menu).toBeFocused();
  await menu.click();
  fixture.referenceControl.removeFails = true;
  await card.getByRole('button', { name: 'NVIDIA 팔로우 취소', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'synthetic_remove_failure' })).toBeVisible();
  await expect(card).toBeVisible();
  expect(fixture.state.watched.has(referenceCompanies[0].id)).toBe(true);
  fixture.referenceControl.removeFails = false;
  await card.getByRole('button', { name: 'NVIDIA 팔로우 취소', exact: true }).click();
  await expect(card).toHaveCount(0);
  await page.reload();
  await expect(card).toHaveCount(0);
  await expect(page.locator('.rd-w-card')).toHaveCount(3);
  await expect(page.locator('.rd-w-event .rd-w-side-company')).not.toContainText(['NVIDIA']);
  await expect(page.locator('.rd-w-ranking .rd-w-side-company')).not.toContainText(['NVIDIA']);
  expect(fixture.state.watched.has(referenceCompanies[0].id)).toBe(false);
  await page.getByRole('button', { name: '기업 추가', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox', { name: '추가할 기업 검색', exact: true }).fill('NVDA');
  await dialog.getByRole('button', { name: '추가', exact: true }).click();
  await expect(dialog.getByRole('button', { name: '추가됨', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: '닫기', exact: true }).click();
  await expect(card).toBeVisible();
  await page.reload();
  await expect(card).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  expect(fixture.state.watched.has(referenceCompanies[0].id)).toBe(true);
  await viewportFits(page);
  expectClean(fixture);
});

test('calendar errors retry independently and an empty watchlist never exposes the all-company fallback', async ({ page }, info) => {
  await page.setViewportSize({ width: info.project.name === 'mobile' ? 320 : 1259, height: 900 });
  const fixture = await referenceFixture(page);
  fixture.referenceControl.calendarFails = true;
  await page.goto('/watchlist');
  const watchlist = page.locator('[data-screen="redesign-watchlist"]');
  const upcoming = watchlist.getByRole('region', { name: '다가오는 일정', exact: true });
  await expect(watchlist.locator('.rd-w-card')).toHaveCount(4);
  await expect(upcoming.getByRole('alert')).toContainText('일정을 불러오지 못했습니다.');
  await expect(upcoming).not.toContainText('확인된 관심 기업 일정이 없습니다.');
  await expect(watchlist.locator('.rd-w-ranking')).toHaveCount(4);
  fixture.referenceControl.calendarFails = false;
  await upcoming.getByRole('button', { name: '다시 시도', exact: true }).click();
  await expect(upcoming.locator('.rd-w-event')).toHaveCount(4);
  await expect(upcoming.getByRole('alert')).toHaveCount(0);
  const reads = fixture.calendarQueries.length;
  fixture.state.watched.clear();
  await page.reload();
  await expect(watchlist.getByText('첫 관심 기업을 추가해 보세요.', { exact: true })).toBeVisible();
  await expect(watchlist.locator('.rd-w-card')).toHaveCount(0);
  await expect(watchlist.locator('.rd-w-ranking')).toHaveCount(0);
  await expect(upcoming.locator('.rd-w-event')).toHaveCount(0);
  await expect(upcoming).toContainText('관심 기업을 추가하면 예정 일정을 확인할 수 있습니다.');
  await expect(watchlist).not.toContainText(/검증용 분기 공시|검증용 승인 분석|must stay hidden/);
  expect(fixture.calendarQueries.length, 'An empty watchlist must not make a broad calendar request').toBe(reads);
  expect(fixture.state.apiCalls.filter(call => call.method !== 'GET')).toEqual([]);
  await viewportFits(page);
  expectClean(fixture);
});
