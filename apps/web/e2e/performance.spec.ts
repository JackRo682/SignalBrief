import { test, expect } from '@playwright/test';

// Isolated API fixtures verify the real Next app, AuthProvider and injected navigation.
// No Google accounts, Supabase credentials, or production endpoints are used.
test('menu transitions retain auth and render feed before delayed secondary requests', async ({ page }) => {
  const calls: string[] = [], documents: string[] = [];
  const company = { id: '00000001-0000-4000-8000-000000000001', name: 'Synthetic US company', ticker: 'TEST', market: 'NASDAQ', provider: 'sec', is_demo: true, last_ingested_at: null };
  const event = { id: '00000011-0000-4000-8000-000000000001', company, headline: 'Synthetic verified change', what_happened: 'Persisted summary', published_at: new Date().toISOString(), source_provider: 'sec', source_url: 'https://example.com/evidence', ranking: { reason: 'Synthetic fixture' },
    fact_summary: 'Persisted quote', change_summary: [{ field: 'revenue', previous_value: '10', current_value: '12' }], interpretation: 'Reviewed interpretation', source_document: { id: 'document', title: 'Synthetic source', source_url: 'https://example.com/evidence' } };
  let release!: () => void;
  const delayed = new Promise<void>(resolve => { release = resolve; });
  let holdSecondary = true;
  page.on('request', request => { if (request.isNavigationRequest() && request.frame() === page.mainFrame()) documents.push(request.url()); });
  await page.addInitScript(() => sessionStorage.setItem('signalbrief.demo.token', 'isolated-synthetic-token'));
  await page.route('**/v1/**', async route => {
    const path = new URL(route.request().url()).pathname; calls.push(route.request().method()+" "+path);
    const endpoint = path.replace(/^\/api/, '');
    let data: unknown = [];
    if (endpoint === '/v1/config') data = { demo_mode: true, demo_admin_enabled: false, auth_mode: 'demo' };
    else if (endpoint === '/v1/me') data = { id: 'synthetic-user', display_name: 'Test', density: 'advanced', onboarding_completed: true, analytics_consent: false, is_admin: false, demo_mode: true };
    else if (endpoint === '/v1/feed') data = { items: [event], total: 1 };
    else if (endpoint === '/v1/companies') data = [company];
    else if (endpoint === '/v1/watchlist') data = { id: 'watch', name: 'Watch', items: [company] };
    else if (endpoint === '/v1/portfolio') data = { id: 'portfolio', name: 'Portfolio', positions: [] };
    else if (endpoint.endsWith('/timeline')) data = [event];
    if (holdSecondary && ['/v1/calendar', '/v1/portfolio'].includes(endpoint)) await delayed;
    await route.fulfill({ json: data, headers: { 'Access-Control-Allow-Origin': '*' } });
  });
  await page.route('**/api/market?**', async route => {
    if (holdSecondary) await delayed;
    await route.fulfill({ json: { quotes: [] } });
  });
  await page.goto('/today');
  await expect(page.locator('.todayItem')).toContainText('Persisted quote');
  await expect(page.locator('.todayItem')).toContainText('Reviewed interpretation');
  expect(calls.some(path => path.includes('/v1/events/'))).toBe(false);
  holdSecondary = false; release();
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
});
