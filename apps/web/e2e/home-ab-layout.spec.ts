import { expect, test, type Page } from '@playwright/test';
import { fixtureNow } from './mobile-fixture';
import {
  approved, filing, researchWorkspaceFixture, sourceId, upcoming, type ResearchFixture,
} from './research-workspace-fixture';
import { calendarEntrySchema } from '../src/redesign/calendar-utils';
import { catalogSchema, contentNotificationsSchema, resourceSchema, workspaceRequest } from '../src/workspace/contracts';
import { newsResponse } from '../src/lib/news-contract';
import { homeSnapshotSchema } from '../src/redesign/home-snapshot-contract';

test('primary tabs retain prepared content without another content round trip', async ({ page }) => {
  const fixture = await researchWorkspaceFixture(page, { following: true });
  fixture.state.saved.add(`us_analysis:${sourceId}`);
  await page.goto('/today');
  await expect(page.locator('[data-screen="redesign-home"]')).toBeVisible();
  await expect(page.getByRole('heading', { name: '관심 기업 1곳의 주요 소식을 모았습니다.', exact: true })).toBeVisible();
  // Saved is the final idle-prefetched destination from Home. Waiting for it
  // establishes that the preceding directory/watchlist/calendar reads finished.
  await expect.poll(() => fixture.state.calls.some(call => call.action === 'saved_list' && call.p.kind === '')).toBe(true);
  expect(fixture.state.calls.filter(call => call.action === 'home_snapshot')).toHaveLength(1);
  const forbidden: string[] = [];
  await page.route('**/api/workspace', async route => {
    const input = workspaceRequest.safeParse(route.request().postDataJSON());
    if (input.success && ['home_snapshot', 'design_directory', 'source_overview', 'design_dashboard'].includes(input.data.action)) {
      forbidden.push(input.data.action);
      await route.fulfill({ status: 503, json: { error: { code: 'synthetic_slow_read' } } });
      return;
    }
    if (input.success && input.data.action === 'saved_list' && input.data.p.kind !== 'history') {
      forbidden.push('saved_list');
      await route.fulfill({ status: 503, json: { error: { code: 'synthetic_slow_read' } } });
      return;
    }
    if (input.success && input.data.action === 'catalog' && ['company', 'document', 'analysis'].includes(input.data.p.kind ?? '')) {
      forbidden.push(`catalog:${input.data.p.kind}`);
      await route.fulfill({ status: 503, json: { error: { code: 'synthetic_slow_read' } } });
      return;
    }
    await route.fallback();
  });
  await page.route('https://test-project.supabase.co/rest/v1/calendar_items?**', async route => {
    if (route.request().method() === 'GET') {
      forbidden.push('calendar_items');
      await route.abort('failed');
    } else await route.fallback();
  });
  const nav = page.getByRole('navigation', { name: '주 메뉴', exact: true });
  await nav.getByRole('link', { name: '기업', exact: true }).click();
  await expect(page.locator('.rd-company-card')).not.toHaveCount(0);
  await expect(page.locator('[data-screen="redesign-companies"] .ws-loading')).toHaveCount(0);
  await nav.getByRole('link', { name: '홈', exact: true }).click();
  await expect(page.getByRole('heading', { name: '관심 기업 1곳의 주요 소식을 모았습니다.', exact: true })).toBeVisible();
  await nav.getByRole('link', { name: '관심 기업', exact: true }).click();
  await expect(page.locator('.rd-w-card')).toHaveCount(1);
  await expect(page.locator('.rd-w-list')).toHaveAttribute('aria-busy', 'false');
  await nav.getByRole('link', { name: '캘린더', exact: true }).click();
  await expect(page.locator('[data-screen="redesign-calendar"]')).toContainText('Synthetic historical official event');
  await nav.getByRole('link', { name: '저장', exact: true }).click();
  await expect(page.locator('[data-screen="redesign-saved"]')).toContainText(approved.title);
  expect(forbidden).toEqual([]);
  expect(fixture.state.runtimeErrors).toEqual([]);
  expect(fixture.state.unexpected).toEqual([]);
});

// These records exist only in this isolated browser test. They deliberately sit
// inside B's 30-day document / inclusive seven-day calendar windows. A keeps its
// original fixtures and all of its original assertions below.
const recentFiling = resourceSchema.parse({ ...filing, published_at: '2026-10-05T12:00:00.000Z' });
const pressRelease = resourceSchema.parse({
  ...recentFiling, id: '40000000-0000-4000-8000-000000000911', kind: 'document',
  title: 'Synthetic official press release', category: 'press_release',
});
const presentation = resourceSchema.parse({
  ...recentFiling, id: '40000000-0000-4000-8000-000000000912', kind: 'document',
  title: 'Synthetic investor presentation', category: 'presentation',
});
const referenceDocuments = [recentFiling, pressRelease, presentation];
const referenceEvents = [
  { ...upcoming, title: 'Synthetic earnings announcement', occurs_on: '2026-10-06' },
  { ...upcoming, id: '80000000-0000-4000-8000-000000000911', title: 'Synthetic investor day', occurs_on: '2026-10-08' },
  { ...upcoming, id: '80000000-0000-4000-8000-000000000912', title: 'Synthetic shareholders meeting', occurs_on: '2026-10-12' },
  { ...upcoming, id: '80000000-0000-4000-8000-000000000913', title: 'Synthetic event outside seven days', occurs_on: '2026-10-13' },
  { ...upcoming, id: '80000000-0000-4000-8000-000000000914', title: 'Synthetic historical event', occurs_on: '2026-10-05' },
].map(item => calendarEntrySchema.parse({
  ...item, event_id: null, origin: 'official_ir', quote: `Synthetic notice for ${item.title}.`,
}));

async function homeBNewsFixture(page: Page, fixture: ResearchFixture) {
  // B also uses the existing public news page's market-query mode. Retain the
  // base fixture's authenticated company mode for the optional company filter.
  await page.route('**/api/news?**', async route => {
    const params = new URL(route.request().url()).searchParams;
    if (!params.has('q')) { await route.fallback(); return; }
    expect(params.get('q')).toBe('증시');
    expect(route.request().headers().authorization).toMatch(/^Bearer /);
    if (fixture.control.newsError) {
      await route.fulfill({ status: 502, json: { error: 'provider_unavailable' } }); return;
    }
    await route.fulfill({ json: newsResponse.parse({
      provider: 'NAVER', query: '증시', retrievedAt: fixtureNow,
      items: fixture.control.newsEmpty ? [] : [{
        title: 'Synthetic company news article', link: 'https://news.naver.com/synthetic',
        originalLink: 'https://www.nvidia.com/en-us/about-nvidia/', publishedAt: fixtureNow,
      }],
    }) });
  });
}

async function referenceDashboardFixture(page: Page) {
  const fixture = await researchWorkspaceFixture(page, { following: true });
  const homeCalendarQueries: string[] = [];
  fixture.state.profile.is_admin = true;
  await homeBNewsFixture(page, fixture);
  const documentCatalog = () => {
    const filings = fixture.control.emptyContent ? [] : referenceDocuments.map(item => ({
      ...item, is_saved: fixture.state.saved.has(`${item.kind}:${item.id}`),
    }));
    return catalogSchema.parse({ items: filings, total: filings.length, counts: { document: filings.length },
      markets: ['NASDAQ'], categories: ['10-Q', 'press_release', 'presentation'], next_offset: null });
  };
  const homeSnapshot = (today: string) => homeSnapshotSchema.parse({
    ...fixture.homeSnapshot(today), documents: documentCatalog(),
  });
  await page.route('**/api/workspace', async route => {
    const parsed = workspaceRequest.safeParse(route.request().postDataJSON());
    if (!parsed.success || (parsed.data.action !== 'home_snapshot'
      && (parsed.data.action !== 'catalog' || parsed.data.p.kind !== 'document'))) {
      await route.fallback(); return;
    }
    expect(route.request().headers().authorization).toMatch(/^Bearer /);
    fixture.state.calls.push(parsed.data);
    if (parsed.data.action === 'home_snapshot') {
      expect(parsed.data.p).toEqual({ today: '2026-10-06' });
      if (fixture.control.overviewError) {
        await route.fulfill({ status: 503, json: { error: { code: 'service_unavailable' } } }); return;
      }
      await route.fulfill({ json: homeSnapshot(parsed.data.p.today) }); return;
    }
    expect(parsed.data.p).toEqual({ kind: 'document', days: 30, sort: 'newest', limit: 50 });
    await route.fulfill({ json: documentCatalog() });
  });
  await page.route('https://test-project.supabase.co/rest/v1/calendar_items?**', async route => {
    const headers = {
      'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': route.request().headers()['access-control-request-headers']
        ?? 'authorization,apikey,content-type,x-client-info',
    };
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers }); return;
    }
    expect(route.request().method()).toBe('GET');
    expect(route.request().headers().authorization).toMatch(/^Bearer /);
    const url = new URL(route.request().url());
    // The shared header also prepares Calendar and Watchlist ranges. Keep
    // their real fixture behavior; only B's seven-day request gets noisy rows.
    const bounds = url.searchParams.getAll('occurs_on');
    if (!bounds.includes('gte.2026-10-06') || !bounds.includes('lte.2026-10-12')) {
      await route.fallback(); return;
    }
    fixture.calendarQueries.push(url.search);
    homeCalendarQueries.push(url.search);
    expect(bounds).toEqual(['gte.2026-10-06', 'lte.2026-10-12']);
    expect(url.searchParams.get('calendar_status')).toBe('eq.confirmed');
    expect(url.searchParams.get('origin')).toBe('neq.user');
    expect(url.searchParams.has('company_id')).toBe(false);
    expect(url.searchParams.has('or')).toBe(false);
    // Return noisy data so the homepage must also apply its final date guard.
    await route.fulfill({ headers, json: fixture.control.emptyContent ? [] : referenceEvents });
  });
  return { ...fixture, homeCalendarQueries, homeSnapshot };
}

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

test('administrator can compare A with the reference dashboard without changing the shared header', async ({ page }, testInfo) => {
  const fixture = await researchWorkspaceFixture(page, { following: true });
  fixture.state.profile.is_admin = true;
  await homeBNewsFixture(page, fixture);
  await page.clock.setFixedTime(new Date(fixtureNow));
  await page.goto('/today?home_preview=A&keep=1');
  const marker = page.locator('[data-home-experiment]');
  await expect(marker).toHaveAttribute('data-home-variant', 'A');
  await expect(page.locator('.rd-home-following .rd-home-update')).toHaveCount(3);
  await expect(page.getByRole('heading', { name: '관심 기업 1곳의 주요 소식을 모았습니다.', exact: true })).toBeVisible();
  await fitsViewport(page);
  const header = await page.locator('.rd-header').boundingBox();
  expect(header).not.toBeNull();
  await testInfo.attach(`home-A-${testInfo.project.name}`, {
    body: await page.screenshot({ fullPage: true }), contentType: 'image/png',
  });

  await page.getByRole('button', { name: 'B 미리보기', exact: true }).click();
  await expect(marker).toHaveAttribute('data-home-variant', 'B');
  await expect(marker).toHaveAttribute('data-home-preview', 'true');
  const home = page.locator('.sb-home-b[data-screen="redesign-home-b"]');
  await expect(home).toHaveCount(1);
  await expect(home.getByRole('heading', { name: '오늘', exact: true })).toBeVisible();
  await expect(page.locator('[data-screen="redesign-home"]')).toHaveCount(0);
  await expect(home.locator('.hb-following .hb-update')).not.toHaveCount(0);
  for (const title of ['관심기업 업데이트', '다가오는 일정', '최신 문서', '승인된 분석', '시장 / 기업 뉴스', '저장한 항목', '커버리지 현황', '알림']) {
    await expect(home.getByRole('heading', { name: title, exact: true })).toBeVisible();
  }
  await expect(home.locator('.hb-analyses').getByRole('link', { name: new RegExp(approved.title) }))
    .toHaveAttribute('href', `/documents/${sourceId}?kind=filing&analysis=us`);
  const unchangedHeader = await page.locator('.rd-header').boundingBox();
  expect(unchangedHeader).not.toBeNull();
  expect(unchangedHeader!.x).toBe(header!.x);
  expect(unchangedHeader!.y).toBe(header!.y);
  expect(unchangedHeader!.height).toBe(header!.height);
  expect(Math.abs(unchangedHeader!.width - header!.width)).toBeLessThanOrEqual(1);
  await expect(page.locator('.rd-header nav a[href="/today"]')).toHaveAttribute('href', '/today');
  await expect(page.getByRole('button', { name: 'B 미리보기', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(home.locator('.hb-saved').getByRole('link', { name: /전체 보기/ })).toHaveAttribute('href', '/saved?tab=analysis');
  await fitsViewport(page);
  await testInfo.attach(`home-B-${testInfo.project.name}`, {
    body: await page.screenshot({ fullPage: true }), contentType: 'image/png',
  });
  await page.getByRole('button', { name: '자동 배정', exact: true }).click();
  await expect(marker).toHaveAttribute('data-home-variant', 'A');
  await expect(marker).toHaveAttribute('data-home-preview', 'false');
  await expect(page).toHaveURL(/\/today\?keep=1$/);
  await expect(page.locator('.rd-main > .rd-home')).toBeVisible();
  clean(fixture);
});

test('cold A and B each use one shared snapshot while calendar, coverage and news remain independent', async ({ page }) => {
  const fixture = await referenceDashboardFixture(page);
  // Data Saver disables unrelated idle tab warming through the real product
  // policy, so this test can reject every legacy default Home request. The
  // primary-tabs test above still exercises normal idle warming end to end.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'connection', { configurable: true, value: { saveData: true } });
  });
  const snapshots: string[] = [], legacy: string[] = [], newsRequests: string[] = [];
  let coverageRequests = 0;
  let initialHomeReady = false;
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.pathname === '/api/news') newsRequests.push(url.search);
    if (url.pathname.endsWith('/rpc/sb_calendar_coverage') && request.method() === 'POST') coverageRequests++;
  });
  await page.route('**/v1/watchlist', async route => {
    legacy.push('watchlist');
    await route.fulfill({ status: 503, json: { error: { code: 'legacy_home_read_blocked' } } });
  });
  await page.route('**/api/workspace', async route => {
    const request = workspaceRequest.parse(route.request().postDataJSON());
    if (request.action === 'home_snapshot') {
      expect(route.request().headers().authorization).toMatch(/^Bearer /);
      expect(request.p).toEqual({ today: '2026-10-06' });
      snapshots.push(request.p.today);
      await route.fallback(); return;
    }
    const isLegacy = ['source_overview', 'design_dashboard'].includes(request.action)
      || request.action === 'content_notifications' && !initialHomeReady
      || request.action === 'catalog' && ['company', 'document', 'analysis'].includes(request.p.kind ?? '')
      || request.action === 'saved_list' && request.p.kind === 'analysis';
    if (isLegacy) {
      legacy.push(request.action);
      await route.fulfill({ status: 503, json: { error: { code: 'legacy_home_read_blocked' } } }); return;
    }
    await route.fallback();
  });
  for (const initial of ['A', 'B'] as const) {
    const before = snapshots.length;
    const coverageBefore = coverageRequests, newsBefore = newsRequests.length;
    initialHomeReady = false;
    await page.goto(`/today?home_preview=${initial}`);
    for (const variant of [initial, initial === 'A' ? 'B' : 'A', initial] as const) {
      await page.getByRole('button', { name: `${variant} 미리보기`, exact: true }).click();
      await expect(page.locator('[data-home-experiment]')).toHaveAttribute('data-home-variant', variant);
      if (variant === 'A') {
        await expect(page.locator('.rd-home-following .rd-home-update')).toHaveCount(3);
        await expect(page.locator('.rd-home-following')).toContainText(approved.title);
      } else {
        await expect(page.locator('.hb-documents .hb-document')).toHaveCount(3);
        await expect(page.locator('.hb-calendar .hb-event')).toHaveCount(3);
        await expect(page.locator('.hb-analyses')).toContainText(approved.title);
        await expect(page.locator('.hb-news-row')).toContainText('Synthetic company news article');
      }
      await expect(page.locator('.rd-header').getByRole('link', { name: /^알림/ }))
        .toHaveAttribute('aria-label', '알림 · 읽지 않음 1개');
      // Initial unread state must come from the common snapshot. Subsequent
      // legitimate focus/poll refreshes use the dedicated notifications API.
      // The fixture's fixed Date also prevents cache TTLs expiring mid-test.
      initialHomeReady = true;
      expect(snapshots, 'Both preview renderers share the same authorized default data').toHaveLength(before + 1);
      expect(legacy, 'No legacy default Home widget reads are needed').toEqual([]);
    }
    expect(coverageRequests, 'Coverage remains independently requested').toBeGreaterThan(coverageBefore);
    expect(newsRequests.length, 'News remains independently requested').toBeGreaterThan(newsBefore);
  }
  expect(fixture.calendarQueries.some(query => new URLSearchParams(query).getAll('occurs_on').includes('lte.2026-11-05'))).toBe(true);
  expect(fixture.homeCalendarQueries.length, 'B retains its independent seven-day official calendar query').toBeGreaterThan(0);
  expect(newsRequests.some(query => new URLSearchParams(query).has('company_id'))).toBe(true);
  expect(newsRequests.some(query => new URLSearchParams(query).get('q') === '증시')).toBe(true);
  clean(fixture);
});

test('B keeps populated cards readable and controls separate across responsive widths', async ({ page }) => {
  const fixture = await referenceDashboardFixture(page);
  await page.goto('/today?home_preview=B');
  const home = page.locator('.sb-home-b');
  for (const selector of ['.hb-update', '.hb-document', '.hb-event', '.hb-analysis', '.hb-news-row']) {
    await expect(home.locator(selector).first()).toBeVisible();
  }

  for (const width of [320, 768, 1024, 1280, 1440, 1920]) {
    await test.step(`${width}px readable cards`, async () => {
      await page.setViewportSize({ width, height: 1000 });
      await page.evaluate(async () => { await document.fonts.ready; });
      for (const [selector, minimum] of [
        ['.hb-card-heading h2', 20],
        ['.hb-company strong, .hb-update-copy .hb-title, .hb-document .hb-row-copy strong, .hb-event .hb-row-copy > strong, .hb-analysis .hb-row-copy > strong, .hb-news-row .hb-row-copy', 15],
        ['.hb-card-heading p, .hb-meta, .hb-badge, .hb-company > span, .hb-coverage-caption, .hb-news-credit', 12],
        ['.hb-tabs button, .hb-more', 14],
      ] as const) {
        const sizes = await home.locator(selector).evaluateAll(elements => elements.map(element =>
          parseFloat(getComputedStyle(element).fontSize)));
        expect(sizes.length, `${selector} contains rendered content`).toBeGreaterThan(0);
        for (const size of sizes) expect(size, `${selector} remains readable at ${width}px`).toBeGreaterThanOrEqual(minimum);
      }
      const layout = await home.evaluate(root => {
        const bounds = (element: Element) => {
          const box = element.getBoundingClientRect();
          return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width, height: box.height };
        };
        const visible = (element: Element) => {
          const box = element.getBoundingClientRect();
          return box.width > 0 && box.height > 0;
        };
        const rows = Array.from(root.querySelectorAll('.hb-update, .hb-event, .hb-document, .hb-analysis, .hb-news-row, .hb-saved-row, .hb-alert'));
        return {
          main: bounds(root.querySelector('.hb-main')!),
          sidebar: bounds(root.querySelector('.hb-sidebar')!),
          panels: Array.from(root.querySelectorAll('.hb-panels > .hb-card'), bounds),
          metrics: Array.from(root.querySelectorAll('.hb-metric'), bounds),
          rows: rows.map(row => ({
            name: row.className,
            bounds: bounds(row),
            children: Array.from(row.children).flatMap(child =>
              getComputedStyle(child).display === 'contents' ? Array.from(child.children) : [child],
            ).filter(visible).map(bounds),
          })),
          documentControls: Array.from(root.querySelectorAll('.hb-document .hb-icon-button, .hb-document .rd-save')).filter(visible).map(bounds),
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        };
      });
      expect(layout.overflow, 'The page fits without horizontal scrolling').toBeLessThanOrEqual(1);
      expect(layout.panels).toHaveLength(6);
      expect(layout.metrics).toHaveLength(4);
      for (const metric of layout.metrics) expect(metric.height, 'Summary cards have usable reading space').toBeGreaterThanOrEqual(100);
      const [first, second] = layout.panels;
      if (width <= 900) {
        expect(second.top, 'Narrow screens stack the content cards').toBeGreaterThanOrEqual(first.bottom);
        expect(first.width, 'A stacked card uses the available main width').toBeGreaterThanOrEqual(layout.main.width - 1);
      } else {
        expect(Math.abs(first.top - second.top), 'Wide screens keep paired cards aligned').toBeLessThanOrEqual(1);
        expect(second.left - first.right, 'Card gutters do not consume reading space').toBeLessThanOrEqual(20);
        expect(second.left - first.right, 'Card borders remain separate').toBeGreaterThanOrEqual(8);
        for (const panel of layout.panels) expect(panel.width, 'Two-column cards remain usable').toBeGreaterThanOrEqual(430);
      }
      if (width >= 1100 && width <= 1400) {
        for (const panel of layout.panels) expect(panel.width, 'Laptop cards gain room when the sidebar moves below').toBeGreaterThanOrEqual(540);
      }
      if (width <= 1400) expect(layout.sidebar.top, 'The sidebar follows the main cards at smaller widths').toBeGreaterThanOrEqual(layout.main.bottom);
      else expect(layout.sidebar.left, 'The wide-screen sidebar stays beside the cards').toBeGreaterThanOrEqual(layout.main.right);
      if (width <= 1000) expect(layout.metrics[2].top, 'Small-screen metrics form two rows').toBeGreaterThanOrEqual(layout.metrics[0].bottom);
      else expect(Math.abs(layout.metrics[3].top - layout.metrics[0].top)).toBeLessThanOrEqual(1);

      expect(layout.documentControls.length, 'Populated documents expose source and save controls').toBeGreaterThan(0);
      for (const control of layout.documentControls) {
        expect(control.width).toBeGreaterThanOrEqual(width <= 700 ? 44 : 40);
        expect(control.height).toBeGreaterThanOrEqual(width <= 700 ? 44 : 40);
      }
      for (const row of layout.rows) {
        for (const child of row.children) {
          expect(child.left, `${row.name} content stays inside its row`).toBeGreaterThanOrEqual(row.bounds.left - 1);
          expect(child.right, `${row.name} content stays inside its row`).toBeLessThanOrEqual(row.bounds.right + 1);
        }
        for (let firstIndex = 0; firstIndex < row.children.length; firstIndex++) {
          for (let secondIndex = firstIndex + 1; secondIndex < row.children.length; secondIndex++) {
            const a = row.children[firstIndex], b = row.children[secondIndex];
            const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left);
            const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
            expect(overlapX > 1 && overlapY > 1, `${row.name} text and controls do not overlap`).toBe(false);
          }
        }
      }
    });
  }
  clean(fixture);
});

test('B fits a narrow viewport and preserves genuine empty and retry states', async ({ page }) => {
  const fixture = await researchWorkspaceFixture(page, { emptyContent: true, newsError: true });
  fixture.state.profile.is_admin = true;
  await homeBNewsFixture(page, fixture);
  await page.clock.setFixedTime(new Date(fixtureNow));
  await page.setViewportSize({ width: 320, height: 780 });
  await page.goto('/today?home_preview=B');
  await expect(page.locator('[data-home-experiment]')).toHaveAttribute('data-home-variant', 'B');
  const home = page.locator('.sb-home-b');
  await expect(home.locator('.hb-following')).toContainText('관심 기업을 추가하면');
  await expect(home.locator('#news .ws-error')).toBeVisible();
  await expect(home.locator('.hb-documents .hb-document')).toHaveCount(0);
  await expect(home.locator('.hb-analyses .hb-analysis')).toHaveCount(0);
  await expect(home.locator('.hb-calendar .hb-event')).toHaveCount(0);
  await fitsViewport(page);
  fixture.control.newsError = false;
  await home.locator('#news .ws-error button').click();
  await expect(home.locator('#news .ws-error')).toHaveCount(0);
  await expect(home.locator('#news')).toContainText('Synthetic company news article');
  await fitsViewport(page);
  clean(fixture);
});

test('B filters actual documents and seven-day calendar records and persists a bookmark', async ({ page }, testInfo) => {
  const fixture = await referenceDashboardFixture(page);
  await page.goto('/today?home_preview=B');
  const home = page.locator('.sb-home-b');
  const documents = home.locator('.hb-documents');
  const calendar = home.locator('.hb-calendar');
  const documentTabs = home.getByRole('group', { name: '문서 유형', exact: true });
  const eventTabs = home.getByRole('group', { name: '다가오는 일정 분류', exact: true });
  const savedTabs = home.getByRole('group', { name: '저장한 항목 분류', exact: true });
  await expect(documents.locator('.hb-document')).toHaveCount(3);
  await expect(calendar.locator('.hb-event')).toHaveCount(3);
  await expect(calendar).not.toContainText('Synthetic event outside seven days');
  await expect(calendar).not.toContainText('Synthetic historical event');
  expect(fixture.homeCalendarQueries.length).toBeGreaterThan(0);
  for (const query of fixture.homeCalendarQueries) {
    expect(new URLSearchParams(query).getAll('occurs_on')).toEqual(['gte.2026-10-06', 'lte.2026-10-12']);
  }
  await expect(calendar.getByRole('link', { name: new RegExp(referenceEvents[0].title) }))
    .toHaveAttribute('href', `/events/${referenceEvents[0].id}?kind=calendar`);
  // Calendar storage exposes a date, not a meeting hour to fabricate from the reference image.
  await expect(calendar).not.toContainText(/오전|오후|장 마감|\b\d{1,2}:\d{2}\b/);
  await testInfo.attach(`home-B-populated-${testInfo.project.name}`, {
    body: await page.screenshot({ fullPage: true }), contentType: 'image/png',
  });
  await eventTabs.getByRole('button', { name: '실적 발표', exact: true }).click();
  await expect(calendar.locator('.hb-event')).toHaveCount(1);
  await expect(calendar).toContainText(referenceEvents[0].title);
  await eventTabs.getByRole('button', { name: '투자자 행사', exact: true }).click();
  await expect(calendar.locator('.hb-event')).toHaveCount(1);
  await expect(calendar).toContainText(referenceEvents[1].title);
  await eventTabs.getByRole('button', { name: '향후 7일', exact: true }).click();
  await expect(calendar.locator('.hb-event')).toHaveCount(3);

  await documentTabs.getByRole('button', { name: '발표자료', exact: true }).click();
  await expect(documents.locator('.hb-document')).toHaveCount(1);
  await expect(documents).toContainText(pressRelease.title);
  await documentTabs.getByRole('button', { name: '프레젠테이션', exact: true }).click();
  await expect(documents.locator('.hb-document')).toHaveCount(1);
  await expect(documents).toContainText(presentation.title);
  await documentTabs.getByRole('button', { name: '공시', exact: true }).click();
  await expect(documents.locator('.hb-document')).toHaveCount(1);
  const save = documents.getByRole('button', { name: `${recentFiling.title} 저장`, exact: true });
  await expect(save).toHaveAttribute('aria-pressed', 'false');
  await save.click();
  await expect(documents.getByRole('button', { name: `${recentFiling.title} 저장 취소`, exact: true }))
    .toHaveAttribute('aria-pressed', 'true');
  expect(fixture.state.saved.has(`filing:${sourceId}`)).toBe(true);
  await savedTabs.getByRole('button', { name: /^문서/ }).click();
  await expect(home.locator('.hb-saved').getByRole('link', { name: new RegExp(recentFiling.title) }))
    .toHaveAttribute('href', `/documents/${sourceId}?kind=filing`);
  await page.reload();
  await expect(home.locator('.hb-documents').getByRole('button', { name: `${recentFiling.title} 저장 취소`, exact: true }))
    .toHaveAttribute('aria-pressed', 'true');
  await fitsViewport(page);
  clean(fixture);
});

test('B opens an alert only after a confirmed read and synchronizes the shared bell', async ({ page }) => {
  const fixture = await referenceDashboardFixture(page);
  const notification = {
    id: '80000000-0000-4000-8000-000000000921', created_at: fixtureNow,
    read_at: null as string | null, resource: approved,
  };
  let rejectRead = true;
  const writes: string[] = [];
  await page.route('**/api/workspace', async route => {
    const parsed = workspaceRequest.safeParse(route.request().postDataJSON());
    if (!parsed.success || !['home_snapshot', 'content_notifications', 'content_notification_read'].includes(parsed.data.action)) {
      await route.fallback(); return;
    }
    expect(route.request().headers().authorization).toMatch(/^Bearer /);
    fixture.state.calls.push(parsed.data);
    if (parsed.data.action === 'home_snapshot') {
      await route.fulfill({ json: homeSnapshotSchema.parse({ ...fixture.homeSnapshot(parsed.data.p.today),
        notifications: { items: [notification], unread_count: notification.read_at === null ? 1 : 0 } }) });
      return;
    }
    if (parsed.data.action === 'content_notifications') {
      await route.fulfill({ json: contentNotificationsSchema.parse({
        items: [notification], unread_count: notification.read_at === null ? 1 : 0,
      }) });
      return;
    }
    if (parsed.data.action === 'content_notification_read') {
      expect(parsed.data.p).toEqual({ id: notification.id });
      writes.push(notification.id);
      if (rejectRead) {
        await route.fulfill({ status: 503, json: { error: { code: 'notification_write_unavailable' } } });
        return;
      }
      notification.read_at = fixtureNow;
      await route.fulfill({ json: { updated: true } });
    }
  });
  await page.goto('/today?home_preview=B');
  const home = page.locator('.sb-home-b');
  const notifications = home.locator('section').filter({
    has: page.getByRole('heading', { name: '알림', exact: true }),
  });
  const alertLink = notifications.getByRole('link', { name: new RegExp(approved.title) });
  const bell = page.locator('.rd-header').getByRole('link', { name: /^알림/ });
  await expect(bell).toHaveAttribute('aria-label', '알림 · 읽지 않음 1개');
  await alertLink.click();
  await expect(home.locator('.ws-error')).toBeVisible();
  await expect(page).toHaveURL(/\/today\?home_preview=B$/);
  await expect(bell).toHaveAttribute('aria-label', '알림 · 읽지 않음 1개');
  expect(notification.read_at).toBeNull();
  rejectRead = false;
  await alertLink.click();
  await expect(page).toHaveURL(new RegExp(`/documents/${sourceId}\\?kind=filing&analysis=us$`));
  await expect(page.getByTestId('redesign-analysis-detail').getByRole('heading', { name: approved.title, exact: true })).toBeVisible();
  await expect(bell).toHaveAttribute('aria-label', '알림');
  await expect(page.locator('.rd-bell i')).toHaveCount(0);
  expect(writes).toEqual([notification.id, notification.id]);
  await page.reload();
  await expect(bell).toHaveAttribute('aria-label', '알림');
  clean(fixture);
});
