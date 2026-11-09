import { expect, test, type Page } from '@playwright/test';
import { fixtureNow } from './mobile-fixture';
import { approved, researchWorkspaceFixture, sourceId } from './research-workspace-fixture';
import { contentNotificationsSchema, workspaceRequest } from '../src/workspace/contracts';
import { homeSnapshotSchema } from '../src/redesign/home-snapshot-contract';

// Persisted server state for isolated browser journeys only. Every request still
// passes through the real UI/client, while production endpoints remain blocked.
function notificationStore() {
  return {
    rejectReads: false,
    reads: 0,
    writes: [] as { id?: string; all?: boolean }[],
    items: [
      { id: '80000000-0000-4000-8000-000000000901', created_at: fixtureNow, read_at: null as string | null, resource: { ...approved, title: 'Synthetic first unread notification' } },
      { id: '80000000-0000-4000-8000-000000000902', created_at: fixtureNow, read_at: null as string | null, resource: { ...approved, title: 'Synthetic second unread notification' } },
    ],
  };
}

async function notificationsFixture(page: Page, store = notificationStore()) {
  const fixture = await researchWorkspaceFixture(page, { following: true });
  await page.route('**/api/workspace', async route => {
    const parsed = workspaceRequest.safeParse(route.request().postDataJSON());
    if (!parsed.success || !['home_snapshot', 'content_notifications', 'content_notification_read'].includes(parsed.data.action)) {
      await route.fallback();
      return;
    }
    expect(route.request().headers().authorization).toMatch(/^Bearer /);
    fixture.state.calls.push(parsed.data);
    if (parsed.data.action === 'home_snapshot') {
      await route.fulfill({ json: homeSnapshotSchema.parse({ ...fixture.homeSnapshot(parsed.data.p.today),
        notifications: { items: store.items, unread_count: store.items.filter(item => item.read_at === null).length } }) });
      return;
    }
    if (parsed.data.action === 'content_notifications') {
      store.reads++;
      await route.fulfill({ json: contentNotificationsSchema.parse({
        items: store.items,
        unread_count: store.items.filter(item => item.read_at === null).length,
      }) });
      return;
    }
    if (parsed.data.action === 'content_notification_read') {
      const p = parsed.data.p;
      store.writes.push(p);
      if (store.rejectReads) {
        await route.fulfill({ status: 503, json: { error: { code: 'notification_write_unavailable' } } });
        return;
      }
      for (const item of store.items) if (p.all || p.id === item.id) item.read_at ??= fixtureNow;
      await route.fulfill({ json: { updated: true } });
    }
  });
  return { fixture, store };
}

const bell = (page: Page) => page.locator('.rd-header').getByRole('link', { name: /^알림/ });
const unreadButton = (page: Page, title: string) => page.getByRole('button', { name: `${title} 읽음으로 표시`, exact: true });

function expectClean(fixture: Awaited<ReturnType<typeof researchWorkspaceFixture>>) {
  expect(fixture.state.unexpected).toEqual([]);
  expect(fixture.state.runtimeErrors).toEqual([]);
  expect(fixture.blockedRequests).toEqual([]);
}

test('item and all-read actions update the bell in place and stay read after reload', async ({ page }) => {
  const { fixture, store } = await notificationsFixture(page);
  await page.goto('/alerts');
  await expect(bell(page)).toHaveAttribute('aria-label', '알림 · 읽지 않음 2개');
  await expect(page.locator('.rd-bell i')).toHaveCount(1);

  await unreadButton(page, store.items[0].resource.title).click();
  await expect(page.getByRole('button', { name: `${store.items[0].resource.title} 읽음`, exact: true })).toBeDisabled();
  await expect(bell(page)).toHaveAttribute('aria-label', '알림 · 읽지 않음 1개');
  await expect(page.locator('.rd-bell i')).toHaveCount(1);
  await expect(page).toHaveURL(/\/alerts$/);
  expect(store.writes).toEqual([{ id: store.items[0].id }]);

  await page.reload();
  await expect(page.getByRole('button', { name: `${store.items[0].resource.title} 읽음`, exact: true })).toBeDisabled();
  await expect(bell(page)).toHaveAttribute('aria-label', '알림 · 읽지 않음 1개');

  await page.getByRole('button', { name: '모두 읽음으로 표시', exact: true }).click();
  await expect(bell(page)).toHaveAttribute('aria-label', '알림');
  await expect(page.locator('.rd-bell i')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '모두 읽음으로 표시', exact: true })).toBeDisabled();
  expect(store.items.every(item => item.read_at !== null)).toBe(true);
  expect(store.writes.at(-1)).toEqual({ all: true });

  await page.reload();
  await expect(bell(page)).toHaveAttribute('aria-label', '알림');
  await expect(page.locator('.rd-bell i')).toHaveCount(0);
  await page.getByRole('button', { name: '읽지 않음 (0)', exact: true }).click();
  await expect(page.getByText('읽지 않은 알림이 없습니다.', { exact: true })).toBeVisible();
  expectClean(fixture);
});

test('a failed persisted read keeps its unread row and bell until a successful retry', async ({ page }) => {
  const { fixture, store } = await notificationsFixture(page);
  store.rejectReads = true;
  await page.goto('/alerts');
  await expect(bell(page)).toHaveAttribute('aria-label', '알림 · 읽지 않음 2개');
  await unreadButton(page, store.items[0].resource.title).click();
  await expect(page.locator('.ws-notice.ws-error')).toBeVisible();
  await expect(unreadButton(page, store.items[0].resource.title)).toBeEnabled();
  await expect(bell(page)).toHaveAttribute('aria-label', '알림 · 읽지 않음 2개');
  await expect(page.locator('.rd-bell i')).toHaveCount(1);
  expect(store.items.every(item => item.read_at === null)).toBe(true);

  store.rejectReads = false;
  await unreadButton(page, store.items[0].resource.title).click();
  await expect(bell(page)).toHaveAttribute('aria-label', '알림 · 읽지 않음 1개');
  await expect(page.locator('.ws-notice.ws-error')).toHaveCount(0);
  expectClean(fixture);
});

test('opening a notification persists its read before navigation and keeps a failed open unread', async ({ page }) => {
  const { fixture, store } = await notificationsFixture(page);
  store.rejectReads = true;
  await page.goto('/alerts');
  await expect(bell(page)).toHaveAttribute('aria-label', '알림 · 읽지 않음 2개');
  const title = page.locator('main').getByRole('link', { name: store.items[0].resource.title, exact: true });
  await title.click();
  await expect(page.locator('.ws-notice.ws-error')).toBeVisible();
  await expect(page).toHaveURL(/\/alerts$/);
  await expect(unreadButton(page, store.items[0].resource.title)).toBeEnabled();
  await expect(bell(page)).toHaveAttribute('aria-label', '알림 · 읽지 않음 2개');
  expect(store.items[0].read_at).toBeNull();

  store.rejectReads = false;
  await title.click();
  await expect(page).toHaveURL(new RegExp(`/documents/${sourceId}\\?kind=filing&analysis=us$`));
  await expect(page.getByTestId('redesign-analysis-detail').getByRole('heading', { name: approved.title, exact: true })).toBeVisible();
  await expect(bell(page)).toHaveAttribute('aria-label', '알림 · 읽지 않음 1개');
  expect(store.items[0].read_at).not.toBeNull();
  expect(store.writes).toEqual([{ id: store.items[0].id }, { id: store.items[0].id }]);

  await bell(page).click();
  await expect(page).toHaveURL(/\/alerts$/);
  await expect(page.getByRole('button', { name: `${store.items[0].resource.title} 읽음`, exact: true })).toBeDisabled();
  await expect(unreadButton(page, store.items[1].resource.title)).toBeEnabled();
  await expect(page.locator('.rd-bell i')).toHaveCount(1);
  expectClean(fixture);
});

test('returning to an unchanged page refreshes externally changed unread state', async ({ page }) => {
  const { fixture, store } = await notificationsFixture(page);
  await page.goto('/today');
  await expect(bell(page)).toHaveAttribute('aria-label', '알림 · 읽지 않음 2개');
  // An external session has read these on the server. No application-specific
  // event is injected: the user returning focus must refresh the visible bell.
  for (const item of store.items) item.read_at = fixtureNow;
  const before = store.reads;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect.poll(() => store.reads).toBeGreaterThan(before);
  await expect(bell(page)).toHaveAttribute('aria-label', '알림');
  await expect(page.locator('.rd-bell i')).toHaveCount(0);
  await expect(page).toHaveURL(/\/today$/);

  store.items[1].read_at = null;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(bell(page)).toHaveAttribute('aria-label', '알림 · 읽지 않음 1개');
  await expect(page.locator('.rd-bell i')).toHaveCount(1);
  expect(store.writes).toEqual([]);
  expectClean(fixture);
});

test('a notification read in another tab clears the returning tab without navigation', async ({ page, context }) => {
  const store = notificationStore();
  const first = await notificationsFixture(page, store);
  await page.goto('/today');
  await expect(bell(page)).toHaveAttribute('aria-label', '알림 · 읽지 않음 2개');

  const other = await context.newPage();
  const second = await notificationsFixture(other, store);
  await other.goto('/alerts');
  await expect(bell(other)).toHaveAttribute('aria-label', '알림 · 읽지 않음 2개');
  await other.getByRole('button', { name: '모두 읽음으로 표시', exact: true }).click();
  await expect(bell(other)).toHaveAttribute('aria-label', '알림');
  await page.bringToFront();
  await expect(bell(page)).toHaveAttribute('aria-label', '알림');
  await expect(page.locator('.rd-bell i')).toHaveCount(0);
  await expect(page).toHaveURL(/\/today$/);
  expect(store.writes).toEqual([{ all: true }]);
  expectClean(first.fixture);
  expectClean(second.fixture);
  await other.close();
});
