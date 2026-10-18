// @vitest-environment node
import {afterEach,describe,expect,it,vi} from 'vitest';
import {NextRequest} from 'next/server';
import {GET,POST} from '../src/app/email/unsubscribe/route';
const req=(token:string)=>new NextRequest('https://signalbrief.online/email/unsubscribe?token='+token);
afterEach(()=>vi.unstubAllGlobals());
describe('no-login unsubscribe confirmation',()=>{
 it('shows a confirmation without making a mutation on GET',async()=>{const f=vi.fn();vi.stubGlobal('fetch',f);const response=await GET(req('a'.repeat(64)));expect(response.status).toBe(200);expect(response.headers.get('Content-Type')).toContain('text/html');expect(await response.text()).toContain('<form method="post">');expect(f).not.toHaveBeenCalled();});
 it('rejects malformed links before contacting the backend',async()=>{const f=vi.fn();vi.stubGlobal('fetch',f);expect((await POST(req('invalid'))).status).toBe(400);expect(f).not.toHaveBeenCalled();});
 it('forwards only the token to the fixed endpoint and confirms success',async()=>{const f=vi.fn().mockResolvedValue(new Response('{"status":"unsubscribed"}'));vi.stubGlobal('fetch',f);const response=await POST(req('a'.repeat(64)));expect(response.status).toBe(200);expect(f.mock.calls[0][0]).toBe('https://xabzzhtdmqsaqdauthbu.supabase.co/functions/v1/signalbrief-notifications/unsubscribe?token='+'a'.repeat(64));expect(f.mock.calls[0][1].method).toBe('POST');expect(f.mock.calls[0][1].redirect).toBe('error');expect(await response.text()).toContain('수신을 중단했습니다');});
 it('does not show success on a failed backend response',async()=>{vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('{}',{status:502})));const response=await POST(req('a'.repeat(64)));expect(response.status).toBe(502);expect(await response.text()).not.toContain('수신을 중단했습니다');});
});
