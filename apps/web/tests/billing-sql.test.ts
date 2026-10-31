// @vitest-environment node
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {it,expect} from 'vitest';
it('replays pass grants, concurrent-retry reservations, expiry, refunds, isolation and service-only writes in PostgreSQL',async()=>{
 const db=new PGlite(),a='10000000-0000-4000-8000-000000000001',b='10000000-0000-4000-8000-000000000002';
 try{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA app_private;CREATE SCHEMA auth;CREATE TABLE public.users(id text PRIMARY KEY);INSERT INTO public.users VALUES('${a}'),('${b}');CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT nullif(current_setting('test.uid',true),'')::uuid$$;CREATE FUNCTION public.sb_require_mfa() RETURNS void LANGUAGE plpgsql AS $$BEGIN IF current_setting('test.mfa',true)='deny' THEN RAISE EXCEPTION 'mfa_required';END IF;END$$;CREATE FUNCTION public.sb_rate_limit() RETURNS void LANGUAGE sql AS $$SELECT$$;`);
 await db.exec(readFileSync(new URL('../../../supabase/workspace-migrations/20261031103225_hosted_checkout_pass.sql',import.meta.url),'utf8'));
 const status=async()=> (await db.query<{v:{active:boolean;test_active:boolean;expires_at:string}}>('SELECT sb_billing_status() v')).rows[0].v;
 const reserve=async(test:boolean)=>(await db.query<{v:{id:string;url:string|null;create:boolean}}>('SELECT sb_checkout_reserve($1) v',[test])).rows[0].v;
 const pay=async(id:string|null,hash:string,pid:string,test=false,refunded=false,time=new Date().toISOString())=>db.query('SELECT sb_payment_record($1,$2,$3,$4,$5,$6)',[id,hash.repeat(64),pid,test,time,refunded]);
 await expect(status()).rejects.toThrow('authentication_required');await db.exec(`SET test.uid='${a}'`);expect((await status()).active).toBe(false);
 const order=await reserve(false),retry=await reserve(false);expect(retry.id).toBe(order.id);expect(order.create).toBe(true);expect(retry.create).toBe(false);
 await db.query('SELECT sb_checkout_publish($1,$2)',[order.id,'https://example.lemonsqueezy.com/checkout/custom/a']);expect((await reserve(false)).url).toContain('checkout');
 await pay(order.id,'a','100');expect((await status()).active).toBe(true);const expiry=(await status()).expires_at;
 await pay(order.id,'a','100');await pay(order.id,'b','100');expect((await status()).expires_at).toBe(expiry);await expect(reserve(false)).rejects.toThrow('pass_already_active');
 await db.exec(`SET test.uid='${b}'`);expect((await status()).active).toBe(false);
 await pay(null,'c','100',false,true);await pay(order.id,'d','100');await db.exec(`SET test.uid='${a}'`);expect((await status()).active).toBe(false);
 const testOrder=await reserve(true);await pay(testOrder.id,'e','101',true);expect((await status()).test_active).toBe(true);expect((await status()).active).toBe(false);
 await expect(pay(testOrder.id,'f','102',true)).rejects.toThrow('payment_identity_mismatch');
 const expired=await reserve(false);await pay(expired.id,'f','103',false,false,new Date(Date.now()-31*86400000).toISOString());expect((await status()).active).toBe(false);
 await db.exec("SET test.mfa='deny'");await expect(status()).rejects.toThrow('mfa_required');await expect(reserve(false)).rejects.toThrow('mfa_required');await db.exec("SET test.mfa='allow'");
 const permissions=await db.query<{blocked:boolean}>(`SELECT NOT has_function_privilege('authenticated','sb_payment_record(uuid,text,text,boolean,timestamptz,boolean)','execute') AND NOT has_function_privilege('anon','sb_checkout_reserve(boolean)','execute') AND NOT has_table_privilege('authenticated','billing_orders','select') blocked`);expect(permissions.rows[0].blocked).toBe(true);
 }finally{await db.close();}
},20000);
