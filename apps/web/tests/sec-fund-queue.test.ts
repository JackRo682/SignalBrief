// @vitest-environment node
// Embedded PostgreSQL executes the exact migration; native role/concurrency
// regression coverage lives in tests/workspace/test_sec_fund_analysis.py.
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {afterEach,beforeEach,describe,expect,it} from 'vitest';

const migration=readFileSync(new URL('../../../supabase/migrations/20261104124412_sec_fund_report_analysis.sql',import.meta.url),'utf8');
const report='30000000-0000-4000-8000-000000000081',current='30000000-0000-4000-8000-000000000082';
let db:PGlite;
beforeEach(async()=>{
 db=new PGlite();
 await db.exec(`
 CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
 CREATE SCHEMA app_private; CREATE SCHEMA app_content_private;
 CREATE TABLE companies(id text PRIMARY KEY,name text,ticker text,provider text,provider_company_id text,is_demo boolean,last_ingested_at timestamptz);
 CREATE TABLE watchlist_items(company_id text); CREATE TABLE positions(company_id text);
 CREATE TABLE app_private.company_analysis_requests(company_id text PRIMARY KEY,requested_at timestamptz DEFAULT now(),completed_at timestamptz);
 CREATE TABLE us_filings(id uuid PRIMARY KEY,company_id text,form text,filing_date date);
 CREATE TABLE us_analyses(filing_id uuid PRIMARY KEY,status text);
 CREATE TABLE app_private.us_analysis_locks(filing_id uuid PRIMARY KEY,lease uuid,expires_at timestamptz);
 CREATE TABLE app_private.us_config(key text PRIMARY KEY,value jsonb);
 CREATE TABLE app_private.us_usage(day date,provider text,calls integer,reserved_usd numeric,PRIMARY KEY(day,provider));
 INSERT INTO app_private.us_config VALUES ('ai_daily_budget_usd','1');
 CREATE TABLE app_private.collector_analysis_attempts(filing_id uuid PRIMARY KEY,attempted_at timestamptz DEFAULT now(),status text DEFAULT 'running',code text,attempt_count integer DEFAULT 1);
 INSERT INTO companies VALUES ('fund','Synthetic fund','FUND','sec','0000000081',false,now()-interval '90 days');
 INSERT INTO app_private.company_analysis_requests(company_id) VALUES ('fund');
 INSERT INTO us_filings VALUES ('${report}','fund','N-CSRS',current_date-130),('${current}','fund','8-K',current_date);
 `);
 await db.exec(migration);
});
afterEach(async()=>{await db.close();});
async function pick(){return (await db.query<{id:string|null}>('select public.sb_collector_analysis_pick() id')).rows[0].id;}
async function candidates(){return (await db.query<{items:Array<{id:string;provider:string}>}>('select app_content_private.collection_candidates() items')).rows[0].items;}
describe('fund report queue migration',()=>{
 it('waits for actual requested metadata refresh and then selects the older report before a current 8-K',async()=>{
  expect(await pick()).toBeNull();
  expect((await candidates())[0].id).toBe('fund');
  await db.exec("update companies set last_ingested_at=clock_timestamp() where id='fund'");
  expect(await pick()).toBe(report);
  expect((await db.query('select * from us_analyses')).rows).toHaveLength(0);
 });
 it.each(['N-CSR','N-CSR/A','N-CSRS/A'])('gives %s the same report priority',async form=>{
  await db.query('update us_filings set form=$1 where id=$2',[form,report]);
  await db.exec("update companies set last_ingested_at=clock_timestamp() where id='fund'");
  expect(await pick()).toBe(report);
 });
 it('expires failed-request collection priority and preserves watched issuer ordering',async()=>{
  await db.exec("insert into companies values ('watched','Synthetic watched','WATCH','sec','0000000082',false,now()-interval '3 hours'); insert into watchlist_items values ('watched')");
  expect((await candidates())[0].id).toBe('fund');
  await db.exec("update app_private.company_analysis_requests set requested_at=now()-interval '16 minutes' where company_id='fund'");
  expect((await candidates())[0].id).toBe('watched');
  expect(await pick()).toBeNull();
 });
 it('does not give DART a new request priority or expose private ordering fields',async()=>{
  await db.exec("insert into companies values ('dart-watched','Synthetic DART','000083','dart','00000083',false,now()-interval '3 hours'),('dart-other','Synthetic DART other','000084','dart','00000084',false,now()-interval '90 days'); insert into watchlist_items values ('dart-watched'); insert into app_private.company_analysis_requests(company_id) values ('dart-other')");
  const rows=await candidates();expect(rows).toHaveLength(2);
  expect(rows.find(row=>row.provider==='dart')?.id).toBe('dart-watched');
  expect(JSON.stringify(rows)).not.toContain('analysis_requested_at');
 });
 it('keeps transient retry limits and semantic rejection unchanged',async()=>{
  await db.exec(`update companies set last_ingested_at=clock_timestamp(); delete from us_filings where id='${current}'`);
  expect(await pick()).toBe(report);
  expect(await pick()).toBeNull();
  await db.exec("update app_private.collector_analysis_attempts set status='blocked',code='numeric_citation_mismatch',attempted_at=now()-interval '16 minutes'");
  expect(await pick()).toBeNull();
  await db.exec("update app_private.collector_analysis_attempts set code='request_timeout',attempt_count=2");
  expect(await pick()).toBe(report);
  await db.exec("update app_private.collector_analysis_attempts set status='blocked',code='request_timeout',attempted_at=now()-interval '16 minutes'");
  expect(await pick()).toBeNull();
 });
 it('leaves an exhausted-day request pending without attempts or leases and resumes on the next quota day',async()=>{
  await db.exec("update companies set last_ingested_at=clock_timestamp(); insert into app_private.us_usage values (current_date,'openai',20,0.135)");
  const request=(await db.query('select * from app_private.company_analysis_requests')).rows;
  expect(await pick()).toBeNull();
  expect((await db.query('select * from app_private.collector_analysis_attempts')).rows).toHaveLength(0);
  expect((await db.query('select * from app_private.us_analysis_locks')).rows).toHaveLength(0);
  expect((await db.query('select * from app_private.company_analysis_requests')).rows).toEqual(request);
  expect((await db.query('select calls,reserved_usd::text from app_private.us_usage')).rows).toEqual([{calls:20,reserved_usd:'0.135'}]);
  // Model a later quota day using historical synthetic usage, retaining its counts.
  await db.exec("update app_private.us_usage set day=current_date-1 where provider='openai'");
  expect(await pick()).toBe(report);
  expect((await db.query('select attempt_count from app_private.collector_analysis_attempts')).rows).toEqual([{attempt_count:1}]);
  expect((await db.query('select calls,reserved_usd::text from app_private.us_usage')).rows).toEqual([{calls:20,reserved_usd:'0.135'}]);
  expect((await db.query('select * from us_analyses')).rows).toHaveLength(0);
 });
 it.each(['missing','disabled','spent'])('does not claim a request with %s model budget',async kind=>{
  await db.exec("update companies set last_ingested_at=clock_timestamp()");
  if(kind==='missing')await db.exec("delete from app_private.us_config where key='ai_daily_budget_usd'");
  if(kind==='disabled')await db.exec("update app_private.us_config set value='0' where key='ai_daily_budget_usd'");
  if(kind==='spent')await db.exec("insert into app_private.us_usage values (current_date,'openai',10,1)");
  expect(await pick()).toBeNull();
  expect((await db.query('select * from app_private.collector_analysis_attempts')).rows).toHaveLength(0);
 });
 it('keeps client execution privileges revoked',async()=>{
  for(const role of ['anon','authenticated']){
   const rows=await db.query<{allowed:boolean}>('select has_function_privilege($1,\'public.sb_collector_analysis_pick()\',\'EXECUTE\') allowed',[role]);
   expect(rows.rows[0].allowed).toBe(false);
  }
 });
});
