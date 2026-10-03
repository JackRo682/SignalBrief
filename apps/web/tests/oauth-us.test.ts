// @vitest-environment node
import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import type {SupabaseClient} from '@supabase/supabase-js';
import {completeOAuth,resetOAuthForTests} from '../src/lib/oauth-callback';
import {GET} from '../src/app/api/auth-config/route';
import {proxyUS} from '../src/server/us-proxy';
beforeEach(()=>resetOAuthForTests());afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
function db(){return {auth:{exchangeCodeForSession:vi.fn().mockResolvedValue({error:null}),getUser:vi.fn().mockResolvedValue({data:{user:{id:'test'}},error:null})}};}
describe('OAuth callback',()=>{
 it('exchanges a single-use code only once across strict remounts',async()=>{const c=db(),url='https://app.test/auth/callback?code=test';await Promise.all([completeOAuth(c as unknown as SupabaseClient,url),completeOAuth(c as unknown as SupabaseClient,url)]);expect(c.auth.exchangeCodeForSession).toHaveBeenCalledTimes(1);});
 it('preserves an optional flow identifier',async()=>{const c=db();await completeOAuth(c as unknown as SupabaseClient,'https://app.test/auth/callback?code=x&sb_flow_id=test-flow');expect(c.auth.exchangeCodeForSession).toHaveBeenCalledWith('x',{flowId:'test-flow'});});
 it('validates the resulting session against Auth',async()=>{const c=db();c.auth.getUser.mockResolvedValue({data:{user:null},error:{message:'expired'}});await expect(completeOAuth(c as unknown as SupabaseClient,'https://app.test/?code=x')).rejects.toThrow('oauth_session_verification_failed');});
 it('does not follow arbitrary next URLs',async()=>{const c=db();expect(await completeOAuth(c as unknown as SupabaseClient,'https://app.test/?code=x&next=https://evil.test')).toBe('/today');});
 it('reports denied consent without reflecting query data',async()=>{const c=db();await expect(completeOAuth(c as unknown as SupabaseClient,'https://app.test/?error=access_denied&error_description=SECRET')).rejects.toThrow('oauth_consent_denied');expect(c.auth.exchangeCodeForSession).not.toHaveBeenCalled();});
 it('reports missing codes',async()=>{await expect(completeOAuth(db() as unknown as SupabaseClient,'https://app.test/')).rejects.toThrow('oauth_code_missing');});
});
describe('public config and proxy',()=>{
 it('never returns service-role secrets as public config',async()=>{vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL','https://project.supabase.co');vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY','');vi.stubEnv('SUPABASE_PUBLISHABLE_KEY','');vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY','TOPSECRET');const r=GET();expect(r.status).toBe(503);expect(await r.text()).not.toContain('TOPSECRET');});
 it('rejects secret-key values in public config',()=>{vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL','https://project.supabase.co');vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY','sb_secret_private');expect(GET().status).toBe(503);});
 it('forbids maintenance/provisioning through the public proxy',async()=>{expect((await proxyUS(new Request('https://app.test/api/us/maintenance/x'),'maintenance/x')).status).toBe(404);});
 it('requires authentication for market and personal data',async()=>{expect((await proxyUS(new Request('https://app.test/api/us/quotes'),'quotes')).status).toBe(401);});
 it('allows key-free, cached public diagnostics',async()=>{vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL','https://project.supabase.co');vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY','sb_publishable_public');const f=vi.fn().mockResolvedValue(new Response('{}'));vi.stubGlobal('fetch',f);expect((await proxyUS(new Request('https://app.test/api/us/status'),'status')).status).toBe(200);expect(f.mock.calls[0][0].pathname).toBe('/functions/v1/signalbrief-us/status');});
});
