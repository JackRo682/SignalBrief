import {type Page, type Route} from '@playwright/test';
import {z} from 'zod';
import {answerSchema, calendarSchema, detailSchema, eventSchema, meSchema, notificationsSchema, portfolioSchema, type Company} from '../src/lib/contracts';
import {companyDetailSchema, defaults, preferenceSchema, resourceSchema, workspaceRequest, type Preferences, type Resource, type WorkspaceRequest} from '../src/workspace/contracts';

// All prices, disclosures, accounts and mutations below are synthetic, local to this E2E suite.
// The browser never reads or writes a production account or a live financial provider.
export const fixtureNow = '2026-10-06T08:00:00.000Z';
const uid = (group: number, index: number) => `${group}0000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
export const userId = uid(1, 71);
export const companies: Company[] = [
  ['엔비디아', 'NVDA'], ['애플', 'AAPL'], ['테슬라', 'TSLA'], ['마이크로소프트', 'MSFT'],
  ['브로드컴', 'AVGO'], ['아마존', 'AMZN'], ['알파벳', 'GOOG'], ['메타', 'META'],
].map(([name, ticker], i) => ({id: uid(2, i + 1), name, ticker, market: 'NASDAQ', provider: 'sec', is_demo: false, last_ingested_at: fixtureNow}));
export const companyId = companies[0].id;
export const eventId = uid(3, 1);
export const eventTitle = 'AI 수요 확대에 따른 매출 성장 확인';
const published = (hours: number) => new Date(Date.parse(fixtureNow) - hours * 3600000).toISOString();
const headlines = [eventTitle, '서비스 부문 매출과 성장 흐름 확인', '신규 생산시설 투자 계획 공시', '클라우드 사업의 주요 실적 발표', '데이터센터 수요와 가이던스 업데이트', '수출 규정 변경 관련 위험 요인 공시'];
export const events = headlines.map((headline, i) => {
  const company = companies[i < 4 ? i : 0], date = published([3, 5, 7, 9, 48, 120][i]);
  const source_url = `https://www.sec.gov/Archives/edgar/data/1/synthetic-mobile-${i + 1}.htm`;
  return eventSchema.parse({id: uid(3, i + 1), company, event_type: ['earnings', 'earnings', 'capex', 'earnings', 'guidance', 'risk'][i], state: 'published', headline,
    what_happened: `${company.name}의 공시에서 매출, 사업 현황과 다음 확인 사항을 정리했습니다.`, confidence: .96, materiality: .88 - i * .035,
    published_at: date, publication_precision: 'timestamp', is_demo: false, source_tier: 1, source_provider: 'sec', source_url,
    ranking: {score: .92 - i * .05, version: 'synthetic-v1', components: {materiality: .9, portfolio: .6, recency: .95}, effective_weights: {materiality: .5, portfolio: .2, recency: .3}, missing_components: [], reason: '공식 공시에서 수치 변화를 확인했습니다.', portfolio_weight_method: 'quantity_cost', market_reaction: 'not_used'},
    change_count: 2, fact_summary: '매출 12.5% 증가 · 영업이익 8.2% 증가', change_summary: [{field: 'revenue', previous_value: '40000', current_value: '45000'}, {field: 'operating_income', previous_value: '12000', current_value: '12984'}],
    interpretation: '공시에서 확인된 변화이며 이후 실적은 추가 자료를 확인해야 합니다.',
    source_document: {id: uid(4, i + 1), title: `${company.name} · 분기 실적 보고서`, provider: 'sec', source_url, published_at: date}});
});
export const companyResources: Resource[] = companies.map(company => resourceSchema.parse({id: company.id, kind: 'company', title: company.name, summary: '공식 공시에서 확인하는 기업 정보와 주요 변화', company_id: company.id, company_name: company.name, ticker: company.ticker, market: company.market, source_url: null, published_at: null, publication_precision: 'timestamp', category: 'company', is_saved: false}));
const eventResources: Resource[] = events.map(event => ({...companyResources.find(c => c.id === event.company.id)!, id: event.id, kind: 'event', title: event.headline, summary: event.what_happened, source_url: event.source_url, published_at: event.published_at, category: event.event_type}));
export const documents: Resource[] = events.map((event, i) => ({...eventResources[i], id: event.source_document.id, kind: i % 2 ? 'filing' : 'document', title: event.source_document.title, summary: '합성 검증 자료: 매출과 사업 현황에 관한 원문 및 인용 위치.', category: i % 2 ? '10-Q' : '실적 보고서'}));
const resources = [...companyResources, ...eventResources, ...documents];
const details = new Map(events.map((event, i) => {
  const facts = [
    ['revenue', '45000', 'Synthetic fixture: Revenue was USD 45,000 million for the quarter.'],
    ['operating_income', '12984', 'Synthetic fixture: Operating income was USD 12,984 million.'],
    ['net_income', '10500', 'Synthetic fixture: Net income was USD 10,500 million.'],
    ['eps', '1.25', 'Synthetic fixture: Earnings per share were USD 1.25.'],
  ].map(([field, value_raw, quote], j) => ({id: uid(5, i * 10 + j + 1), field, value_raw, quote, chunk_id: uid(6, i * 10 + j + 1), unit: field === 'eps' ? 'USD/share' : 'USD million', period: '2026 Q3', scope: 'consolidated', basis: 'GAAP', validation_status: 'supported'}));
  const detail = detailSchema.parse({event,
    document: {id: event.source_document.id, title: event.source_document.title, provider: 'sec', source_url: event.source_url, download_url: event.source_url, published_at: event.published_at, publication_date: event.published_at.slice(0, 10), publication_precision: 'timestamp', publication_timezone: 'America/New_York', ingested_at: fixtureNow, raw_sha256: 'a'.repeat(64), is_demo: false},
    facts, changes: facts.slice(0, 2).map((fact, j) => ({id: uid(7, i * 10 + j + 1), field: fact.field, current_fact_id: fact.id, previous_fact_id: null, change_type: 'increase', comparison_kind: 'same_period_prior_year', previous_value: j ? '12000' : '40000', current_value: fact.value_raw, absolute_change: j ? '984' : '5000', percentage_change: j ? '8.2' : '12.5', materiality: .88, confidence: .96})),
    evidence: facts.map((fact, j) => ({fact_id: fact.id, chunk_id: fact.chunk_id, document_id: event.source_document.id, quote: fact.quote, location: `Item 2 · Financial results · paragraph ${j + 1}`, source_url: event.source_url, source_name: 'SEC EDGAR', source_tier: 1, published_at: event.published_at, publication_precision: 'timestamp', is_demo: false, role: 'current'})),
    brief: {headline: event.headline, what_happened: event.what_happened, interpretation: event.interpretation, uncertainty: '다음 분기의 수치는 아직 확인되지 않았습니다.', monitor_next: '다음 분기 공시의 매출 및 사업별 수치를 확인하세요.', template_version: 'synthetic-v1'},
    validations: [{claim_key: 'revenue', status: 'supported', reason: '합성 원문의 인용 수치와 일치합니다.', validator_version: 'synthetic-v1'}],
    run: {id: uid(8, i + 1), stage: 'brief', model: 'synthetic-fixture', model_version: 'v1', prompt_version: 'v1', pipeline_version: 'v1', status: 'completed', latency_ms: 10, input_tokens: null, output_tokens: null, cost_usd: null, error_code: null, created_at: fixtureNow, finished_at: fixtureNow, validation_result: {supported: true}}});
  return [event.id, detail] as const;
}));
type Position = z.infer<typeof portfolioSchema>['positions'][number];
type Question = {id: string; event_id: string; question: string; answer: z.infer<typeof answerSchema>; created_at: string};
type Options = {onboarding?: boolean; empty?: boolean; watchIds?: string[]; holdingIds?: string[]; analyticsConsent?: boolean; summaryOnly?: boolean};
const positionFor = (company: Company, i = 0): Position => ({id: uid(9, i + 1), company, quantity: ['32', '20', '10', '8'][i % 4], average_cost: ['120', '190', '220', '400'][i % 4], currency: 'USD'});

export async function mobileFixture(page: Page, options: Options = {}) {
  const state = {
    profile: meSchema.parse({id: userId, display_name: '김투자', density: 'beginner', onboarding_completed: !options.onboarding, analytics_consent: options.analyticsConsent ?? false, is_admin: false, demo_mode: false}),
    preferences: {...defaults, history_enabled: true} as Preferences,
    preferenceVersion: 0,
    onboardingPreferences: {experience: 'beginner', markets: ['US'], sectors: ['AI 반도체', '전기차', '미국주식'], alert_frequency: 'essential'},
    watched: new Set(options.watchIds ?? (options.empty ? [] : companies.slice(0, 4).map(c => c.id))),
    positions: new Map((options.holdingIds ?? (options.empty ? [] : companies.slice(0, 4).map(c => c.id))).map((id, i) => [id, positionFor(companies.find(c => c.id === id)!, i)])),
    saved: new Set(options.empty ? [] : [events[1], events[2], events[3]].map(e => `event:${e.id}`).concat([`document:${documents[0].id}`, `filing:${documents[1].id}`])),
    visits: new Map<string, string>(options.empty ? [] : [[`company:${companyId}`, published(1)], [`event:${events[1].id}`, published(2)]]),
    searches: options.empty ? [] : [{query: '엔비디아', searched_at: published(1)}, {query: '테슬라', searched_at: published(2)}, {query: 'AI', searched_at: published(3)}, {query: '실적', searched_at: published(4)}],
    questions: [] as Question[],
    notifications: notificationsSchema.parse(events.slice(0, 4).map((event, i) => ({id: uid(8, 100 + i), read_at: i > 1 ? published(1) : null, created_at: event.published_at, event}))),
    calendar: calendarSchema.parse(events.slice(0, 3).map((event, i) => ({id: uid(8, 200 + i), title: `${event.company.name} 공시 확인`, occurs_on: `2026-10-${String(6 + i * 4).padStart(2, '0')}`, company_id: event.company.id, event_id: event.id, origin: 'official', quote: 'Synthetic fixture: Review the published quarterly filing.', source_url: event.source_url, is_demo: false}))),
    calls: [] as WorkspaceRequest[],
    apiCalls: [] as {method: string; path: string; body: unknown}[],
    unexpected: [] as string[], runtimeErrors: [] as string[],
  };
  await page.clock.setFixedTime(new Date(fixtureNow));
  page.on('pageerror', error => state.runtimeErrors.push(error.message));
  page.on('console', message => {if (message.type() === 'error' && /react|hydration|hydrating|server rendered|uncaught|maximum update/i.test(message.text())) state.runtimeErrors.push(message.text());});
  const user = {id: userId, aud: 'authenticated', role: 'authenticated', email: 'mobile-fixture@example.invalid', email_confirmed_at: published(100), created_at: published(100), user_metadata: {full_name: '김투자'}, app_metadata: {provider: 'google', providers: ['google']}, identities: [{id: userId, identity_id: userId, user_id: userId, provider: 'google', identity_data: {email: 'mobile-fixture@example.invalid'}}], factors: []};
  const seconds = Math.floor(Date.parse(fixtureNow) / 1000);
  const token = [{alg: 'HS256', typ: 'JWT'}, {sub: userId, role: 'authenticated', aud: 'authenticated', aal: 'aal1', exp: seconds + 36000, iat: seconds, session_id: uid(1, 99)}, 'synthetic-signature'].map(x => typeof x === 'string' ? x : Buffer.from(JSON.stringify(x)).toString('base64url')).join('.');
  await page.addInitScript(({token, user, seconds}) => {
    if (!localStorage.getItem('sb-test-project-auth-token')) localStorage.setItem('sb-test-project-auth-token', JSON.stringify({access_token: token, refresh_token: 'isolated-mobile-refresh', expires_at: seconds + 36000, expires_in: 36000, token_type: 'bearer', user}));
  }, {token, user, seconds});
  const unknown = async (route: Route, detail: string) => {state.unexpected.push(detail); await route.fulfill({status: 500, json: {error: {code: 'unexpected_mobile_fixture_request'}}});};
  await page.route('**/*', async route => {
    const url = new URL(route.request().url()), appOrigin = new URL(process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3000').origin;
    if (url.origin !== appOrigin && !['localhost', '127.0.0.1'].includes(url.hostname)) {await unknown(route, `external ${route.request().method()} ${url.origin}${url.pathname}`); return;}
    if (url.pathname.startsWith('/api/') || url.pathname.includes('/v1/')) {await unknown(route, `unhandled ${route.request().method()} ${url.pathname}`); return;}
    await route.fallback();
  });
  await page.route('**/api/auth-config', route => route.fulfill({json: {url: 'https://test-project.supabase.co', publishableKey: 'sb_publishable_isolated_fixture'}}));
  await page.route('https://test-project.supabase.co/auth/v1/**', route => {
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({json: path.endsWith('/token') ? {access_token: token, refresh_token: 'isolated-mobile-refresh', expires_in: 36000, token_type: 'bearer', user} : path.endsWith('/logout') ? {} : user, headers: {'Access-Control-Allow-Origin': '*'}});
  });
  await page.route('**/api/release', route => route.fulfill({json: {release: 'mobile-e2e-fixture', commit: 'synthetic-mobile-20261006', branch: 'isolated-test'}}));
  await page.route('**/api/us/reference-rate', route => route.fulfill({json: {base: 'USD', quote: 'KRW', rate: 1350, date: '2026-10-06', source: 'Synthetic E2E reference rate', kind: 'daily_reference'}}));
  await page.route('**/api/market?**', route => {
    const symbols = new URL(route.request().url()).searchParams.get('symbols')?.split(',') ?? [];
    return route.fulfill({json: {available: true, quotes: symbols.map(symbol => {
      const index = companies.findIndex(c => c.ticker === symbol), price = [146.76, 231.48, 262.67, 432.85, 181.3, 194.2, 169.4, 572.8][Math.max(index, 0)];
      return {symbol, price, currency: 'USD', change_pct: [3.47, 1.23, -1.15, .81][Math.max(index, 0) % 4], as_of: fixtureNow, source: 'Synthetic E2E quotes', history: [0.89, .9, .91, .9, .94, .92, .95, .93, .96, .98, .97, 1].map((scale, i) => ({date: `2026-09-${String(17 + i).padStart(2, '0')}`, close: Math.round(price * scale * 100) / 100}))};
    })}});
  });
  const savedResource = (resource: Resource) => ({...resource, is_saved: state.saved.has(`${resource.kind}:${resource.id}`)});
  const upsertPosition = (id: string, data: {quantity: string; average_cost: string | null; currency: string}) => {
    const company = companies.find(item => item.id === id);
    if (!company) throw new Error(`Unknown fixture company ${id}`);
    state.positions.set(id, {...positionFor(company, companies.indexOf(company)), ...data});
  };
  await page.route('**/v1/**', async route => {
    const url = new URL(route.request().url());
    if (url.hostname === 'test-project.supabase.co') {await route.fallback(); return;}
    const method = route.request().method(), path = url.pathname.slice(url.pathname.indexOf('/v1/'));
    const data = route.request().postData() ? route.request().postDataJSON() : null;
    state.apiCalls.push({method, path, body: data});
    let response: unknown;
    if (path === '/v1/config') response = {demo_mode: false, demo_admin_enabled: false, auth_mode: 'supabase'};
    else if (path === '/v1/me') response = state.profile;
    else if (path === '/v1/preferences') {if (method === 'PATCH') Object.assign(state.onboardingPreferences, data); response = state.onboardingPreferences;}
    else if (path === '/v1/companies') {const q = (url.searchParams.get('q') ?? '').toLowerCase(); response = companies.filter(c => `${c.name} ${c.ticker}`.toLowerCase().includes(q));}
    else if (path === '/v1/watchlist') response = {id: uid(1, 2), name: '관심종목', items: companies.filter(c => state.watched.has(c.id))};
    else if (/^\/v1\/watchlist\/[^/]+$/.test(path) && ['PUT', 'DELETE'].includes(method)) {const id = path.split('/').at(-1)!; if (method === 'PUT') state.watched.add(id); else state.watched.delete(id); await route.fulfill({status: 204}); return;}
    else if (path === '/v1/portfolio') response = portfolioSchema.parse({id: uid(1, 3), name: '내 포트폴리오', weighting_note: '입력한 보유 수량 기준', positions: [...state.positions.values()]});
    else if (/^\/v1\/portfolio\/positions\/[^/]+$/.test(path) && ['PUT', 'DELETE'].includes(method)) {const id = path.split('/').at(-1)!; if (method === 'PUT') upsertPosition(id, data); else state.positions.delete(id); await route.fulfill({status: 204}); return;}
    else if (path === '/v1/feed') {const limit = Number(url.searchParams.get('limit') ?? 20), offset = Number(url.searchParams.get('offset') ?? 0), selected = events.filter(e => state.watched.has(e.company.id) || state.positions.has(e.company.id)).map(event => options.summaryOnly ? {...event, fact_summary: null, change_summary: [], interpretation: null} : event); response = {items: selected.slice(offset, offset + limit), total: selected.length, has_more: offset + limit < selected.length, truncated: false, latest_ingested_at: fixtureNow, stale: false, demo_mode: false, generated_at: fixtureNow};}
    else if (/^\/v1\/companies\/[^/]+\/timeline$/.test(path)) response = events.filter(e => e.company.id === path.split('/')[3]);
    else if (/^\/v1\/events\/[^/]+\/questions$/.test(path) && method === 'POST') {
      const selected = details.get(path.split('/')[3]);
      if (!selected) {await unknown(route, `unknown event ${path}`); return;}
      const answer = answerSchema.parse({status: 'answered', message: '선택한 공시의 매출은 USD 45,000 million입니다. 아래 원문 인용에서 확인할 수 있습니다.', evidence: [{source_id: selected.document.id, quote: selected.facts[0].quote, source_url: selected.document.source_url, location: selected.evidence[0].location}], run_id: null, mode: 'extractive'});
      state.questions.unshift({id: uid(8, 300 + state.questions.length), event_id: selected.event.id, question: data.question, answer, created_at: fixtureNow}); response = answer;
    } else if (/^\/v1\/events\/[^/]+$/.test(path)) response = details.get(path.split('/')[3]);
    else if (path === '/v1/questions') {if (method === 'DELETE') {state.questions.splice(0); await route.fulfill({status: 204}); return;} response = state.questions;}
    else if (path === '/v1/notifications') response = state.notifications;
    else if (/^\/v1\/notifications\/[^/]+\/read$/.test(path) && method === 'PUT') {const id = path.split('/')[3]; state.notifications.forEach(n => {if (id === 'all' || id === n.id) n.read_at = fixtureNow;}); await route.fulfill({status: 204}); return;}
    else if (path === '/v1/alerts') response = [{id: uid(8, 400), name: '주요 공시 변화', event_types: ['earnings', 'guidance'], min_score: .75, enabled: true, created_at: published(72)}];
    else if (path === '/v1/calendar') response = state.calendar;
    else if (path === '/v1/analytics' && method === 'POST') {await route.fulfill({status: 204}); return;}
    else {await unknown(route, `${method} ${path}`); return;}
    if (response === undefined) {await unknown(route, `missing ${method} ${path}`); return;}
    await route.fulfill({json: response});
  });
  await page.route('**/api/workspace', async route => {
    const parsed = workspaceRequest.safeParse(route.request().postDataJSON());
    if (!parsed.success) {await unknown(route, `invalid workspace request ${parsed.error.message}`); return;}
    const {action, p} = parsed.data;
    state.calls.push(parsed.data);
    let response: unknown;
    switch (action) {
      case 'preferences': response = preferenceSchema.parse({value: state.preferences, version: state.preferenceVersion}); break;
      case 'preferences_save': {
        if (p.version !== state.preferenceVersion) {await route.fulfill({status: 409, json: {error: {code: 'version_conflict'}}}); return;}
        Object.assign(state.preferences, p.value); state.preferenceVersion++; response = {value: state.preferences, version: state.preferenceVersion}; break;
      }
      case 'catalog': {
        const alias = companies.find(c => c.name === p.q)?.ticker ?? p.q ?? '', q = alias.toLowerCase();
        const all = resources.map(savedResource).filter(r => (!q || `${r.title} ${r.summary} ${r.company_name} ${r.ticker} ${r.category}`.toLowerCase().includes(q)) && (!p.market || r.market === p.market) && (!p.days || !r.published_at || Date.parse(r.published_at) >= Date.parse(fixtureNow) - p.days * 86400000));
        const selected = all.filter(r => !p.kind || r.kind === p.kind || p.kind === 'document' && r.kind === 'filing');
        if (p.sort === 'newest') selected.sort((a, b) => (b.published_at ?? '').localeCompare(a.published_at ?? ''));
        const offset = p.offset ?? 0, limit = p.limit ?? 20;
        response = {items: selected.slice(offset, offset + limit), total: selected.length, counts: all.reduce((counts, r) => ({...counts, [r.kind]: (counts[r.kind] ?? 0) + 1}), {} as Record<string, number>), markets: ['NASDAQ'], next_offset: offset + limit < selected.length ? offset + limit : null}; break;
      }
      case 'company': {
        const company = companyResources.find(c => c.id === p.id), detail = [...details.values()].find(d => d.event.company.id === p.id);
        if (!company) {await unknown(route, `unknown company ${p.id}`); return;}
        response = companyDetailSchema.parse({company, events: eventResources.filter(e => e.company_id === p.id).map(savedResource), documents: documents.filter(d => d.company_id === p.id).map(savedResource), facts: detail?.facts.map(f => ({...f, event_id: detail.event.id})) ?? [], watching: state.watched.has(p.id), holding: state.positions.has(p.id)}); break;
      }
      case 'resource': response = resources.filter(r => r.id === p.id && r.kind === p.kind).map(savedResource)[0]; break;
      case 'saved_list': {
        const saved = resources.filter(r => state.saved.has(`${r.kind}:${r.id}`)).map(r => ({...savedResource(r), saved_at: published(1)}));
        const history = resources.filter(r => state.visits.has(`${r.kind}:${r.id}`)).map(r => ({...savedResource(r), saved_at: state.visits.get(`${r.kind}:${r.id}`)}));
        const selected = (p.kind === 'history' ? history : saved).filter(r => (!p.kind || p.kind === 'history' || r.kind === p.kind || p.kind === 'document' && r.kind === 'filing') && (!p.company || r.company_id === p.company) && (!p.q || `${r.title} ${r.ticker}`.toLowerCase().includes(p.q.toLowerCase())));
        response = {items: selected, counts: {event: saved.filter(r => r.kind === 'event').length, document: saved.filter(r => ['document', 'filing'].includes(r.kind)).length, history: history.length}}; break;
      }
      case 'save': {const key = `${p.kind}:${p.id}`; if (p.saved) state.saved.add(key); else state.saved.delete(key); response = {saved: p.saved}; break;}
      case 'visit': if (state.preferences.history_enabled) state.visits.set(`${p.kind}:${p.id}`, fixtureNow); response = {recorded: state.preferences.history_enabled}; break;
      case 'searches': response = state.searches; break;
      case 'search_record': if (state.preferences.history_enabled) {state.searches = [{query: p.query, searched_at: fixtureNow}, ...state.searches.filter(s => s.query !== p.query)].slice(0, 10);} response = {recorded: state.preferences.history_enabled}; break;
      case 'search_delete': state.searches = state.searches.filter(s => s.query !== p.query); response = {deleted: true}; break;
      case 'searches_clear': state.searches = []; response = {cleared: true}; break;
      case 'history_clear': state.searches = []; state.visits.clear(); response = {cleared: true}; break;
      case 'onboarding_complete':
        p.removed_company_ids.forEach(id => state.watched.delete(id)); p.company_ids.forEach(id => state.watched.add(id)); p.positions.forEach(position => upsertPosition(position.company_id, position));
        state.profile.onboarding_completed = true; if (p.analytics_consent !== undefined) state.profile.analytics_consent = p.analytics_consent;
        response = meSchema.parse(state.profile); break;
      case 'account': response = {created_at: user.created_at, bio: state.preferences.bio, tickets: []}; break;
      case 'security': response = {sessions: [{id: uid(1, 99), created_at: user.created_at, last_seen: fixtureNow, user_agent: 'Synthetic Chromium mobile', aal: 'aal1', current: true}], history: []}; break;
      case 'notifications': response = {realtime_enabled: true, notify_min_score: .75}; break;
      case 'tickets': response = []; break;
      default: await unknown(route, `workspace action ${action}`); return;
    }
    if (response === undefined) {await unknown(route, `missing workspace resource ${action}`); return;}
    await route.fulfill({json: response});
  });
  return {state, upsertPosition};
}

export type MobileFixture = Awaited<ReturnType<typeof mobileFixture>>;
