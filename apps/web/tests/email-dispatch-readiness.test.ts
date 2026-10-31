// @vitest-environment node
import type {SupabaseClient} from '@supabase/supabase-js';
import {afterEach,expect,it,vi} from 'vitest';
import {dispatchEmail} from '../../../supabase/functions/signalbrief-delivery/dispatch';
const config={email_enabled:true,resend_domain_verified:true,resend_from:'synthetic@example.test'};
const secrets={RESEND_API_KEY:'synthetic-key'};
afterEach(()=>vi.unstubAllGlobals());
it.each([null,{}, {available:false}, {available:'true'}])('does not claim or send when shared readiness is unavailable (%j)',async data=>{
 const rpc=vi.fn().mockResolvedValue({data,error:null}),send=vi.fn();vi.stubGlobal('fetch',send);
 expect(await dispatchEmail({rpc} as unknown as SupabaseClient,secrets,config)).toEqual({status:'blocked',code:'email_unavailable'});
 expect(rpc.mock.calls).toEqual([['sb_email_readiness',{}]]);expect(send).not.toHaveBeenCalled();
});
it('fails closed before claiming if the readiness RPC is missing or fails',async()=>{
 const rpc=vi.fn().mockResolvedValue({data:null,error:{message:'missing function'}}),send=vi.fn();vi.stubGlobal('fetch',send);
 expect(await dispatchEmail({rpc} as unknown as SupabaseClient,secrets,config)).toEqual({status:'blocked',code:'email_readiness_unavailable'});
 expect(rpc).toHaveBeenCalledTimes(1);expect(send).not.toHaveBeenCalled();
});
it('claims only after readiness and reports an empty queue without calling a provider',async()=>{
 const rpc=vi.fn().mockResolvedValueOnce({data:{available:true},error:null}).mockResolvedValueOnce({data:null,error:null}),send=vi.fn();vi.stubGlobal('fetch',send);
 expect(await dispatchEmail({rpc} as unknown as SupabaseClient,secrets,config)).toEqual({status:'idle'});
 expect(rpc.mock.calls.map(x=>x[0])).toEqual(['sb_email_readiness','sb_email_claim']);expect(send).not.toHaveBeenCalled();
});
