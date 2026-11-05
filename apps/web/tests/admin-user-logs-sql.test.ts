// @vitest-environment node
// Execute the actual migration and its existing guard helpers in embedded PostgreSQL.
// These synthetic fixtures never connect to Supabase or any external database.
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { userLogsResponseSchema, type UserLogsRequest } from '../src/admin-logs/contracts';

const migration = 'migrations/20261105020506_admin_user_activity_logs.sql';
const sql = (file: string) => readFileSync(new URL(`../../../supabase/${file}`, import.meta.url), 'utf8');
const admin = '10000000-0000-4000-8000-000000000001';
const member = '10000000-0000-4000-8000-000000000002';
const declined = '10000000-0000-4000-8000-000000000003';
const other = '10000000-0000-4000-8000-000000000004';
const adminSession = '20000000-0000-4000-8000-000000000001';
const memberSession = '20000000-0000-4000-8000-000000000002';
const pageId = '30000000-0000-4000-8000-000000000001';
let db: PGlite;
let dates: { from: string; to: string };

const read = async (overrides: Record<string, unknown> = {}) => {
  const p: UserLogsRequest = { ...dates, user_id: '', event: '', screen: '', device: '', include_admin: false, cursor: null };
  const { rows } = await db.query<{ data: unknown }>('SELECT public.sb_admin_user_logs($1::jsonb) AS data', [JSON.stringify({ ...p, ...overrides })]);
  return userLogsResponseSchema.parse(rows[0].data);
};
async function identity(user: string | null = admin, session: string | null = adminSession, aal = 'aal1') {
  await db.exec('RESET ROLE');
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",
    [user ?? '', JSON.stringify({ ...(user ? { sub: user } : {}), ...(session ? { session_id: session } : {}), aal })]);
  await db.exec('SET ROLE authenticated');
}
async function usage(user = member, overrides: Record<string, unknown> = {}) {
  const values = { id: randomUUID(), session: memberSession, page: pageId, screen: 'today', device: 'desktop', event: 'view', ms: 0,
    at: new Date(Date.now() - 60_000).toISOString(), ...overrides };
  await db.exec('RESET ROLE');
  await db.query(`INSERT INTO app_private.research_events(id,user_id,session_id,page_id,screen,device,kind,active_ms,created_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [values.id, user, values.session, values.page, values.screen, values.device, values.event, values.ms, values.at]);
  return `usage:${values.id}`;
}
async function product(user = member, overrides: Record<string, unknown> = {}) {
  const values = { id: randomUUID(), event: 'brief_opened', properties: { screen: 'event_detail' }, at: new Date(Date.now() - 60_000).toISOString(), ...overrides };
  await db.exec('RESET ROLE');
  await db.query('INSERT INTO public.user_events(id,user_id,event_name,properties,created_at) VALUES($1,$2,$3,$4::json,$5)',
    [values.id, user, values.event, JSON.stringify(values.properties), values.at]);
  return `product:${values.id}`;
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
    CREATE TABLE public.users(id varchar PRIMARY KEY,analytics_consent boolean NOT NULL DEFAULT false);
    CREATE TABLE public.user_events(id varchar PRIMARY KEY,user_id varchar REFERENCES public.users,event_name varchar NOT NULL,properties json NOT NULL,created_at timestamptz NOT NULL);
    CREATE TABLE public.rate_buckets(key text PRIMARY KEY,hits integer NOT NULL,expires_at timestamptz NOT NULL);
    CREATE TABLE app_private.sb_admin_users(user_id text PRIMARY KEY);
    GRANT USAGE ON SCHEMA auth,app_private TO authenticated;
    ALTER TABLE public.user_events ENABLE ROW LEVEL SECURITY;
    GRANT SELECT ON public.user_events TO authenticated;
    CREATE POLICY owner_select ON public.user_events TO authenticated USING(user_id=(SELECT auth.uid())::text);
  `);
  const hosted = sql('hosted/20261003003202_signalbrief_web_rls_and_profiles.sql');
  for (const name of ['app_private.sb_is_admin', 'public.sb_rate_limit']) {
    const definition = hosted.match(new RegExp(`CREATE FUNCTION ${name.replaceAll('.', '\\.')}\\(\\)[\\s\\S]*?\\$\\$;`))?.[0];
    if (!definition) throw new Error(`Missing actual helper: ${name}`);
    await db.exec(definition);
  }
  // Replay the actual MFA helpers, without the unrelated Storage/table policies.
  await db.exec(sql('workspace-migrations/20261005094000_workspace_mfa.sql').split('DO $$ DECLARE previous')[0]);
  const research = sql('research-migrations/20261010114340_research_admin.sql');
  for (const name of ['research_events', 'research_audit']) {
    const definition = research.match(new RegExp(`CREATE TABLE app_private\\.${name} \\([\\s\\S]*?\\n\\);`))?.[0];
    if (!definition) throw new Error(`Missing actual table: ${name}`);
    await db.exec(definition);
    await db.exec(`ALTER TABLE app_private.${name} ENABLE ROW LEVEL SECURITY; REVOKE ALL ON app_private.${name} FROM PUBLIC,anon,authenticated;`);
  }
  await db.exec(sql(migration));
}, 90_000);

beforeEach(async () => {
  await db.exec(`RESET ROLE;
    TRUNCATE public.user_events,app_private.research_events,app_private.research_audit,auth.sessions,auth.mfa_factors,
      auth.users,public.users,app_private.sb_admin_users,public.rate_buckets CASCADE;
    INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
      ('${admin}','administrator@example.invalid',now()),('${member}','member@example.invalid',now()),
      ('${declined}','declined@example.invalid',now()),('${other}','other@example.invalid',now());
    INSERT INTO public.users VALUES('${admin}',false),('${member}',true),('${declined}',false),('${other}',true);
    INSERT INTO auth.sessions VALUES('${adminSession}','${admin}',NULL),('${memberSession}','${member}',NULL);
    INSERT INTO app_private.sb_admin_users VALUES('${admin}');
  `);
  dates = (await db.query<{ from: string; to: string }>(`SELECT to_char((now() AT TIME ZONE 'Asia/Seoul')::date-6,'YYYY-MM-DD') AS "from",
    to_char(now() AT TIME ZONE 'Asia/Seoul','YYYY-MM-DD') AS "to"`)).rows[0];
  await identity();
});
afterAll(async () => { await db?.close(); });

describe('administrator activity SQL access boundary', () => {
  it('uses a private definer and public invoker with locked search paths and no raw browser table access', async () => {
    await db.exec('RESET ROLE');
    const functions = (await db.query<{ nspname: string; prosecdef: boolean; proconfig: string[] }>(`SELECT n.nspname,p.prosecdef,p.proconfig
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE p.proname='sb_admin_user_logs' ORDER BY n.nspname`)).rows;
    expect(functions).toEqual([
      { nspname: 'app_private', prosecdef: true, proconfig: ['search_path=""'] },
      { nspname: 'public', prosecdef: false, proconfig: ['search_path=""'] },
    ]);
    const grants = (await db.query<{ anon: boolean; authenticated: boolean; raw: boolean }>(`SELECT
      has_function_privilege('anon','public.sb_admin_user_logs(jsonb)','EXECUTE') AS anon,
      has_function_privilege('authenticated','public.sb_admin_user_logs(jsonb)','EXECUTE') AS authenticated,
      has_table_privilege('authenticated','public.user_events','SELECT') AS raw`)).rows[0];
    expect(grants).toEqual({ anon: false, authenticated: true, raw: false });
    await db.exec('SET ROLE anon');
    await expect(read()).rejects.toMatchObject({ code: '42501' });
    await identity();
    await expect(db.query('SELECT * FROM public.user_events')).rejects.toMatchObject({ code: '42501' });
    await expect(db.query('SELECT * FROM app_private.research_events')).rejects.toMatchObject({ code: '42501' });
  });

  it('denies anonymous identities, ordinary users, and direct private-function bypasses', async () => {
    await identity(null, null);
    await expect(read()).rejects.toMatchObject({ code: 'PT401', message: 'authentication_required' });
    await identity(member, memberSession);
    await expect(read()).rejects.toMatchObject({ code: 'PT403', message: 'admin_required' });
    await expect(db.query('SELECT app_private.sb_admin_user_logs($1)', [JSON.stringify(dates)]))
      .rejects.toMatchObject({ code: 'PT403', message: 'admin_required' });
    await db.exec('RESET ROLE');
    expect((await db.query<{ n: number }>('SELECT count(*)::integer AS n FROM app_private.sb_admin_users')).rows[0].n).toBe(1);
  });

  it.each([
    ['deleted_at=now()', 'PT401', 'invalid_or_expired_session'],
    ["banned_until=now()+interval '1 day'", 'PT401', 'invalid_or_expired_session'],
    ['email_confirmed_at=NULL', 'PT403', 'verified_account_required'],
  ])('blocks unavailable account state %s', async (change, code, message) => {
    await db.exec('RESET ROLE');
    await db.exec(`UPDATE auth.users SET ${change} WHERE id='${admin}'`);
    await identity();
    await expect(read()).rejects.toMatchObject({ code, message });
  });

  it.each([null, 'invalid-id', memberSession, '20000000-0000-4000-8000-000000000099'])('rejects missing, malformed, unrelated, and revoked sessions: %s', async (session) => {
    await identity(admin, session);
    await expect(read()).rejects.toMatchObject({ code: 'PT401', message: 'session_revoked' });
  });

  it('requires an unexpired live session and current allowlist membership', async () => {
    await db.exec(`RESET ROLE; UPDATE auth.sessions SET not_after=now()-interval '1 second' WHERE id='${adminSession}'`);
    await identity();
    await expect(read()).rejects.toMatchObject({ code: 'PT401', message: 'session_revoked' });
    await db.exec(`RESET ROLE; UPDATE auth.sessions SET not_after=now()+interval '1 hour' WHERE id='${adminSession}'; DELETE FROM app_private.sb_admin_users;`);
    await identity();
    await expect(read()).rejects.toMatchObject({ code: 'PT403', message: 'admin_required' });
  });

  it('uses the actual MFA helper and existing request budget', async () => {
    await db.exec(`RESET ROLE; INSERT INTO auth.mfa_factors VALUES(gen_random_uuid(),'${admin}','verified');`);
    await identity();
    await expect(read()).rejects.toMatchObject({ code: 'PT403', message: 'mfa_required' });
    await identity(admin, adminSession, 'aal2');
    expect((await read()).items).toEqual([]);
    await db.exec(`RESET ROLE; UPDATE public.rate_buckets SET hits=120;`);
    await identity(admin, adminSession, 'aal2');
    await expect(read()).rejects.toMatchObject({ code: 'PT429', message: 'rate_limit_exceeded' });
  });
});

describe('consented activity projection and pagination', () => {
  it('joins both sources, omits opted-out and admin activity by default, and returns only the allowlisted projection', async () => {
    const usageId = await usage(member, { event: 'heartbeat', ms: 3000 });
    const productId = await product(member, { properties: { screen: 'event_detail', email: 'secret@example.invalid', question: 'Private question', session_id: memberSession } });
    const unknownScreen = await product(other, { event: 'login', properties: { screen: 'Private search terms' } });
    await usage(declined);
    await product(declined);
    await db.exec(`UPDATE public.users SET analytics_consent=true WHERE id='${admin}'`);
    await usage(admin);
    await product(member, { event: 'unapproved_secret_event' });
    await product(member, { id: 'unsafe/email@example.invalid' });
    await identity();
    const result = await read();
    expect(result.items.map(item => item.id).sort()).toEqual([usageId, productId, unknownScreen].sort());
    expect(result.summary).toEqual({ events: 3, users: 2, sessions: 1, active_ms: 3000 });
    expect(result.consented_users).toBe(3);
    expect(result.items.find(item => item.id === productId)).toMatchObject({ screen: 'event', source: 'product', device: null, session_id: null, page_id: null, active_ms: null });
    expect(result.items.find(item => item.id === unknownScreen)?.screen).toBeNull();
    expect(JSON.stringify(result)).not.toMatch(/secret@example|Private question|Private search|properties|email|question/);
    expect((await read({ include_admin: true })).summary.events).toBe(4);
    await db.exec('RESET ROLE');
    const audit = (await db.query<{ action: string; detail: Record<string, unknown> }>('SELECT action,detail FROM app_private.research_audit')).rows;
    expect(audit).toHaveLength(2);
    expect(audit[0].action).toBe('user_logs_read');
    expect(Object.keys(audit[0].detail).sort()).toEqual(['from', 'include_admin', 'returned', 'to']);
    expect((await db.query<{ consent: boolean }>('SELECT analytics_consent AS consent FROM public.users WHERE id=$1', [declined])).rows[0].consent).toBe(false);
  });

  it('filters users, events, normalized screens and real device observations without inventing product sessions', async () => {
    await usage(member, { screen: 'watchlist', device: 'mobile', event: 'click' });
    await usage(other, { screen: 'event', device: 'desktop', event: 'view' });
    await product(member);
    await identity();
    expect((await read({ user_id: member })).summary.events).toBe(2);
    expect((await read({ event: 'click' })).summary.events).toBe(1);
    expect((await read({ screen: 'event' })).summary).toEqual({ events: 2, users: 2, sessions: 1, active_ms: 0 });
    expect((await read({ screen: 'watchlist', device: 'mobile', user_id: member })).items).toHaveLength(1);
    expect((await read({ device: 'desktop' })).items).toHaveLength(1);
    const noMatch = await read({ user_id: '10000000-0000-4000-8000-000000000099' });
    expect(noMatch.summary.events).toBe(0);
    expect(noMatch.consented_users).toBe(2);
    await db.exec(`RESET ROLE; UPDATE public.users SET analytics_consent=false WHERE id='${member}';`);
    await identity();
    expect((await read()).items.every(item => item.user_id !== member)).toBe(true);
    expect((await read({ include_admin: true })).items.every(item => item.user_id !== admin)).toBe(true);
  });

  it('uses inclusive KST date boundaries and a hard 90-day visibility ceiling', async () => {
    await db.exec('RESET ROLE');
    const bounds = (await db.query<{ day: string; start: string; end: string; before: string; late: string }>(`WITH d AS (
      SELECT (now() AT TIME ZONE 'Asia/Seoul')::date-2 AS day
    ) SELECT day::text AS day, (day::timestamp AT TIME ZONE 'Asia/Seoul')::text AS start,
      ((day+1)::timestamp AT TIME ZONE 'Asia/Seoul')::text AS end,
      ((day::timestamp AT TIME ZONE 'Asia/Seoul')-interval '1 microsecond')::text AS before,
      (((day+1)::timestamp AT TIME ZONE 'Asia/Seoul')-interval '1 microsecond')::text AS late FROM d`)).rows[0];
    const first = await usage(member, { at: bounds.start });
    const last = await product(member, { at: bounds.late });
    await usage(member, { at: bounds.before });
    await product(member, { at: bounds.end });
    await identity();
    expect((await read({ from: bounds.day, to: bounds.day })).items.map(item => item.id).sort()).toEqual([first, last].sort());
    await db.exec('RESET ROLE');
    const old = (await db.query<{ day: string; stamp: string }>(`SELECT (now()-interval '91 days')::date::text AS day,(now()-interval '91 days')::text AS stamp`)).rows[0];
    await usage(member, { at: old.stamp });
    await identity();
    expect((await read({ from: old.day, to: old.day })).summary.events).toBe(0);
  });

  it('uses 50-row stable keyset pages across equal timestamps and source IDs while preserving full-range totals', async () => {
    const at = new Date(Date.now() - 120_000).toISOString();
    const ids: string[] = [];
    for (let i = 1; i <= 51; i++) {
      ids.push(await usage(member, { id: `40000000-0000-4000-8000-${String(i).padStart(12, '0')}`, at, event: 'heartbeat', ms: 1000 }));
    }
    ids.push(await product(member, { id: '40000000-0000-4000-8000-000000000051', at }));
    await identity();
    const first = await read();
    expect(first.items).toHaveLength(50);
    expect(first.has_more).toBe(true);
    expect(first.next_cursor?.id).toBe(first.items[49].id);
    expect(first.summary).toEqual({ events: 52, users: 1, sessions: 1, active_ms: 51_000 });
    const second = await read({ cursor: first.next_cursor });
    expect(second.items).toHaveLength(2);
    expect(second.next_cursor).toBeNull();
    expect(second.summary).toEqual(first.summary);
    expect(new Set([...first.items, ...second.items].map(item => item.id)).size).toBe(52);
    expect([...first.items, ...second.items].map(item => item.id)).toEqual(ids.sort().reverse());
  });
});

describe('SQL input bounds independent of the HTTP validator', () => {
  it.each([
    [{ unknown: true }, 'invalid_input'],
    [{ from: '2026-02-30' }, 'invalid_date_range'],
    [{ from: '2026-01-01', to: '2026-04-01' }, 'invalid_date_range'],
    [{ from: '2026-01-02', to: '2026-01-01' }, 'invalid_date_range'],
    [{ from: '2026-01-01 00:00:00' }, 'invalid_date_range'],
    [{ user_id: 'not-a-uuid' }, 'invalid_filter'],
    [{ user_id: null }, 'invalid_filter'],
    [{ event: 'raw_error' }, 'invalid_filter'],
    [{ screen: 'event_detail' }, 'invalid_filter'],
    [{ device: 'unknown' }, 'invalid_filter'],
    [{ include_admin: 'true' }, 'invalid_filter'],
    [{ cursor: {} }, 'invalid_cursor'],
    [{ cursor: { created_at: 'infinity', id: 'usage:valid' } }, 'invalid_cursor'],
    [{ cursor: { created_at: '2026-11-01T00:00:00', id: 'usage:valid' } }, 'invalid_cursor'],
    [{ cursor: { created_at: '2026-11-01T00:00:00Z', id: 'usage:unsafe/path' } }, 'invalid_cursor'],
    [{ cursor: { created_at: '2026-11-01T00:00:00Z', id: 'usage:valid', extra: 1 } }, 'invalid_cursor'],
    [{ event: 'x'.repeat(5000) }, 'invalid_input'],
  ])('rejects malformed payload %#', async (payload, message) => {
    await expect(read(payload)).rejects.toMatchObject({ code: 'PT422', message });
  });

  it('accepts an inclusive 90-day range and minimal safe defaults, but rejects nonobjects', async () => {
    expect((await read({ from: '2026-01-01', to: '2026-03-31' })).items).toEqual([]);
    const minimal = (await db.query<{ data: unknown }>('SELECT public.sb_admin_user_logs($1::jsonb) AS data', [JSON.stringify(dates)])).rows[0].data;
    expect(userLogsResponseSchema.parse(minimal).items).toEqual([]);
    for (const payload of ['null', '[]', '"text"']) {
      await expect(db.query('SELECT public.sb_admin_user_logs($1::jsonb)', [payload])).rejects.toMatchObject({ code: 'PT422', message: 'invalid_input' });
    }
  });
});
