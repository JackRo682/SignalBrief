// @vitest-environment node
import {describe,expect,it,vi} from 'vitest';
import {safeSignInReturn,signInLink} from '../src/lib/auth-return';
import {startGoogleLogin} from '../src/lib/site-url';
import {completeOAuth,resetOAuthForTests} from '../src/lib/oauth-callback';
import type {SupabaseClient} from '@supabase/supabase-js';
describe('admin sign-in return path',()=>{
 it.each(['https://evil.test','//evil.test','/\\evil.test','javascript:alert(1)','/ops/%2f%2fevil.test','/auth/callback','/login','/ops/user-logs?token=secret','/ops/user-logs#secret'])('rejects unsafe or recursive destination %s',value=>expect(safeSignInReturn(value)).toBe('/today'));
 it('accepts the exact internal logs path',()=>{expect(signInLink('/ops/user-logs')).toBe('/login?next=%2Fops%2Fuser-logs');});
 it('keeps the return path when first moving to the canonical sign-in origin',async()=>{const move=vi.fn(),login=vi.fn();await startGoogleLogin('https://alias.test/login?next=%2Fops%2Fuser-logs','https://signalbrief.online',move,login);expect(move).toHaveBeenCalledWith('https://signalbrief.online/login?next=%2Fops%2Fuser-logs');expect(login).not.toHaveBeenCalled();});
 it('carries the safe path through the OAuth callback',async()=>{const login=vi.fn();await startGoogleLogin('https://signalbrief.online/login?next=%2Fops%2Fuser-logs','https://signalbrief.online',vi.fn(),login);expect(login).toHaveBeenCalledWith('https://signalbrief.online/auth/callback?next=%2Fops%2Fuser-logs');resetOAuthForTests();const db={auth:{exchangeCodeForSession:vi.fn().mockResolvedValue({error:null}),getUser:vi.fn().mockResolvedValue({data:{user:{id:'admin'}},error:null})}};expect(await completeOAuth(db as unknown as SupabaseClient,'https://signalbrief.online/auth/callback?code=test-admin&next=%2Fops%2Fuser-logs')).toBe('/ops/user-logs');});
});
