// @vitest-environment node
import {describe,it,expect,vi} from 'vitest';
import {verifyDeliveryWebhook,sendNotification,retryableEmailError} from '../../../supabase/functions/signalbrief-delivery/core';
import {ProviderError,websitePermission} from '../../../supabase/functions/signalbrief-api/us-core';
import {koreanSymbol,normalizeKIS,kisQuote,fmpIndex,kisToken,indexSymbols} from '../../../supabase/functions/signalbrief-api/market-core';
import {inspectDartZIP,crc32,validateDartXML} from '../../../supabase/functions/signalbrief-collector/dart-document-core';
const response=(value:unknown)=>vi.fn().mockResolvedValue(new Response(JSON.stringify(value)));
describe('authorized quote boundaries — synthetic fixtures',()=>{
 it('maps all four indices to official provider identifiers',()=>expect(indexSymbols).toEqual({KOSPI:'0001',KOSDAQ:'1001',NASDAQ:'^IXIC','S&P500':'^GSPC'}));
 it('does not reinterpret US symbols as Korean equities',()=>expect(()=>koreanSymbol('AAPL')).toThrow('invalid_korean_symbol'));
 it('does not request Korean data without display rights',async()=>{const f=vi.fn();await expect(kisQuote('005930',{}, {},'',false,f)).rejects.toThrow('kis_display_license_unverified');expect(f).not.toHaveBeenCalled();});
 it('does not request indices with stock-only entitlement',async()=>{const f=vi.fn();await expect(fmpIndex('NASDAQ','synthetic',{fmp_display_enabled:true,fmp_license_reference:'synthetic license',fmp_license_until:'2099-01-01'},f)).rejects.toThrow('index_entitlement_unverified');expect(f).not.toHaveBeenCalled();});
 it('preserves the difference between exchange timestamps and request observation time',()=>expect(normalizeKIS({rt_cd:'0',output:{stck_prpr:'100',prdy_ctrt:'1.5'}},'005930',false,new Date('2026-01-01T00:00:00Z'))).toMatchObject({price:100,currency:'KRW',timestamp_kind:'request_observed_at_not_exchange_timestamp',history:[]}));
 it('rejects negative prices and provider failures',()=>{expect(()=>normalizeKIS({rt_cd:'0',output:{stck_prpr:'-1',prdy_ctrt:'0'}},'005930')).toThrow();expect(()=>normalizeKIS({rt_cd:'1'},'005930')).toThrow();});
 it('uses separate Korean index fields',()=>expect(normalizeKIS({rt_cd:'0',output:{bstp_nmix_prpr:'1000.25',bstp_nmix_prdy_ctrt:'-0.5'}},'KOSPI',true)).toMatchObject({price:1000.25,currency:'POINTS',change_pct:-0.5}));
 it('validates token expiry and keeps tokens out of public quote results',async()=>{const f=response({access_token:'synthetic-token',expires_in:3600});expect(await kisToken('synthetic-key','synthetic-secret',f)).toMatchObject({expires_in:3600});expect(f.mock.calls[0][0].hostname).toBe('openapi.koreainvestment.com');});
 it('expires Korean display permissions',()=>expect(websitePermission({kis_display_enabled:true,kis_license_reference:'old agreement',kis_license_until:'2000-01-01'},'kis')).toBe(false));
});
describe('email reliability and signature verification — synthetic keys',()=>{
 const secret='whsec_'+btoa('synthetic-signing-key-only'),now=Date.now(),timestamp=String(Math.floor(now/1000));
 const raw=JSON.stringify({type:'email.delivered',created_at:new Date(now).toISOString(),data:{email_id:'00000000-0000-4000-8000-000000000001'}});
 async function signed(){const key=await crypto.subtle.importKey('raw',new TextEncoder().encode('synthetic-signing-key-only'),{name:'HMAC',hash:'SHA-256'},false,['sign']);const data=new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode('msg_test.'+timestamp+'.'+raw)));return new Headers({'svix-id':'msg_test','svix-timestamp':timestamp,'svix-signature':'v1,'+btoa(String.fromCharCode(...data))});}
 it('verifies a signed payload without storing recipient content',async()=>expect(await verifyDeliveryWebhook(raw,await signed(),secret,now)).toMatchObject({type:'email.delivered',email_id:'00000000-0000-4000-8000-000000000001'}));
 it('rejects body tampering',async()=>await expect(verifyDeliveryWebhook(raw+' ',await signed(),secret,now)).rejects.toThrow('invalid_webhook'));
 it('rejects stale signatures',async()=>await expect(verifyDeliveryWebhook(raw,await signed(),secret,now+600000)).rejects.toThrow('invalid_webhook'));
 it('rejects unsigned webhooks',async()=>await expect(verifyDeliveryWebhook(raw,new Headers(),secret,now)).rejects.toThrow('invalid_webhook'));
 it('uses one deterministic idempotency key across retries',async()=>{const f=response({id:'synthetic-message'});await sendNotification('synthetic-key','alerts@example.test','user@example.test','Test','Synthetic test body','sb-email-unit-1',f);expect(f.mock.calls[0][1].headers['Idempotency-Key']).toBe('sb-email-unit-1');});
 it('blocks header injection before sending',async()=>{const f=vi.fn();await expect(sendNotification('synthetic','alerts@example.test','user@example.test','Test\nBcc: attacker','body','sb-email-unit-1',f)).rejects.toThrow('invalid_email_request');expect(f).not.toHaveBeenCalled();});
 it('never retries permanent permission failures',()=>{expect(retryableEmailError(new ProviderError('resend','access_or_plan_denied',403))).toBe(false);expect(retryableEmailError(new ProviderError('resend','network_or_timeout',502))).toBe(true);});
});
describe('OpenDART archive boundaries — synthetic archives',()=>{
 function zip(name='filing.xml',size=3){const n=new TextEncoder().encode(name),data=new Uint8Array(30+n.length+3+46+n.length+22),v=new DataView(data.buffer),central=30+n.length+3,end=central+46+n.length;v.setUint32(0,0x04034b50,true);v.setUint16(26,n.length,true);data.set(n,30);v.setUint32(central,0x02014b50,true);v.setUint32(central+20,3,true);v.setUint32(central+24,size,true);v.setUint16(central+28,n.length,true);data.set(n,central+46);v.setUint32(end,0x06054b50,true);v.setUint16(end+8,1,true);v.setUint16(end+10,1,true);v.setUint32(end+12,46+n.length,true);v.setUint32(end+16,central,true);return data;}
 it('reads member bounds before decompression',()=>expect(inspectDartZIP(zip())[0]).toMatchObject({name:'filing.xml',size:3}));
 it('rejects path traversal',()=>expect(()=>inspectDartZIP(zip('../filing.xml'))).toThrow('unsafe_archive_member'));
 it('rejects declared decompression bombs',()=>expect(()=>inspectDartZIP(zip('filing.xml',33_000_000))).toThrow());
 it('rejects non-XML archive members',()=>expect(()=>inspectDartZIP(zip('filing.exe'))).toThrow());
 it('checks CRC with the standard test vector',()=>expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926));
 it('rejects entity declarations',()=>expect(()=>validateDartXML('<!DOCTYPE a [<!ENTITY x SYSTEM "file:///private">]><a>&x;</a>')).toThrow('xml_entities_not_supported'));
});
