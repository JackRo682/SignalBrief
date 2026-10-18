// @vitest-environment node
import {describe,it,expect} from 'vitest';
import {parseProfile} from '../../../supabase/functions/signalbrief-profiles/core';
const company={id:'20000000-0000-4000-8000-000000000001',provider_company_id:'12345678',ticker:'123456'};
const raw={status:'000',corp_code:'12345678',stock_code:'123456',corp_name:'Synthetic company',corp_name_eng:'Synthetic',ceo_nm:'Synthetic executive',adres:'Synthetic address',hm_url:'https://example.com',est_dt:'20200229',induty_code:'12345',acc_mt:'12'};
const parse=(change={})=>parseProfile(JSON.stringify({...raw,...change}),company,'2026-10-18T00:00:00Z','a'.repeat(64));
describe('DART profile identity and provenance',()=>{
 it('requires matching DART and stock identities and preserves source metadata',()=>{
  const result=parse();expect(result.status).toBe('verified');expect(result.profile?.name).toBe(raw.corp_name);expect(result.profile?.established_on).toBe('2020-02-29');expect(result.source_sha256).toBe('a'.repeat(64));expect(result.fetched_at).toBe('2026-10-18T00:00:00Z');
 });
 it.each([{corp_code:'99999999'},{stock_code:'999999'},{stock_code:''}])('rejects a mismatched issuer',change=>expect(()=>parse(change)).toThrow('company_identity_mismatch'));
 it.each(['<xml>','null','[]','{'])('rejects malformed responses',value=>expect(()=>parseProfile(value,company,'now','sha')).toThrow('invalid_provider_response'));
 it('keeps missing or invalid values null',()=>{const p=parse({ceo_nm:'-',est_dt:'20210229',acc_mt:'13',adres:''}).profile;expect(p?.ceo).toBeNull();expect(p?.established_on).toBeNull();expect(p?.fiscal_month).toBeNull();expect(p?.address).toBeNull();});
 it.each(['javascript:alert(1)','http://example.com','https://user:pass@example.com','example.com'])('does not display unsafe or invented website URLs',hm_url=>expect(parse({hm_url}).profile?.website).toBeNull());
 it('does not turn API credential errors into missing company data',()=>expect(()=>parse({status:'010'})).toThrow('provider_key_invalid'));
 it('reports upstream quotas',()=>expect(()=>parse({status:'020'})).toThrow('provider_quota_exceeded'));
 it('represents an explicit no-data response',()=>expect(parse({status:'013'})).toMatchObject({status:'not_available',profile:null}));
});
