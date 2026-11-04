import { expect, test, type Page, type Route } from '@playwright/test';
import { companies, companyId, fixtureNow } from './mobile-fixture';
import {
  approved, filing, historical, researchWorkspaceFixture, sourceId, upcoming,
  type ResearchFixture,
} from './research-workspace-fixture';
import { resourceSchema, sourceOverviewSchema, workspaceRequest } from '../src/workspace/contracts';
import { calendarEntrySchema } from '../src/redesign/calendar-utils';

// Synthetic browser fixtures only: no real account, provider, or production writes.
// Keep the fixed authenticated fixture clock: moving it forward expires its JWT.
const homeNow = fixtureNow;
const otherCompany = companies[1];
const otherFiling = resourceSchema.parse({
  ...filing, id: '40000000-0000-4000-8000-000000000901',
  company_id: otherCompany.id, company_name: otherCompany.name, ticker: otherCompany.ticker,
  title: 'Synthetic unrelated company disclosure', published_at: homeNow,
});
const otherAnalysis = resourceSchema.parse({
  ...approved, id: '40000000-0000-4000-8000-000000000902', filing_id: otherFiling.id,
  company_id: otherCompany.id, company_name: otherCompany.name, ticker: otherCompany.ticker,
  title: 'Synthetic unrelated company approved excerpt', reviewed_at: homeNow,
});
const noisyCalendar = [
  { ...upcoming, occurs_on: '2026-10-14', event_id: null, origin: 'official_ir', quote: 'Synthetic confirmed event.' },
  { ...historical, event_id: null, origin: 'official_ir', quote: 'Synthetic past event.' },
  { ...upcoming, id: '80000000-0000-4000-8000-000000000903', company_id: otherCompany.id,
    title: 'Synthetic unrelated upcoming event', occurs_on: '2026-10-07',
    event_id: null, origin: 'official_ir', quote: 'Synthetic other-company event.' },
  { ...upcoming, id: '80000000-0000-4000-8000-000000000904',
    title: 'Synthetic personal reminder', occurs_on: '2026-10-08',
    event_id: null, origin: 'user', quote: null },
  { ...upcoming, id: '80000000-0000-4000-8000-000000000905',
    title: 'Synthetic event beyond the home window', occurs_on: '2026-11-06',
    event_id: null, origin: 'official_ir', quote: 'Synthetic later event.' },
].map(item => calendarEntrySchema.parse(item));

function cors(route: Route) {
  return {
    'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': route.request().headers()['access-control-request-headers']
      ?? 'authorization,apikey,content-type,x-client-info',
  };
}

function expectClean(fixture: ResearchFixture) {
  expect(fixture.blockedRequests, 'No market data or unrelated provider requests').toEqual([]);
  expect(fixture.state.unexpected, 'Every API call stays inside the isolated fixture').toEqual([]);
  expect(fixture.state.runtimeErrors, 'No React or hydration errors').toEqual([]);
  expect(fixture.state.apiCalls.filter(call => call.method !== 'GET'), 'Reading Home never edits the watchlist').toEqual([]);
}

async function expectViewportFit(page: Page) {
  await expect.poll(() => page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth,
  ), 'The dashboard must fit the viewport').toBeLessThanOrEqual(1);
}

test('home keeps monitoring and explicitly followed-company events within the actual watchlist even when a response includes unrelated records', async ({ page }) => {
  const fixture = await researchWorkspaceFixture(page, { following: true });
  await page.clock.setFixedTime(new Date(homeNow));
  await page.route('**/api/workspace', async route => {
    const payload = workspaceRequest.parse(route.request().postDataJSON());
    if (payload.action !== 'source_overview') {
      await route.fallback(); return;
    }
    expect(route.request().headers().authorization).toMatch(/^Bearer /);
    fixture.state.calls.push(payload);
    // Reproduce an all-company fallback. The authoritative watchlist must still
    // constrain the compact homepage rows, including newer unrelated entries.
    await route.fulfill({ json: sourceOverviewSchema.parse({
      companies: 2, filing_count: 2, published_count: 2,
      filings: [filing, otherFiling], analyses: [approved, otherAnalysis],
      historical_events: [], calendar: [upcoming], historical_calendar: [historical],
      scope: 'all', following_count: 1, fallback_to_all: true,
      monitoring: [
        { company_id: companyId, latest_filing: filing, latest_analysis: approved,
          next_event: upcoming, last_collected_at: homeNow },
        { company_id: otherCompany.id, latest_filing: otherFiling, latest_analysis: otherAnalysis,
          next_event: null, last_collected_at: homeNow },
      ],
    }) });
  });
  await page.route('https://test-project.supabase.co/rest/v1/calendar_items?**', async route => {
    const headers = cors(route);
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers }); return;
    }
    expect(route.request().method()).toBe('GET');
    expect(route.request().headers().authorization).toMatch(/^Bearer /);
    const url = new URL(route.request().url());
    fixture.calendarQueries.push(url.search);
    expect(url.searchParams.get('calendar_status')).toBe('eq.confirmed');
    expect([null, `in.(${companyId})`]).toContain(url.searchParams.get('company_id'));
    expect(url.searchParams.has('or')).toBe(false);
    expect(url.searchParams.get('origin')).toBe('neq.user');
    expect(url.searchParams.getAll('occurs_on')).toEqual(['gte.2026-10-06', 'lte.2026-11-05']);
    // Deliberately overbroad fixture data also exercises the homepage's final
    // date/company/origin guard without changing the existing query contract.
    await route.fulfill({ headers, json: noisyCalendar });
  });

  await page.goto('/today');
  await expect(page.getByRole('heading', { name: '관심 기업 1곳의 주요 소식을 모았습니다.', exact: true })).toBeVisible();
  const updates = page.locator('.rd-home-following');
  const dates = page.locator('.rd-home-upcoming');
  const scope = dates.getByRole('group', { name: '다가오는 일정 기업 범위', exact: true });
  await expect(updates.locator('.rd-home-update')).toHaveCount(3);
  await expect(updates.locator('.rd-home-company')).toHaveText(Array(3).fill(companies[0].name));
  await expect(updates.getByRole('link', { name: `${companies[0].name} 공시 ${filing.title}`, exact: true }))
    .toHaveAttribute('href', `/documents/${sourceId}?kind=filing`);
  await expect(updates.getByRole('link', { name: `${companies[0].name} 분석 ${approved.title}`, exact: true }))
    .toHaveAttribute('href', `/documents/${sourceId}?kind=filing&analysis=us`);
  const news = updates.getByRole('link', { name: `${companies[0].name} 뉴스 Synthetic company news article · 새 탭에서 열기`, exact: true });
  await expect(news).toHaveAttribute('href', 'https://www.nvidia.com/en-us/about-nvidia/');
  await expect(news).toHaveAttribute('target', '_blank');
  await expect(news).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(updates).not.toContainText(otherFiling.title);
  await expect(updates).not.toContainText(otherAnalysis.title);
  await expect(updates).not.toContainText(otherCompany.name);
  const followingCalls = fixture.state.calls.filter(call => call.action === 'source_overview');
  expect(followingCalls.length).toBeGreaterThan(0);
  for (const call of followingCalls) expect(call.p).toEqual({ scope: 'following', days: 0 });

  await expect(scope.getByRole('button', { name: '전체 기업', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(dates.locator('.rd-home-event')).toHaveCount(2);
  expect(fixture.calendarQueries.length).toBeGreaterThan(0);
  for (const query of fixture.calendarQueries) expect(new URLSearchParams(query).has('company_id')).toBe(false);
  await scope.getByRole('button', { name: '관심 기업', exact: true }).click();
  await expect(scope.getByRole('button', { name: '관심 기업', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(scope.getByRole('button', { name: '전체 기업', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(() => fixture.calendarQueries.some(query =>
    new URLSearchParams(query).get('company_id') === `in.(${companyId})`,
  )).toBe(true);
  await expect(dates.locator('.rd-home-event')).toHaveCount(1);
  await expect(dates.getByRole('link', { name: new RegExp(upcoming.title) }))
    .toHaveAttribute('href', `/events/${upcoming.id}?kind=calendar`);
  await expect(dates.locator('time')).toHaveAttribute('datetime', noisyCalendar[0].occurs_on);
  await expect(dates.locator('.rd-home-event-meta')).toHaveText('날짜 확정');
  for (const excluded of noisyCalendar.slice(1)) await expect(dates).not.toContainText(excluded.title);
  await expect(dates).not.toContainText(/\b\d{1,2}:\d{2}\b|종일/);
  await expectViewportFit(page);

  // Removing every follow clears monitoring. Home reloads in all-company mode;
  // explicitly selecting following again must clear dates without a broad query.
  const overviewReads = followingCalls.length;
  fixture.state.watched.clear();
  await page.reload();
  await expect(page.getByRole('heading', { name: '첫 관심 기업을 추가해 보세요.', exact: true })).toBeVisible();
  await expect(updates).toContainText('관심 기업을 추가하면 최신 소식을 확인할 수 있습니다.');
  await expect(updates.locator('.rd-home-update')).toHaveCount(0);
  await expect(scope.getByRole('button', { name: '전체 기업', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(dates.locator('.rd-home-event')).toHaveCount(2);
  const calendarReads = fixture.calendarQueries.length;
  await scope.getByRole('button', { name: '관심 기업', exact: true }).click();
  await expect(scope.getByRole('button', { name: '관심 기업', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(dates).toContainText('관심 기업을 추가하면 다가오는 일정을 확인할 수 있습니다.');
  await expect(dates.locator('.rd-home-event')).toHaveCount(0);
  await expect(updates).not.toContainText(filing.title);
  await expect(dates).not.toContainText(upcoming.title);
  expect(fixture.calendarQueries).toHaveLength(calendarReads);
  expect(fixture.state.calls.filter(call => call.action === 'source_overview')).toHaveLength(overviewReads);
  expectClean(fixture);
});

test('home shows unfollowed official events by default, supports an empty watchlist, and refreshes newly available dates', async ({ page }) => {
  const fixture = await researchWorkspaceFixture(page, { following: true });
  const unrelatedEvent = noisyCalendar[2];
  let eventsAvailable = true;
  await page.route('https://test-project.supabase.co/rest/v1/calendar_items?**', async route => {
    const headers = cors(route);
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers }); return;
    }
    expect(route.request().method()).toBe('GET');
    expect(route.request().headers().authorization).toMatch(/^Bearer /);
    const url = new URL(route.request().url());
    fixture.calendarQueries.push(url.search);
    expect(url.searchParams.get('calendar_status')).toBe('eq.confirmed');
    expect(url.searchParams.get('origin')).toBe('neq.user');
    expect(url.searchParams.getAll('occurs_on')).toEqual(['gte.2026-10-06', 'lte.2026-11-05']);
    expect(url.searchParams.has('or')).toBe(false);
    const companyFilter = url.searchParams.get('company_id');
    expect([null, `in.(${companyId})`]).toContain(companyFilter);
    // The followed company has no upcoming event. The only confirmed official
    // row belongs to another company, matching the new-user regression.
    await route.fulfill({ headers, json: eventsAvailable && companyFilter === null ? [unrelatedEvent] : [] });
  });

  await page.goto('/today');
  const dates = page.locator('.rd-home-upcoming');
  const scope = dates.getByRole('group', { name: '다가오는 일정 기업 범위', exact: true });
  const all = scope.getByRole('button', { name: '전체 기업', exact: true });
  const following = scope.getByRole('button', { name: '관심 기업', exact: true });
  const event = dates.getByRole('link', { name: new RegExp(unrelatedEvent.title) });
  await expect(page.getByRole('heading', { name: '관심 기업 1곳의 주요 소식을 모았습니다.', exact: true })).toBeVisible();
  await expect(all).toHaveAttribute('aria-pressed', 'true');
  await expect(following).toHaveAttribute('aria-pressed', 'false');
  await expect(dates.locator('.rd-home-event')).toHaveCount(1);
  await expect(event).toHaveAttribute('href', `/events/${unrelatedEvent.id}?kind=calendar`);
  await expect(event.locator('.rd-home-company')).toHaveText(otherCompany.name);
  await expect(event.locator('time')).toHaveAttribute('datetime', unrelatedEvent.occurs_on);
  await expect(event.locator('.rd-home-event-meta')).toHaveText('날짜 확정');
  await expect(dates).not.toContainText(/\b\d{1,2}:\d{2}\b|종일/);
  expect(fixture.calendarQueries.length).toBeGreaterThan(0);
  for (const query of fixture.calendarQueries) expect(new URLSearchParams(query).has('company_id')).toBe(false);
  expect(fixture.state.calls.some(call => call.action === 'catalog' && call.p.kind === 'company')).toBe(true);

  await following.click();
  await expect(following).toHaveAttribute('aria-pressed', 'true');
  await expect(all).toHaveAttribute('aria-pressed', 'false');
  await expect(dates).toContainText('앞으로 30일간 확인된 관심 기업 일정이 없습니다.');
  await expect(dates.locator('.rd-home-event')).toHaveCount(0);
  expect(new URLSearchParams(fixture.calendarQueries.at(-1)).get('company_id')).toBe(`in.(${companyId})`);
  await dates.getByRole('button', { name: '전체 기업 일정 보기', exact: true }).click();
  await expect(all).toHaveAttribute('aria-pressed', 'true');
  await expect(following).toHaveAttribute('aria-pressed', 'false');
  await expect(event).toBeVisible();
  expect(new URLSearchParams(fixture.calendarQueries.at(-1)).has('company_id')).toBe(false);

  fixture.state.watched.clear();
  const readsBeforeReload = fixture.calendarQueries.length;
  await page.reload();
  await expect(page.getByRole('heading', { name: '첫 관심 기업을 추가해 보세요.', exact: true })).toBeVisible();
  await expect(page.locator('.rd-home-following .rd-home-update')).toHaveCount(0);
  await expect(all).toHaveAttribute('aria-pressed', 'true');
  await expect(event).toBeVisible();
  await expect(event.locator('.rd-home-company')).toHaveText(otherCompany.name);
  expect(fixture.calendarQueries.length).toBeGreaterThan(readsBeforeReload);
  for (const query of fixture.calendarQueries.slice(readsBeforeReload)) {
    expect(new URLSearchParams(query).has('company_id')).toBe(false);
  }

  // A successful empty read must be refreshable after the existing collection
  // pipeline adds an official date; no page reload or watchlist write is needed.
  eventsAvailable = false;
  await page.reload();
  await expect(dates).toContainText('앞으로 30일간 확인된 기업 일정이 없습니다.');
  await expect(dates.locator('.rd-home-event')).toHaveCount(0);
  const readsBeforeRefresh = fixture.calendarQueries.length;
  eventsAvailable = true;
  await dates.getByRole('button', { name: '다가오는 일정 새로고침', exact: true }).click();
  await expect(event).toBeVisible();
  await expect(event).toHaveAttribute('href', `/events/${unrelatedEvent.id}?kind=calendar`);
  await expect(event.locator('.rd-home-company')).toHaveText(otherCompany.name);
  await expect(all).toHaveAttribute('aria-pressed', 'true');
  expect(fixture.calendarQueries.length).toBeGreaterThan(readsBeforeRefresh);
  for (const query of fixture.calendarQueries.slice(readsBeforeRefresh)) {
    expect(new URLSearchParams(query).has('company_id')).toBe(false);
  }
  await expectViewportFit(page);
  expectClean(fixture);
});

test('the 320px home keeps filters, keyboard tabs, and source links usable without horizontal overflow', async ({ page }, info) => {
  await page.setViewportSize({ width: 320, height: 780 });
  const fixture = await researchWorkspaceFixture(page);
  await page.goto('/today');
  const home = page.locator('[data-screen="redesign-home"]');
  const tabs = home.getByRole('tablist', { name: '최근 소식 종류', exact: true });
  const activity = home.locator('#home-activity-panel');
  await expect(home.getByRole('heading', { name: '홈', exact: true })).toBeVisible();
  await expectViewportFit(page);
  await expect(home.locator('#home-filters')).toBeHidden();
  await home.getByRole('button', { name: '조회 설정', exact: true }).click();
  await expect(home.locator('#home-filters')).toBeVisible();
  await expect(home.getByRole('button', { name: '조회 설정', exact: true })).toHaveAttribute('aria-expanded', 'true');
  await expectViewportFit(page);

  await tabs.getByRole('tab', { name: '전체', exact: true }).focus();
  await tabs.getByRole('tab', { name: '전체', exact: true }).press('ArrowRight');
  await expect(tabs.getByRole('tab', { name: '공시', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(tabs.getByRole('tab', { name: '공시', exact: true })).toBeFocused();
  await tabs.getByRole('tab', { name: '공시', exact: true }).press('ArrowRight');
  await expect(tabs.getByRole('tab', { name: '분석', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(tabs.getByRole('tab', { name: '분석', exact: true })).toBeFocused();
  await expect(activity.getByRole('columnheader', { name: '승인일', exact: true })).toHaveText('승인일');
  await expect(activity.locator('time')).toHaveAttribute('datetime', approved.reviewed_at!);
  await expect(activity.getByRole('link', { name: approved.title, exact: true }))
    .toHaveAttribute('href', `/documents/${sourceId}?kind=filing&analysis=us`);

  await home.getByLabel('시작일', { exact: true }).fill('2025-12-15');
  await home.getByLabel('종료일', { exact: true }).fill(upcoming.occurs_on);
  await home.getByRole('button', { name: '적용', exact: true }).click();
  await tabs.getByRole('tab', { name: '공시', exact: true }).click();
  const source = activity.getByRole('link', { name: filing.title, exact: true });
  await expect(source).toBeVisible();
  await expect(source).toHaveAttribute('href', `/documents/${sourceId}?kind=filing`);
  expect(await source.evaluate(element => element.scrollWidth > element.clientWidth + 1
    || element.scrollHeight > element.clientHeight + 1), 'Mobile source titles remain readable').toBe(false);
  await expectViewportFit(page);
  await home.getByRole('combobox', { name: '기업 필터', exact: true }).selectOption(otherCompany.id);
  await expect(activity).toContainText('조건에 맞는 자료가 없습니다.');
  await expect(source).toHaveCount(0);
  await expect(home.locator('.rd-kpis').getByRole('link', { name: /기간 내 공개 공시/ })).toContainText('0건');
  await expect.poll(() => fixture.state.calls.some(call => call.action === 'design_dashboard'
    && call.p.company_id === otherCompany.id)).toBe(true);
  await home.getByRole('combobox', { name: '기업 필터', exact: true }).selectOption('');
  await expect(source).toBeVisible();
  await home.getByRole('button', { name: '조회 설정', exact: true }).click();
  await expect(home.locator('#home-filters')).toBeHidden();
  await home.locator('.rd-kpis').getByRole('link', { name: /기간 내 승인 분석/ }).click();
  await expect(tabs.getByRole('tab', { name: '분석', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(activity.getByRole('link', { name: approved.title, exact: true })).toBeVisible();
  await expectViewportFit(page);
  await page.screenshot({ path: info.outputPath('home-320px.png'), fullPage: true, animations: 'disabled' });
  expectClean(fixture);
});
