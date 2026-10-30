import {describe,it,expect} from 'vitest';
import {quoteMessage} from '../src/workspace/quote-message';
const t=(ko:string)=>ko;
describe('company quote explanations',()=>{
 it('distinguishes display authorization from transport failures',()=>{expect(quoteMessage('kis_display_license_unverified',t)).toContain('KIS');expect(quoteMessage('fmp_display_license_unverified',t)).toContain('FMP');expect(quoteMessage('provider_unavailable',t)).toContain('요청에 실패');expect(quoteMessage('missing_key',t)).toContain('인증 정보');});
 it('never reflects arbitrary provider error content',()=>expect(quoteMessage('synthetic-secret',t)).not.toContain('synthetic-secret'));
});
