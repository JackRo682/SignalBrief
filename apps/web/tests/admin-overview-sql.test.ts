// @vitest-environment node
// Actual SQL and production guard helpers, executed only in isolated embedded PostgreSQL.
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { adminOverviewResponseSchema, type AdminOverviewRequest } from '../src/admin-logs/overview-contracts';

const migration = 'migrations/20261105045400_admin_overview.sql';
const sql = (file: string) => readFileSync(new URL(`../../../supabase/${file}`, import.meta.url), 'utf8');
const admin = '10000000-0000-4000-8000-000000000001';
const member = '10000000-0000-4000-8000-000000000002';
const declined = '10000000-0000-4000-8000-000000000003';
const other = '10000000-0000-4000-8000-000000000004';
const adminSession = '20000000-0000-4000-8000-000000000001';
const memberSession = '20000000-0000-4000-8000-000000000002';
let db: PGlite;
let dates: { from: string; to: string };

async function identity(user: string | null = admin, session: string | null = adminSession, aal = 'aal1') {
  await db.exec('RESET ROLE');
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",
    [user ?? '', JSON.stringify({ ...(user ? { sub: user } : {}), ...(session ? { session_id: session } : {}), aal })]);
  await db.exec('SET ROLE authenticated');
}
async function read(overrides: Record<string, unknown> = {}) {
  const p: AdminOverviewRequest = { ...dates, include_admin: false };
  const { rows } = await db.query<{ data: unknown }>('SELECT public.sb_admin_overview($1::jsonb) AS data', [JSON.stringify({ ...p, ...overrides })]);
  return adminOverviewResponseSchema.parse(rows[0].data);
}
async function usage(user = member, overrides: Record<string, unknown> = {}) {
  const v = { id: randomUUID(), session: memberSession, page: randomUUID(), screen: 'today', device: 'desktop', kind: 'view', ms: 0,
    at: new Date(Date.now() - 60_000).toISOString(), ...overrides };
  await db.exec('RESET ROLE');
  await db.query(`INSERT INTO app_private.research_events(id,user_id,session_id,page_id,screen,device,kind,active_ms,created_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [v.id, user, v.session, v.page, v.screen, v.device, v.kind, v.ms, v.at]);
}
async function product(user = member, overrides: Record<string, unknown> = {}) {
  const v = { id: randomUUID(), event: 'brief_opened', properties: {}, at: new Date(Date.now() - 60_000).toISOString(), ...overrides };
  await db.exec('RESET ROLE');
  await db.query('INSERT INTO public.user_events(id,user_id,event_name,properties,created_at) VALUES($1,$2,$3,$4::json,$5)',
    [v.id, user, v.event, JSON.stringify(v.properties), v.at]);
}
async function localDay(offset: number) {
  return (await db.query<{ day: string }>(`SELECT ((now() AT TIME ZONE 'Asia/Seoul')::date + $1::integer)::text AS day`, [offset])).rows[0].day;
}
async function onDay(offset: number) {
  return (await db.query<{ at: string }>(`SELECT (((now() AT TIME ZONE 'Asia/Seoul')::date + $1::integer)::timestamp AT TIME ZONE 'Asia/Seoul' + interval '1 millisecond')::text AS at`, [offset])).rows[0].at;
}
async function profile() {
  const id = randomUUID();
  await db.exec('RESET ROLE');
  await db.query('INSERT INTO auth.users(id,email_confirmed_at) VALUES($1,now())', [id]);
  await db.query("INSERT INTO public.users(id,analytics_consent,created_at,onboarding_completed) VALUES($1,true,now()-interval '100 days',false)", [id]);
  return id;
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth; CREATE SCHEMA app_private;
    CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,email_confirmed_at timestamptz,deleted_at timestamptz,banned_until timestamptz);
    CREATE TABLE auth.sessions(id uuid PRIMARY KEY,user_id uuid REFERENCES auth.users,not_after timestamptz);
    CREATE TABLE auth.mfa_factors(id uuid,user_id uuid,status text);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
      $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS
      $$SELECT coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
    CREATE TABLE public.users(id varchar PRIMARY KEY,analytics_consent boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now(),onboarding_completed boolean NOT NULL DEFAULT false);
    CREATE TABLE public.user_events(id varchar PRIMARY KEY,user_id varchar REFERENCES public.users,event_name varchar NOT NULL,properties json NOT NULL,created_at timestamptz NOT NULL);
    CREATE TABLE public.rate_buckets(key text PRIMARY KEY,hits integer NOT NULL,expires_at timestamptz NOT NULL);
    CREATE TABLE app_private.sb_admin_users(user_id text PRIMARY KEY);
    GRANT USAGE ON SCHEMA auth,app_private TO authenticated;
    ALTER TABLE public.user_events ENABLE ROW LEVEL SECURITY;
    GRANT SELECT ON public.user_events TO authenticated;
  `);
  const hosted = sql('hosted/20261003003202_signalbrief_web_rls_and_profiles.sql');
  for (const name of ['app_private.sb_is_admin', 'public.sb_rate_limit']) {
    const definition = hosted.match(new RegExp(`CREATE FUNCTION ${name.replaceAll('.', '\\.')}\\(\\)[\\s\\S]*?\\$\\$;`))?.[0];
    if (!definition) throw new Error(`Missing actual helper: ${name}`);
    await db.exec(definition);
  }
  await db.exec(sql('workspace-migrations/20261005094000_workspace_mfa.sql').split('DO $$ DECLARE previous')[0]);
  const research = sql('research-migrations/20261010114340_research_admin.sql');
  for (const name of ['research_events', 'research_audit', 'research_api_metrics']) {
    const definition = research.match(new RegExp(`CREATE TABLE app_private\\.${name} \\([\\s\\S]*?\\n\\);`))?.[0];
    if (!definition) throw new Error(`Missing actual table: ${name}`);
    await db.exec(definition);
    await db.exec(`ALTER TABLE app_private.${name} ENABLE ROW LEVEL SECURITY; REVOKE ALL ON app_private.${name} FROM PUBLIC,anon,authenticated;`);
  }
  await db.exec(sql('migrations/20261105020506_admin_user_activity_logs.sql'));
  await db.exec(sql(migration));
}, 90_000);

beforeEach(async () => {
  await db.exec(`RESET ROLE;
    TRUNCATE public.user_events,app_private.research_events,app_private.research_audit,app_private.research_api_metrics,
      auth.sessions,auth.mfa_factors,auth.users,public.users,app_private.sb_admin_users,public.rate_buckets CASCADE;
    INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
      ('${admin}','administrator@example.invalid',now()),('${member}','member@example.invalid',now()),
      ('${declined}','declined@example.invalid',now()),('${other}','other@example.invalid',now());
    INSERT INTO public.users(id,analytics_consent,created_at) VALUES
      ('${admin}',false,now()-interval '100 days'),('${member}',true,now()-interval '100 days'),
      ('${declined}',false,now()-interval '100 days'),('${other}',true,now()-interval '100 days');
    INSERT INTO auth.sessions VALUES('${adminSession}','${admin}',NULL),('${memberSession}','${member}',NULL);
    INSERT INTO app_private.sb_admin_users VALUES('${admin}');
  `);
  dates = { from: await localDay(-13), to: await localDay(0) };
  await identity();
});
afterAll(async () => { await db?.close(); });

describe('overview SQL access boundary', () => {
  it('locks the definer search path, exposes an invoker wrapper, and grants no anonymous/raw access', async () => {
    await db.exec('RESET ROLE');
    const funcs = (await db.query(`SELECT n.nspname,p.prosecdef,p.proconfig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE p.proname='sb_admin_overview' ORDER BY n.nspname`)).rows;
    expect(funcs).toEqual([
      { nspname: 'app_private', prosecdef: true, proconfig: ['search_path=""'] },
      { nspname: 'public', prosecdef: false, proconfig: ['search_path=""'] },
    ]);
    expect((await db.query(`SELECT has_function_privilege('anon','public.sb_admin_overview(jsonb)','EXECUTE') AS anon,
      has_function_privilege('authenticated','public.sb_admin_overview(jsonb)','EXECUTE') AS member,
      has_table_privilege('authenticated','public.user_events','SELECT') AS raw`)).rows[0]).toEqual({ anon: false, member: true, raw: false });
    await db.exec('SET ROLE anon');
    await expect(read()).rejects.toMatchObject({ code: '42501' });
    await identity();
    await expect(db.query('SELECT * FROM app_private.research_api_metrics')).rejects.toMatchObject({ code: '42501' });
  });

  it('rejects anonymous identities, normal accounts, and direct private calls', async () => {
    await identity(null, null);
    await expect(read()).rejects.toMatchObject({ code: 'PT401', message: 'authentication_required' });
    await identity(member, memberSession);
    await expect(read()).rejects.toMatchObject({ code: 'PT403', message: 'admin_required' });
    await expect(db.query('SELECT app_private.sb_admin_overview($1::jsonb)', [JSON.stringify({ ...dates, include_admin: false })]))
      .rejects.toMatchObject({ code: 'PT403', message: 'admin_required' });
  });

  it.each([
    ['deleted_at=now()', 'PT401', 'invalid_or_expired_session'],
    ["banned_until=now()+interval '1 day'", 'PT401', 'invalid_or_expired_session'],
    ['email_confirmed_at=NULL', 'PT403', 'verified_account_required'],
  ])('checks the current administrator account: %s', async (change, code, message) => {
    await db.exec(`RESET ROLE; UPDATE auth.users SET ${change} WHERE id='${admin}';`);
    await identity();
    await expect(read()).rejects.toMatchObject({ code, message });
  });

  it.each([null, 'invalid-id', memberSession, '20000000-0000-4000-8000-000000000099'])('requires a live, matching session: %s', async (session) => {
    await identity(admin, session);
    await expect(read()).rejects.toMatchObject({ code: 'PT401', message: 'session_revoked' });
  });

  it('rechecks session expiry and allowlist membership', async () => {
    await db.exec(`RESET ROLE; UPDATE auth.sessions SET not_after=now()-interval '1 second' WHERE id='${adminSession}'`);
    await identity();
    await expect(read()).rejects.toMatchObject({ code: 'PT401', message: 'session_revoked' });
    await db.exec(`RESET ROLE; UPDATE auth.sessions SET not_after=NULL WHERE id='${adminSession}'; DELETE FROM app_private.sb_admin_users;`);
    await identity();
    await expect(read()).rejects.toMatchObject({ code: 'PT403', message: 'admin_required' });
  });

  it('uses real MFA and rate-limit guards', async () => {
    await db.exec(`RESET ROLE; INSERT INTO auth.mfa_factors VALUES(gen_random_uuid(),'${admin}','verified');`);
    await identity();
    await expect(read()).rejects.toMatchObject({ code: 'PT403', message: 'mfa_required' });
    await identity(admin, adminSession, 'aal2');
    expect((await read()).summary.visitors).toBe(0);
    await db.exec('RESET ROLE; UPDATE public.rate_buckets SET hits=120;');
    await identity(admin, adminSession, 'aal2');
    await expect(read()).rejects.toMatchObject({ code: 'PT429', message: 'rate_limit_exceeded' });
  });
});

describe('overview measurement semantics', () => {
  it('returns zero recorded counts, null unavailable ratios, and no fabricated signup or retention', async () => {
    const result = await read();
    expect(result.summary).toMatchObject({ visitors: 0, page_views: 0, sessions: 0, active_ms: 0, average_active_ms: null,
      signup_conversion: null, core_feature_users: 0, core_feature_rate: null, ended_sessions: 0,
      activation: { eligible: 0, completed: 0, rate: null, basis: 'new_profiles_current_onboarding' } });
    expect(result.retention).toEqual([1, 7].map(day => ({ day, returned: 0, eligible: 0, pending: 0, rate: null })));
    expect(result.coverage.first_available_event_at).toBeNull();
    expect(result.coverage.signup_status).toBe('not_instrumented');
    expect(result.api).toMatchObject({ requests: 0, errors: 0, error_rate: null, mean_latency_ms: null, last_seen: null, recent_error_hours: [] });
    expect(result.days).toHaveLength(14);
  });

  it('counts both sources, rechecks consent, excludes admins/deleted accounts, and never emits private content', async () => {
    await usage();
    await usage(member, { kind: 'heartbeat', ms: 3000 });
    await product(other, { properties: { email: 'PRIVATE_EMAIL', question: 'PRIVATE_QUESTION', token: 'PRIVATE_TOKEN' } });
    await product(other, { event: 'unapproved_private_event' });
    await product(other, { id: 'unsafe/private-id' });
    await usage(declined);
    await product(declined);
    const deleted = await profile();
    await usage(deleted);
    await db.exec(`UPDATE auth.users SET deleted_at=now() WHERE id='${deleted}'; UPDATE public.users SET analytics_consent=true WHERE id='${admin}';`);
    await usage(admin);
    await identity();
    const result = await read();
    expect(result.coverage).toMatchObject({ consented_users: 3, eligible_users: 2 });
    expect(result.summary).toMatchObject({ visitors: 1, page_views: 1, active_users: 2, sessions: 1, active_ms: 3000,
      average_active_ms: 3000, core_feature_users: 1, core_feature_rate: 0.5 });
    expect(result.features.find(f => f.event === 'brief_opened')).toEqual({ event: 'brief_opened', users: 1, events: 1, usage_rate: 0.5 });
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE_|unsafe|properties|email|user_id|session_id/);
    expect((await read({ include_admin: true })).summary.visitors).toBe(2);
    await db.exec(`RESET ROLE; UPDATE public.users SET analytics_consent=false WHERE id='${member}';`);
    await identity();
    expect((await read()).summary).toMatchObject({ visitors: 0, active_users: 1, core_feature_users: 1, core_feature_rate: 1, sessions: 0 });
    await db.exec('RESET ROLE');
    const audit = (await db.query<{ action: string; detail: Record<string, unknown> }>('SELECT action,detail FROM app_private.research_audit')).rows;
    expect(audit).toHaveLength(3);
    expect(audit.every(row => row.action === 'admin_overview_read')).toBe(true);
    expect(Object.keys(audit[0].detail).sort()).toEqual(['from', 'include_admin', 'to']);
  });

  it('reconstructs 30-minute session gaps, separates users, excludes server conversions, and counts only heartbeat time', async () => {
    const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
    const baseline = Date.now();
    const at = (minutes: number) => new Date(baseline - minutes * 60_000).toISOString();
    await usage(member, { at: at(180) });
    await usage(member, { at: at(170), kind: 'heartbeat', ms: 1000 });
    await usage(member, { at: at(140), screen: 'search' });
    await usage(member, { at: at(130), screen: 'search', kind: 'heartbeat', ms: 2000 });
    await usage(member, { at: at(5), screen: 'calendar' });
    await usage(member, { at: at(4), screen: 'calendar', kind: 'click', ms: 15000 });
    await usage(member, { at: at(3), screen: 'onboarding', kind: 'conversion', session: randomUUID() });
    await usage(other, { at: ago(2), screen: 'saved' }); // deliberately reuse the stored session UUID
    await identity();
    const result = await read();
    expect(result.summary).toMatchObject({ visitors: 2, page_views: 4, sessions: 4, active_ms: 3000, average_active_ms: 750, ended_sessions: 2 });
    expect(result.pages.find(p => p.screen === 'today')).toMatchObject({ exits: 1, exit_rate: 1, active_ms: 1000 });
    expect(result.pages.find(p => p.screen === 'search')).toMatchObject({ exits: 1, exit_rate: 1, active_ms: 2000 });
    expect(result.pages.find(p => p.screen === 'calendar')).toMatchObject({ exits: 0, active_ms: 0 });
    expect(result.pages.some(p => p.screen === 'onboarding')).toBe(false);
  });

  it('does not invent an exit when a session continues after the chosen end date', async () => {
    const end = await onDay(-1);
    await usage(member, { at: new Date(Date.parse(end) - 10 * 60_000).toISOString() });
    await usage(member, { at: new Date(Date.parse(end) + 5 * 60_000).toISOString(), screen: 'search' });
    await identity();
    const before = await read({ from: await localDay(-2), to: await localDay(-2) });
    expect(before.summary).toMatchObject({ sessions: 1, ended_sessions: 0 });
    expect(before.pages[0].exit_rate).toBe(0);
    const together = await read({ from: await localDay(-2), to: await localDay(-1) });
    expect(together.summary).toMatchObject({ sessions: 1, ended_sessions: 1 });
    expect(together.pages.find(p => p.screen === 'search')?.exits).toBe(1);
  });

  it('uses inclusive KST dates, excludes future/expired events, and zero-fills only visible dates', async () => {
    await db.exec('RESET ROLE');
    const b = (await db.query<{ day: string; start: string; end: string; before: string; late: string }>(`WITH d AS (
      SELECT (now() AT TIME ZONE 'Asia/Seoul')::date-2 AS day
    ) SELECT day::text, (day::timestamp AT TIME ZONE 'Asia/Seoul')::text AS start,
      ((day+1)::timestamp AT TIME ZONE 'Asia/Seoul')::text AS end,
      ((day::timestamp AT TIME ZONE 'Asia/Seoul')-interval '1 microsecond')::text AS before,
      (((day+1)::timestamp AT TIME ZONE 'Asia/Seoul')-interval '1 microsecond')::text AS late FROM d`)).rows[0];
    await usage(member, { at: b.start });
    await usage(member, { at: b.late });
    await usage(other, { at: b.before });
    await usage(other, { at: b.end });
    await usage(other, { at: new Date(Date.now() + 86400000).toISOString() });
    await usage(other, { at: new Date(Date.now() - 91 * 86400000).toISOString() });
    await identity();
    const result = await read({ from: b.day, to: b.day });
    expect(result.summary).toMatchObject({ visitors: 1, page_views: 2 });
    expect(result.days).toEqual([{ day: b.day, visitors: 1, page_views: 2 }]);
    const expired = await read({ from: await localDay(-91), to: await localDay(-91) });
    expect(expired.summary.visitors).toBe(0);
    expect(expired.days).toEqual([]);
    expect(expired.api.coverage_from).toBeNull();
    const future = await read({ from: await localDay(1), to: await localDay(1) });
    expect(future.summary.visitors).toBe(0);
    expect(future.days).toEqual([]);
  });

  it('labels activation as a current onboarding snapshot for selected new profiles', async () => {
    await db.exec('RESET ROLE');
    await db.query('UPDATE public.users SET created_at=$1,onboarding_completed=(id=$2) WHERE id IN ($2,$3)', [await onDay(-3), member, other]);
    await identity();
    const first = await read({ from: await localDay(-3), to: await localDay(-3) });
    expect(first.summary.activation).toEqual({ completed: 1, eligible: 2, rate: 0.5,
      basis: 'new_profiles_current_onboarding', as_of: first.generated_at });
    await db.exec(`RESET ROLE; UPDATE public.users SET onboarding_completed=true WHERE id='${other}';`);
    await identity();
    expect((await read({ from: await localDay(-3), to: await localDay(-3) })).summary.activation.rate).toBe(1);
    expect((await read({ from: await localDay(-2), to: await localDay(-2) })).summary.activation.rate).toBeNull();
  });

  it('uses first-view cohorts and returns after the selected cohort window without treating product events as first visits', async () => {
    await product(member, { at: await onDay(-20), event: 'sign_up' });
    for (const day of [-10, -9, -3]) await usage(member, { at: await onDay(day) });
    for (const day of [-8, -6]) await usage(other, { at: await onDay(day) });
    const old = await profile();
    for (const day of [-20, -9]) await usage(old, { at: await onDay(day) });
    await identity();
    const result = await read({ from: await localDay(-10), to: await localDay(-8) });
    expect(result.retention).toEqual([1, 7].map(day => ({ day, returned: 1, eligible: 2, pending: 0, rate: 0.5 })));
    expect(result.coverage.retention_basis).toBe('first_observed_view_in_retained_history');
    expect(result.coverage.retention_observed_until).toBe(result.generated_at);
  });

  it('keeps current target days pending even if a return has already been recorded', async () => {
    for (const day of [-7, 0]) await usage(member, { at: await onDay(day) });
    for (const day of [-8, -1]) await usage(other, { at: await onDay(day) });
    const yesterday = await profile();
    for (const day of [-1, 0]) await usage(yesterday, { at: await onDay(day) });
    const today = await profile();
    await usage(today, { at: await onDay(0) });
    await identity();
    const result = await read();
    expect(result.retention).toEqual([
      { day: 1, returned: 0, eligible: 2, pending: 2, rate: 0 },
      { day: 7, returned: 1, eligible: 1, pending: 3, rate: 1 },
    ]);
  });

  it('excludes the partial oldest retained day from first-observed retention cohorts', async () => {
    const cutoff = Date.now() - 90 * 86400000;
    await usage(member, { at: new Date(cutoff + 60_000).toISOString() });
    await usage(member, { at: new Date(cutoff + 86400000 + 60_000).toISOString() });
    await usage(other, { at: await onDay(-89) });
    await usage(other, { at: await onDay(-88) });
    await identity();
    const result = await read({ from: await localDay(-90), to: await localDay(-1) });
    expect(result.retention[0]).toEqual({ day: 1, returned: 1, eligible: 1, pending: 0, rate: 1 });
  });

  it('uses weighted system API error/request ratios, independent admin scope, and explicit 30-day coverage', async () => {
    await db.exec(`RESET ROLE;
      INSERT INTO app_private.research_api_metrics(hour,requests,errors,latency_ms,last_seen) VALUES
      (date_trunc('hour',now())-interval '2 hours',100,2,10000,now()-interval '2 hours'),
      (date_trunc('hour',now())-interval '1 hour',10,8,2000,now()-interval '1 hour'),
      (date_trunc('hour',now())-interval '31 days',1000,900,999999,now()-interval '31 days');`);
    await identity();
    const result = await read({ from: await localDay(-89) });
    expect(result.api).toMatchObject({ requests: 110, errors: 10, includes_admin: true, retention_days: 30,
      scope: 'signalbrief_api_completed_requests' });
    expect(result.api.error_rate).toBeCloseTo(10 / 110, 10);
    expect(result.api.mean_latency_ms).toBeCloseTo(12000 / 110, 8);
    expect(result.api.recent_error_hours.map(row => row.errors)).toEqual([8, 2]);
    expect(Date.parse(result.api.coverage_from!)).toBeGreaterThanOrEqual(Date.now() - 30 * 86400000 - 1000);
    expect((await read({ from: await localDay(-89), include_admin: true })).api.requests).toBe(110);
  });

  it('bounds recent error buckets without truncating the full-period totals or inventing individual errors', async () => {
    await db.exec(`RESET ROLE; INSERT INTO app_private.research_api_metrics(hour,requests,errors,latency_ms,last_seen)
      SELECT date_trunc('hour',now())-n*interval '1 hour',2,1,20,now()-n*interval '1 hour' FROM generate_series(1,25) n;`);
    await identity();
    const result = await read();
    expect(result.api).toMatchObject({ requests: 50, errors: 25, error_rate: 0.5, mean_latency_ms: 10 });
    expect(result.api.recent_error_hours).toHaveLength(20);
    expect(Object.keys(result.api.recent_error_hours[0]).sort()).toEqual(['error_rate', 'errors', 'hour', 'requests']);
  });
});

describe('overview SQL request validation independent of HTTP', () => {
  it.each([
    [{ user_id: member }, 'invalid_input'], [{ screen: 'today' }, 'invalid_input'], [{ event: 'view' }, 'invalid_input'],
    [{ device: 'mobile' }, 'invalid_input'], [{ cursor: null }, 'invalid_input'], [{ include_admin: 'true' }, 'invalid_input'],
    [{ include_admin: null }, 'invalid_input'], [{ from: '2026-02-30' }, 'invalid_date_range'],
    [{ from: '2026-01-02', to: '2026-01-01' }, 'invalid_date_range'],
    [{ from: '2026-01-01', to: '2026-04-01' }, 'invalid_date_range'],
    [{ from: '2026-01-01 00:00:00' }, 'invalid_date_range'], [{ to: null }, 'invalid_date_range'],
    [{ data: 'x'.repeat(5000) }, 'invalid_input'],
  ])('rejects malformed or detail-only filters %#', async (payload, message) => {
    await expect(read(payload)).rejects.toMatchObject({ code: 'PT422', message });
  });

  it('allows at most 90 inclusive days and rejects missing flags, SQL null, and nonobjects', async () => {
    expect((await read({ from: '2026-01-01', to: '2026-03-31' })).summary.visitors).toBe(0);
    for (const payload of [null, 'null', '[]', '"text"', JSON.stringify(dates)]) {
      await expect(db.query('SELECT public.sb_admin_overview($1::jsonb)', [payload]))
        .rejects.toMatchObject({ code: 'PT422', message: 'invalid_input' });
    }
  });
});
