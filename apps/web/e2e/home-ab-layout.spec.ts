import { expect, test, type Page } from '@playwright/test';
import { fixtureNow } from './mobile-fixture';
import {
  approved, filing, researchWorkspaceFixture, sourceId, upcoming, type ResearchFixture,
} from './research-workspace-fixture';
import { calendarEntrySchema } from '../src/redesign/calendar-utils';
import { catalogSchema, contentNotificationsSchema, resourceSchema, workspaceRequest } from '../src/workspace/contracts';
import { newsResponse } from '../src/lib/news-contract';

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
  fixture.state.profile.is_admin = true;
  await homeBNewsFixture(page, fixture);
  await page.route('**/api/workspace', async route => {
    const parsed = workspaceRequest.safeParse(route.request().postDataJSON());
    if (!parsed.success || parsed.data.action !== 'catalog' || parsed.data.p.kind !== 'document') {
      await route.fallback(); return;
    }
    expect(route.request().headers().authorization).toMatch(/^Bearer /);
    fixture.state.calls.push(parsed.data);
    expect(parsed.data.p).toEqual({ kind: 'document', days: 30, sort: 'newest', limit: 50 });
    const filings = fixture.control.emptyContent ? [] : referenceDocuments.map(item => ({
      ...item, is_saved: fixture.state.saved.has(`${item.kind}:${item.id}`),
    }));
    await route.fulfill({ json: catalogSchema.parse({
      items: filings, total: filings.length, counts: { document: filings.length },
      markets: ['NASDAQ'], categories: ['10-Q', 'press_release', 'presentation'], next_offset: null,
    }) });
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
    fixture.calendarQueries.push(url.search);
    expect(url.searchParams.get('calendar_status')).toBe('eq.confirmed');
    expect(url.searchParams.get('origin')).toBe('neq.user');
    // Return noisy data so the homepage must also apply its final date guard.
    await route.fulfill({ headers, json: fixture.control.emptyContent ? [] : referenceEvents });
  });
  return fixture;
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

test('B filters actual documents and seven-day calendar records and persists a bookmark', async ({ page }) => {
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
  expect(fixture.calendarQueries.length).toBeGreaterThan(0);
  for (const query of fixture.calendarQueries) {
    expect(new URLSearchParams(query).getAll('occurs_on')).toEqual(['gte.2026-10-06', 'lte.2026-10-12']);
  }
  await expect(calendar.getByRole('link', { name: new RegExp(referenceEvents[0].title) }))
    .toHaveAttribute('href', `/events/${referenceEvents[0].id}?kind=calendar`);
  // Calendar storage exposes a date, not a meeting hour to fabricate from the reference image.
  await expect(calendar).not.toContainText(/오전|오후|장 마감|\b\d{1,2}:\d{2}\b/);
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
    if (!parsed.success || !['content_notifications', 'content_notification_read'].includes(parsed.data.action)) {
      await route.fallback(); return;
    }
    expect(route.request().headers().authorization).toMatch(/^Bearer /);
    fixture.state.calls.push(parsed.data);
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
