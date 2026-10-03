// @vitest-environment node
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
const client={auth:{}};
vi.mock('@supabase/supabase-js',()=>({createClient:vi.fn(()=>client)}));
import {initializeSupabase,resolvedPublicAuth,resetClientForTests} from '../src/lib/supabase';
beforeEach(()=>{resetClientForTests();vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL','');vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY','');});
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
it('loads only server-provided public config and shares initialization',async()=>{const f=vi.fn().mockResolvedValue(Response.json({url:'https://project.supabase.co',publishableKey:'sb_publishable_example'}));vi.stubGlobal('fetch',f);await Promise.all([initializeSupabase(),initializeSupabase()]);expect(f).toHaveBeenCalledTimes(1);expect(resolvedPublicAuth()).toEqual({url:'https://project.supabase.co',key:'sb_publishable_example'});});
it('rejects a service role JWT before initializing a browser client',async()=>{const jwt='a.'+Buffer.from(JSON.stringify({role:'service_role'})).toString('base64url')+'.c';vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json({url:'https://project.supabase.co',publishableKey:jwt})));await expect(initializeSupabase()).rejects.toThrow('invalid_public_auth_configuration');});
it('rejects non-HTTPS and URL credentials in runtime auth config',async()=>{vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json({url:'https://user:password@project.supabase.co',publishableKey:'sb_publishable_example'})));await expect(initializeSupabase()).rejects.toThrow('invalid_public_auth_configuration');});
it('does not permanently cache an initialization failure',async()=>{const f=vi.fn().mockResolvedValueOnce(new Response('{}',{status:503})).mockResolvedValueOnce(Response.json({url:'https://project.supabase.co',publishableKey:'sb_publishable_example'}));vi.stubGlobal('fetch',f);await expect(initializeSupabase()).rejects.toThrow();await expect(initializeSupabase()).resolves.toEqual(client);});
