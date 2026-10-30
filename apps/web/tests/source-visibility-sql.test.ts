// @vitest-environment node
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {it,expect} from 'vitest';
import {sourceOverviewSchema,catalogSchema} from '../src/workspace/contracts';
import {companiesSchema} from '../src/lib/contracts';
const sql=(file:string)=>readFileSync(new URL(`../../../supabase/${file}`,import.meta.url),'utf8');
it('executes source visibility, bilingual full-text search and denial paths in disposable PostgreSQL',async()=>{
 const db=new PGlite();
 try{
  await db.exec(`
   CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth; CREATE SCHEMA app_private;
   CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT nullif(current_setting('test.uid',true),'')::uuid$$;
   CREATE TABLE auth.users(id uuid); CREATE TABLE users(id text);
   CREATE FUNCTION sb_require_mfa() RETURNS void LANGUAGE plpgsql AS $$BEGIN IF current_setting('test.mfa',true)='deny' THEN RAISE EXCEPTION 'mfa_required';END IF;END$$;
   CREATE FUNCTION sb_rate_limit() RETURNS void LANGUAGE plpgsql AS $$BEGIN END$$;
   CREATE TABLE workspace_preferences(user_id text,value jsonb,version int); CREATE TABLE workspace_tickets(id uuid);
   CREATE TABLE companies(id text,name text,ticker text,market text,provider text,is_demo boolean,last_ingested_at timestamptz);
   CREATE TABLE workspace_saved(user_id text,kind text,resource_id text);
   CREATE TABLE documents(id text,company_id text,title text,source_url text,published_at timestamptz,publication_date date,publication_precision text,form_type text,is_demo boolean);
   CREATE TABLE events(id text,company_id text,document_id text,published_at timestamptz,event_type text,state text);
   CREATE TABLE briefs(event_id text,headline text,what_happened text);
   CREATE TABLE document_chunks(id text,document_id text,text text);
   CREATE TABLE us_filings(id uuid,company_id text,form text,accession text,document_url text,filing_date date);
   CREATE TABLE dart_filings(id uuid,company_id text,title text,receipt text,source_url text,filing_date date,publication_precision text);
   CREATE TABLE watchlists(id text,user_id text); CREATE TABLE watchlist_items(watchlist_id text,company_id text);
   CREATE TABLE portfolios(id text,user_id text); CREATE TABLE positions(portfolio_id text,company_id text);
   CREATE TABLE calendar_items(id text,user_id text,company_id text,title text,occurs_on date,origin text,calendar_status text,source_url text,source_timezone text,verified_at timestamptz);
   CREATE FUNCTION app_private.sb_event_visible(eid text) RETURNS boolean LANGUAGE sql AS $$SELECT EXISTS(SELECT 1 FROM public.events WHERE id=eid AND state='published')$$;
   CREATE FUNCTION app_private.sb_document_visible(did text) RETURNS boolean LANGUAGE sql AS $$SELECT EXISTS(SELECT 1 FROM public.events WHERE document_id=did AND state='published')$$;
   INSERT INTO auth.users VALUES('10000000-0000-4000-8000-000000000001'),('10000000-0000-4000-8000-000000000002');
   INSERT INTO users SELECT id::text FROM auth.users;
   INSERT INTO companies VALUES('kr','삼성전자','005930','KRX','dart',false,now()),('us','Apple','AAPL','NASDAQ','sec',false,now()),('demo','Demo','DEMO','KRX','dart',true,now());
   INSERT INTO watchlists VALUES('a','10000000-0000-4000-8000-000000000001'),('b','10000000-0000-4000-8000-000000000002');
   INSERT INTO watchlist_items VALUES('a','kr'),('b','us');
   INSERT INTO documents VALUES('published','kr','Original disclosure','https://dart.fss.or.kr/',now(),'2026-10-01','date','report',false),('draft','kr','Private analysis','https://dart.fss.or.kr/',now(),'2026-10-01','date','report',false);
   INSERT INTO events VALUES('published-event','kr','published','2020-01-01','earnings','published'),('pending-event','kr','draft',now(),'earnings','needs_review');
   INSERT INTO briefs VALUES('published-event','Historical reviewed analysis','Verified original'),('pending-event','Secret draft finding','Never disclose');
   INSERT INTO document_chunks VALUES('good','published','Battery revenue source text.'),('hidden','draft','SecretKeyword unsupported draft.');
   INSERT INTO dart_filings VALUES('40000000-0000-4000-8000-000000000001','kr','Collected official metadata','20261019000001','https://dart.fss.or.kr/dsaf001/main.do?rcpNo=20261019000001','2026-10-19','date');
   INSERT INTO calendar_items VALUES('old',null,'kr','Historical official event','2020-01-01','official','confirmed','https://example.com/ir','Asia/Seoul',now()),('future',null,'kr','Future official event','2100-01-01','official','confirmed','https://example.com/ir','Asia/Seoul',now()),('private','10000000-0000-4000-8000-000000000002','kr','Other user private date',current_date,'official','confirmed','https://example.com/ir','Asia/Seoul',now()),('unverified',null,'kr','Unverified date',current_date,'official','confirmed','https://example.com/ir','Asia/Seoul',null);
  `);
  // The real resource projection, including SEC/DART URL validation and publication predicates.
  await db.exec(sql('workspace-migrations/20261019071121_company_detail_connections.sql').split('CREATE OR REPLACE FUNCTION app_mobile_private.document_detail')[0]);
  await db.exec(sql('workspace-migrations/20261030120000_source_visibility.sql'));
  async function call(action:'source_overview',p?:unknown):Promise<ReturnType<typeof sourceOverviewSchema.parse>>;
  async function call(action:'company_lookup',p?:unknown):Promise<ReturnType<typeof companiesSchema.parse>>;
  async function call(action:'catalog',p?:unknown):Promise<ReturnType<typeof catalogSchema.parse>>;
  async function call(action:string,p:unknown={}){
   const data=(await db.query<{data:unknown}>('select sb_workspace($1,$2::jsonb) data',[action,JSON.stringify(p)])).rows[0].data;
   return (action==='source_overview'?sourceOverviewSchema:action==='company_lookup'?companiesSchema:catalogSchema).parse(data);
  }
  await expect(call('source_overview')).rejects.toThrow('authentication_required');
  await db.exec(`SET test.uid='10000000-0000-4000-8000-000000000001';`);
  const overview=await call('source_overview');
  expect(overview).toMatchObject({companies:1,filing_count:1,published_count:1});
  expect(overview.historical_events[0].id).toBe('published-event');
  expect(overview.calendar.map(x=>x.id)).toEqual(['future','old']);
  expect(JSON.stringify(overview)).not.toMatch(/Secret|Private|Other user|Unverified/);
  await expect(call('source_overview',{id:'us'})).rejects.toThrow('invalid_input');
  expect((await call('company_lookup',{q:'삼전'})).map(x=>x.id)).toEqual(['kr']);
  expect((await call('company_lookup',{})).length).toBe(2);
  await expect(call('company_lookup',{limit:101})).rejects.toThrow('invalid_filter');
  expect((await call('catalog',{q:'삼전',kind:'company'})).items.map(x=>x.id)).toEqual(['kr']);
  expect((await call('catalog',{q:'2차전지',kind:'document'})).items.map(x=>x.id)).toEqual(['published']);
  expect((await call('catalog',{q:'SecretKeyword'})).total).toBe(0);
  expect((await call('catalog',{})).markets).toEqual(expect.arrayContaining(['KRX','NASDAQ']));
  await db.exec(`SET test.uid='10000000-0000-4000-8000-000000000002';`);
  expect((await call('source_overview')).filings).toEqual([]);
  await db.exec(`SET test.mfa='deny';`);await expect(call('source_overview')).rejects.toThrow('mfa_required');
  await db.exec(`GRANT USAGE ON SCHEMA app_private TO anon;SET ROLE anon;`);
  await expect(db.query("select app_private.sb_search_terms('삼전')")).rejects.toThrow('permission denied');
  await db.exec('RESET ROLE;');
  await db.exec(sql('workspace-rollbacks/20261030120000_source_visibility.sql'));
  await db.exec(`SET test.mfa='';`);await expect(call('source_overview')).rejects.toThrow('unsupported_action');
 }finally{await db.close();}
},30000);
