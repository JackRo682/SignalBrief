// @vitest-environment node
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {describe,it,expect} from 'vitest';

// Disposable PostgreSQL. These synthetic rows never touch a hosted project.
describe('company detail SQL authorization and provider projection',()=>{
 it('includes DART filings and approved Korean content, preserves SEC, and hides pending evidence',async()=>{
  const db=new PGlite();
  try{
   await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated;
    CREATE SCHEMA auth; CREATE SCHEMA app_private; CREATE SCHEMA app_mobile_private;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('test.uid',true),'')::uuid $$;
    CREATE TABLE auth.users(id uuid);
    INSERT INTO auth.users VALUES('10000000-0000-4000-8000-000000000001');
    CREATE FUNCTION public.sb_require_mfa() RETURNS void LANGUAGE plpgsql AS $$BEGIN END$$;
    CREATE FUNCTION public.sb_rate_limit() RETURNS void LANGUAGE plpgsql AS $$BEGIN END$$;
    CREATE TABLE companies(id text,name text,ticker text,market text,provider text,is_demo boolean,last_ingested_at timestamptz);
    CREATE TABLE workspace_saved(user_id text,kind text,resource_id text);
    CREATE TABLE documents(id text,company_id text,provider text,title text,source_url text,published_at timestamptz,publication_date date,publication_precision text,form_type text,is_demo boolean,publication_timezone text,ingested_at timestamptz,raw_sha256 text);
    CREATE TABLE events(id text,company_id text,document_id text,published_at timestamptz,event_type text,state text);
    CREATE TABLE briefs(event_id text,headline text,what_happened text);
    CREATE TABLE facts(id text,chunk_id text,field text,value_raw text,unit text,period text,basis text,quote text,event_id text);
    CREATE TABLE changes(event_id text,previous_fact_id text);
    CREATE TABLE document_chunks(id text,document_id text,location text,text text,ordinal integer);
    CREATE TABLE raw_blobs(sha256 text,content_type text,byte_length integer);
    CREATE TABLE us_filings(id uuid,company_id text,form text,accession text,document_url text,filing_date date,fetched_at timestamptz,source_sha256 text);
    CREATE TABLE dart_filings(id uuid,company_id text,title text,receipt text,source_url text,filing_date date,publication_precision text,publication_timezone text,fetched_at timestamptz,source_sha256 text);
    CREATE FUNCTION app_private.sb_event_visible(eid text) RETURNS boolean LANGUAGE sql AS $$SELECT EXISTS(SELECT 1 FROM public.events WHERE id=eid AND state='published')$$;
    CREATE FUNCTION app_private.sb_document_visible(did text) RETURNS boolean LANGUAGE sql AS $$SELECT EXISTS(SELECT 1 FROM public.events WHERE document_id=did AND state='published')$$;
    CREATE FUNCTION app_private.sb_fact_visible(fid text) RETURNS boolean LANGUAGE sql AS $$SELECT EXISTS(SELECT 1 FROM public.facts f JOIN public.events e ON e.id=f.event_id WHERE f.id=fid AND e.state='published')$$;
    INSERT INTO companies VALUES('kr','Synthetic KR','123456','KRX','dart',false,now()),('us','Synthetic US','TEST','NASDAQ','sec',false,now()),('demo','Synthetic demo','654321','KRX','dart',true,now());
    INSERT INTO documents(id,company_id,provider,title,is_demo,publication_precision,form_type) VALUES('approved-kr','kr','dart','Published KR',false,'date','report'),('pending-kr','kr','dart','Private draft',false,'date','report'),('approved-us','us','sec','Published US',false,'date','10-K');
    INSERT INTO events VALUES('event-kr','kr','approved-kr',now(),'earnings','published'),('event-pending','kr','pending-kr',now(),'earnings','needs_review'),('event-us','us','approved-us',now(),'earnings','published');
    INSERT INTO briefs VALUES('event-kr','Reviewed KR','Source-backed'),('event-pending','Private draft','Never public'),('event-us','Reviewed US','Source-backed');
    INSERT INTO dart_filings VALUES('40000000-0000-4000-8000-000000000001','kr','Synthetic DART filing','20261019000001','https://dart.fss.or.kr/dsaf001/main.do?rcpNo=20261019000001','2026-10-19','date','Asia/Seoul',now(),'synthetic-sha'),('40000000-0000-4000-8000-000000000002','demo','Demo filing','20261019000002','https://dart.fss.or.kr/dsaf001/main.do?rcpNo=20261019000002','2026-10-19','date','Asia/Seoul',now(),'synthetic-sha'),('40000000-0000-4000-8000-000000000003','kr','Invalid source','20261019000003','https://attacker.test','2026-10-19','date','Asia/Seoul',now(),'synthetic-sha');
   `);
   await db.exec(readFileSync(new URL('../../../supabase/workspace-migrations/20261019071121_company_detail_connections.sql',import.meta.url),'utf8'));
   // PostgreSQL compiles and executes the changed SQL/PLpgSQL, not a string comparison.
   const resources=await db.query<{id:string;kind:string}>('select id,kind from app_private.sb_workspace_resources()');
   expect(resources.rows.map(r=>r.id)).toEqual(expect.arrayContaining(['kr','us','approved-kr','event-kr','event-us','40000000-0000-4000-8000-000000000001']));
   expect(resources.rows.map(r=>r.id)).not.toEqual(expect.arrayContaining(['pending-kr']));
   for(const hidden of ['demo','event-pending','40000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-000000000003'])expect(resources.rows.some(r=>r.id===hidden)).toBe(false);
   const p=JSON.stringify({id:'40000000-0000-4000-8000-000000000001',kind:'filing'});
   await expect(db.query('select app_mobile_private.document_detail($1::jsonb)',[p])).rejects.toThrow('authentication_required');
   await db.exec(`SET test.uid='10000000-0000-4000-8000-000000000001';`);
   const result=await db.query<{data:{metadata:{provider:string;publication_timezone:string};summaries:unknown[];facts:unknown[]}}> ('select app_mobile_private.document_detail($1::jsonb) data',[p]);
   expect(result.rows[0].data.metadata).toMatchObject({provider:'dart',publication_timezone:'Asia/Seoul',raw_sha256:'synthetic-sha'});
   expect(result.rows[0].data.summaries).toEqual([]);expect(result.rows[0].data.facts).toEqual([]);
   expect(JSON.stringify(result.rows[0].data)).not.toContain('source_object_key');
   await db.exec(`GRANT USAGE ON SCHEMA app_private,app_mobile_private TO authenticated,anon; SET ROLE anon;`);
   await expect(db.query('select app_private.sb_workspace_resources()')).rejects.toThrow('permission denied');
   await expect(db.query('select app_mobile_private.document_detail($1::jsonb)',[p])).rejects.toThrow('permission denied');
  }finally{await db.close();}
 },30000);
});
