// @vitest-environment node
import {describe,it,expect,vi,afterEach} from 'vitest';
import {GET} from '../src/app/api/company-profile/route';
const id='20000000-0000-4000-8000-000000000001',auth='Bearer '+ 'a'.repeat(25);
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
describe('company profile proxy',()=>{
 it('rejects anonymous access before any upstream call',async()=>{vi.stubGlobal('fetch',vi.fn());expect((await GET(new Request('https://example.test/api/company-profile?company_id='+id))).status).toBe(401);expect(fetch).not.toHaveBeenCalled();});
 it('rejects invalid company identifiers',async()=>expect((await GET(new Request('https://example.test/api/company-profile?company_id=bad',{headers:{Authorization:auth}}))).status).toBe(422));
 it('forwards only to the configured Supabase profile function',async()=>{vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL','https://fixture.supabase.co');vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY','fixture-key');vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json({status:'not_available',profile:null})));const r=await GET(new Request(`https://example.test/api/company-profile?company_id=${id}&url=https://attacker.test`,{headers:{Authorization:auth,Cookie:'private-cookie'}}));expect(r.status).toBe(200);const [url,init]=vi.mocked(fetch).mock.calls[0];expect(String(url)).toBe('https://fixture.supabase.co/functions/v1/signalbrief-profiles?company_id='+id);expect(init?.headers).toEqual({apikey:'fixture-key',Authorization:auth});expect(r.headers.get('cache-control')).toBe('private, no-store');});
 it('rejects a non-Supabase destination',async()=>{vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL','https://attacker.test');vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY','fixture-key');expect((await GET(new Request('https://example.test/api/company-profile?company_id='+id,{headers:{Authorization:auth}}))).status).toBe(503);});
});
