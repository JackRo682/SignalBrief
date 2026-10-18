// @vitest-environment node
import {describe,it,expect} from 'vitest';
import {verifyRelay,relaySignature,dartEndpoint} from '../src/server/dart-relay';
const secret='a'.repeat(64),timestamp=String(Date.now()),payload={kind:'list' as const,key:'b'.repeat(40),nonce:'c'.repeat(64),corp_code:'00126380',page:1,bgn_de:'20261007',end_de:'20261014'},body=JSON.stringify(payload);
describe('private official DART relay',()=>{
 it('accepts a fresh signed request',()=>expect(verifyRelay(body,timestamp,relaySignature(body,timestamp,secret),secret)).toEqual(payload));
 it.each(['','0'.repeat(64),relaySignature(body+' ',timestamp,secret)])('rejects forged or altered signatures',signature=>expect(()=>verifyRelay(body,timestamp,signature,secret)).toThrow('relay_unauthorized'));
 it('rejects expired requests',()=>expect(()=>verifyRelay(body,timestamp,relaySignature(body,timestamp,secret),secret,Number(timestamp)+60001)).toThrow('relay_unauthorized'));
 it('never accepts a configurable upstream host',()=>expect(dartEndpoint({...payload,host:'https://attacker.test'} as typeof payload).origin).toBe('https://opendart.fss.or.kr'));
 it.each([{...payload,page:6},{...payload,kind:'other'},{...payload,corp_code:'../../x'},{kind:'document',receipt:'bad'}])('rejects invalid upstream identifiers',p=>expect(()=>dartEndpoint(p as typeof payload)).toThrow());
 it('uses exact document receipt IDs',()=>expect(dartEndpoint({kind:'document',key:payload.key,nonce:payload.nonce,receipt:'20261014000001'}).searchParams.get('rcept_no')).toBe('20261014000001'));
 it('routes company lookups only to the fixed official company endpoint',()=>{const url=dartEndpoint({...payload,kind:'company'});expect(url.origin+url.pathname).toBe('https://opendart.fss.or.kr/api/company.json');expect(url.searchParams.get('corp_code')).toBe(payload.corp_code);expect(url.searchParams.has('page_no')).toBe(false);});
 it('rejects a malformed company code',()=>expect(()=>dartEndpoint({...payload,kind:'company',corp_code:'../../x'})).toThrow('relay_invalid_request'));
});
