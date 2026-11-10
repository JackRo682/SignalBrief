// @vitest-environment node
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {beforeAll,beforeEach,afterAll,describe,it,expect} from 'vitest';
import {trafficSummary} from '../src/acquisition/contracts';
const sql=readFileSync(new URL('../../../supabase/migrations/20261110064509_launch_acquisition_analytics.sql',import.meta.url),'utf8');
const admin='10000000-0000-4000-8000-000000000001',member='10000000-0000-4000-8000-000000000002',session='20000000-0000-4000-8000-000000000001';
let db:PGlite,visitor:string;const secret='a'.repeat(64);
const call=async(p:Record<string,unknown>)=>(await db.query<{data:unknown}>('SELECT public.sb_traffic($1::jsonb) data',[JSON.stringify(p)])).rows[0].data;
async function role(user:string|null=null){await db.exec('RESET ROLE');await db.query("SELECT set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",[user??'',JSON.stringify(user?{session_id:session}:{})]);await db.exec('SET ROLE '+(user?'authenticated':'anon'));}
const event=(kind='page_view',extra:Record<string,unknown>={})=>({action:'record',visitor_id:visitor,secret,id:randomUUID(),kind,page:'home',source:'disquiet',...extra});
beforeAll(async()=>{db=new PGlite();await db.exec(`
 CREATE ROLE anon;CREATE ROLE authenticated;CREATE SCHEMA auth;CREATE SCHEMA app_private;
 CREATE TABLE auth.users(id uuid PRIMARY KEY,created_at timestamptz DEFAULT now(),email_confirmed_at timestamptz DEFAULT now(),deleted_at timestamptz,banned_until timestamptz);
 CREATE TABLE auth.sessions(id uuid PRIMARY KEY,user_id uuid,not_after timestamptz);
 CREATE TABLE public.users(id text PRIMARY KEY,onboarding_completed boolean DEFAULT false);
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$SELECT coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
 CREATE FUNCTION app_private.sb_is_admin() RETURNS boolean LANGUAGE sql STABLE AS $$SELECT auth.uid()='${admin}'::uuid$$;
 CREATE FUNCTION public.sb_require_mfa() RETURNS void LANGUAGE sql AS $$SELECT NULL::void$$;
 CREATE FUNCTION public.sb_rate_limit() RETURNS void LANGUAGE sql AS $$SELECT NULL::void$$;
 `);await db.exec(sql);},90000);
afterAll(async()=>{await db?.close();});
beforeEach(async()=>{await db.exec(`RESET ROLE;TRUNCATE app_private.traffic_events,app_private.traffic_visitors,auth.sessions,auth.users,public.users CASCADE;
 INSERT INTO auth.users(id) VALUES('${admin}'),('${member}');INSERT INTO public.users(id) VALUES('${member}');INSERT INTO auth.sessions VALUES('${session}','${member}',NULL);`);visitor=randomUUID();await role();});
describe('acquisition database boundaries',()=>{
 it('accepts bounded anonymous events and deduplicates retries',async()=>{const p=event();expect(await call(p)).toMatchObject({recorded:true});expect(await call(p)).toMatchObject({recorded:false});await db.exec('RESET ROLE');expect((await db.query('SELECT count(*)::int n FROM app_private.traffic_events')).rows[0]).toEqual({n:1});});
 it('never grants raw table access or private schema access to anonymous visitors',async()=>{await expect(db.query('SELECT * FROM app_private.traffic_events')).rejects.toMatchObject({code:'42501'});await db.exec('RESET ROLE');expect((await db.query("SELECT has_schema_privilege('anon','app_private','USAGE') AS access")).rows[0]).toEqual({access:false});});
 it('rejects anonymous and ordinary-member aggregate reads',async()=>{await expect(call({action:'summary',from:'2026-11-10',to:'2026-11-10'})).rejects.toMatchObject({code:'PT401'});await role(member);await expect(call({action:'summary',from:'2026-11-10',to:'2026-11-10'})).rejects.toMatchObject({code:'PT403'});});
 it('cannot forge verified conversions without a session',async()=>{await expect(call(event('signup_complete'))).rejects.toMatchObject({code:'PT401'});});
 it('verifies a newly created account and deduplicates completion across visitors',async()=>{await call(event('signup_start'));await role(member);expect(await call(event('signup_complete'))).toMatchObject({recorded:true});expect(await call(event('signup_complete'))).toMatchObject({recorded:false});expect(await call(event('onboarding_complete'))).toMatchObject({recorded:false});await db.exec('RESET ROLE');await db.exec(`UPDATE public.users SET onboarding_completed=true WHERE id='${member}'`);await role(member);expect(await call(event('onboarding_complete'))).toMatchObject({recorded:true});});
 it('does not count returning existing accounts as signups',async()=>{await call(event('signup_start'));await db.exec('RESET ROLE');await db.exec(`UPDATE auth.users SET created_at=now()-interval '30 days' WHERE id='${member}'`);await role(member);expect(await call(event('signup_complete'))).toMatchObject({recorded:false});});
 it('does not count completion without an attributed signup start',async()=>{await call(event());await role(member);expect(await call(event('signup_complete'))).toMatchObject({recorded:false});});
 it('rejects revoked or unconfirmed sessions',async()=>{await role(member);await db.exec('RESET ROLE;DELETE FROM auth.sessions');await role(member);await expect(call(event('signup_complete'))).rejects.toMatchObject({code:'PT401'});});
 it('requires the secret before appending or erasing another visitor',async()=>{await call(event());await expect(call(event('page_view',{secret:'b'.repeat(64)}))).rejects.toMatchObject({code:'PT403'});await call({action:'erase',visitor_id:visitor,secret:'b'.repeat(64)});await db.exec('RESET ROLE');expect((await db.query('SELECT count(*)::int n FROM app_private.traffic_events')).rows[0]).toEqual({n:1});});
 it('withdraws all linked events and blocks delayed replay without retaining the source',async()=>{await call(event());await call({action:'erase',visitor_id:visitor,secret});expect(await call(event())).toMatchObject({recorded:false});await db.exec('RESET ROLE');expect((await db.query('SELECT count(*)::int n FROM app_private.traffic_events')).rows[0]).toEqual({n:0});expect((await db.query('SELECT source,withdrawn_at IS NOT NULL AS withdrawn FROM app_private.traffic_visitors')).rows[0]).toEqual({source:null,withdrawn:true});});
 it('honors withdrawal arriving before the first delayed page view',async()=>{await call({action:'erase',visitor_id:visitor,secret});expect(await call(event())).toMatchObject({recorded:false});});
 it.each([{email:'private@example.invalid'},{page:'/search?q=private'},{kind:'signup_complete',user_id:member},{source:'evil.example/user@email.invalid'},{created_at:'2000-01-01'}])('rejects unknown or private fields %j',async extra=>{await expect(call(event('page_view',extra))).rejects.toMatchObject({code:'PT422'});});
 it('rate-limits writes per visitor without changing signup functionality',async()=>{for(let i=0;i<120;i++)await call(event());await expect(call(event())).rejects.toMatchObject({code:'PT429'});});
 it('returns real KST daily/source counts behind the admin boundary',async()=>{await call(event());await call(event('signup_start'));await role(member);await call(event('signup_complete'));await db.exec('RESET ROLE');await db.exec(`UPDATE auth.sessions SET user_id='${admin}'`);await role(admin);const day=(await db.query<{day:string}>("SELECT (now() AT TIME ZONE 'Asia/Seoul')::date::text AS day")).rows[0].day;const result=trafficSummary.parse(await call({action:'summary',from:day,to:day}));expect(result.totals).toMatchObject({visitors:1,pageviews:1,starts:1,signups:1});expect(result.sources[0].source).toBe('disquiet');expect(result.daily[0].day).toBe(day);});
 it('keeps authenticated administrator events out of acquisition metrics',async()=>{await db.exec('RESET ROLE');await db.exec(`UPDATE auth.sessions SET user_id='${admin}'`);await role(admin);expect(await call(event())).toMatchObject({recorded:false});});
});
