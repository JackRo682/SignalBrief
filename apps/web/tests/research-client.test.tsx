import '@testing-library/jest-dom/vitest';
import {act,cleanup,renderHook,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import type {ReactNode} from 'react';
import {OpsWorkspaceProvider,type OpsWorkspace} from '../src/admin-logs/workspace-context';
import {research,ResearchRequestError,useResearch,useResearchMutation} from '../src/research/client';

const mocks=vi.hoisted(()=>({auth:{token:'synthetic-admin-one' as string|null,me:{id:'admin-one'}},fetch:vi.fn()}));
vi.mock('@/components/auth',()=>({useAuth:()=>mocks.auth}));

function deferred<T>(){
  let resolve!:(value:T)=>void;
  const promise=new Promise<T>(value=>{resolve=value;});
  return {promise,resolve};
}
function value(workspace:OpsWorkspace){
  return function Wrapper({children}:{children:ReactNode}){return <OpsWorkspaceProvider value={workspace}>{children}</OpsWorkspaceProvider>;};
}
const response=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
let workspace:OpsWorkspace;

beforeEach(()=>{
  mocks.auth={token:'synthetic-admin-one',me:{id:'admin-one'}};
  mocks.fetch.mockReset();
  vi.stubGlobal('fetch',mocks.fetch);
  workspace={refreshVersion:0,refreshAll:vi.fn(),deny:vi.fn(),openDetail:vi.fn()};
});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});

describe('research request access errors',()=>{
  it('preserves an HTTP access failure even when the response is not JSON',async()=>{
    mocks.fetch.mockResolvedValue(new Response('Session expired',{status:401}));
    await expect(research('synthetic-token','reports')).rejects.toMatchObject({name:'ResearchRequestError',status:401,code:'research_request_failed'});
  });

  it('retains the server MFA code and the Korean recovery message',async()=>{
    mocks.fetch.mockResolvedValue(response({error:{code:'mfa_required'}},403));
    await expect(research('synthetic-token','reports')).rejects.toMatchObject({status:403,code:'mfa_required',message:'추가 인증이 필요합니다.'});
  });
});

describe('research reads in the shared operations page',()=>{
  it('uses shared refresh without refetching from unrelated provider rerenders',async()=>{
    mocks.fetch.mockImplementation(async()=>response({items:[{name:'synthetic experiment'}]}));
    const {result,rerender}=renderHook(()=>useResearch('experiments'),{wrapper:value(workspace)});
    await waitFor(()=>expect(result.current.data).toEqual({items:[{name:'synthetic experiment'}]}));
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    act(()=>result.current.reload());
    expect(workspace.refreshAll).toHaveBeenCalledTimes(1);
    rerender();
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    workspace.refreshVersion++;
    rerender();
    await waitFor(()=>expect(mocks.fetch).toHaveBeenCalledTimes(2));
    await waitFor(()=>expect(result.current.loading).toBe(false));
  });

  it('keeps standalone reload working without a workspace provider',async()=>{
    mocks.fetch.mockImplementation(async()=>response({items:[]}));
    const {result}=renderHook(()=>useResearch('experiments'));
    await waitFor(()=>expect(result.current.loading).toBe(false));
    act(()=>result.current.reload());
    await waitFor(()=>expect(mocks.fetch).toHaveBeenCalledTimes(2));
  });

  it('discards a previous identity response even if its transport ignores abort',async()=>{
    const stale=deferred<Response>();
    mocks.fetch.mockReturnValueOnce(stale.promise).mockResolvedValueOnce(response({items:[{name:'new account'}]}));
    const {result,rerender}=renderHook(()=>useResearch('experiments'),{wrapper:value(workspace)});
    await waitFor(()=>expect(mocks.fetch).toHaveBeenCalledTimes(1));
    mocks.auth={token:'synthetic-admin-two',me:{id:'admin-two'}};
    rerender();
    expect(result.current.data).toBeNull();
    await waitFor(()=>expect(result.current.data).toEqual({items:[{name:'new account'}]}));
    await act(async()=>{stale.resolve(response({items:[{name:'old private record'}]}));await stale.promise;});
    expect(result.current.data).toEqual({items:[{name:'new account'}]});
    expect(workspace.deny).not.toHaveBeenCalled();
  });

  it('does not let a late denial from an old request close the new account workspace',async()=>{
    const stale=deferred<Response>();
    mocks.fetch.mockReturnValueOnce(stale.promise).mockResolvedValueOnce(response({items:[]}));
    const {result,rerender}=renderHook(()=>useResearch('experiments'),{wrapper:value(workspace)});
    await waitFor(()=>expect(mocks.fetch).toHaveBeenCalledTimes(1));
    mocks.auth={token:'synthetic-admin-two',me:{id:'admin-two'}};
    rerender();
    await waitFor(()=>expect(result.current.loading).toBe(false));
    await act(async()=>{stale.resolve(response({error:{code:'admin_required'}},403));await stale.promise;});
    expect(workspace.deny).not.toHaveBeenCalled();
    expect(result.current.error).toBe('');
  });

  it.each([401,403])('propagates an active %s denial to the unified access boundary',async status=>{
    mocks.fetch.mockResolvedValue(response({error:{code:'admin_required'}},status));
    const {result}=renderHook(()=>useResearch('reports'),{wrapper:value(workspace)});
    await waitFor(()=>expect(workspace.deny).toHaveBeenCalledWith(expect.objectContaining({status,code:'admin_required'})));
    expect(result.current.data).toBeNull();
  });

  it('keeps temporary server failures local and clears a disabled resource',async()=>{
    mocks.fetch.mockResolvedValue(response({error:{code:'research_unreachable'}},502));
    const {result,rerender}=renderHook(({enabled})=>useResearch('reports',{},enabled),{initialProps:{enabled:true},wrapper:value(workspace)});
    await waitFor(()=>expect(result.current.error).toContain('502'));
    expect(workspace.deny).not.toHaveBeenCalled();
    rerender({enabled:false});
    expect(result.current).toMatchObject({data:null,error:'',loading:false});
  });
});

describe('research mutations in the shared operations page',()=>{
  it.each(['independent_reviewer_required','production_fault_test_forbidden'])('keeps the action-policy rejection %s local',async code=>{
    mocks.fetch.mockResolvedValue(response({error:{code}},403));
    const {result}=renderHook(()=>useResearchMutation(),{wrapper:value(workspace)});
    await expect(result.current('case_review',{id:'10000000-0000-4000-8000-000000000001',status:'approved',reason:'Synthetic review reason'})).rejects.toMatchObject({status:403,code});
    expect(workspace.deny).not.toHaveBeenCalled();
  });

  it('propagates current mutation denials without manufacturing a successful result',async()=>{
    mocks.fetch.mockResolvedValue(response({error:{code:'mfa_required'}},403));
    const {result}=renderHook(()=>useResearchMutation(),{wrapper:value(workspace)});
    await expect(result.current('evaluation_budget',{usd:0})).rejects.toBeInstanceOf(ResearchRequestError);
    expect(workspace.deny).toHaveBeenCalledWith(expect.objectContaining({status:403,code:'mfa_required'}));
  });

  it('rejects late success after account changes so callers cannot navigate to stale records',async()=>{
    const stale=deferred<Response>();
    mocks.fetch.mockReturnValue(stale.promise);
    const {result,rerender}=renderHook(()=>useResearchMutation(),{wrapper:value(workspace)});
    const pending=result.current('dataset_create',{name:'Synthetic dataset',split:'review'});
    const rejected=expect(pending).rejects.toMatchObject({name:'AbortError'});
    mocks.auth={token:'synthetic-admin-two',me:{id:'admin-two'}};
    rerender();
    stale.resolve(response({id:'10000000-0000-4000-8000-000000000001'}));
    await rejected;
    expect(workspace.deny).not.toHaveBeenCalled();
  });

  it('does not propagate an unmounted mutation denial to a later workspace',async()=>{
    const stale=deferred<Response>();
    mocks.fetch.mockReturnValue(stale.promise);
    const {result,unmount}=renderHook(()=>useResearchMutation(),{wrapper:value(workspace)});
    const pending=result.current('evaluation_budget',{usd:0});
    const rejected=expect(pending).rejects.toMatchObject({status:401});
    unmount();
    stale.resolve(response({error:{code:'invalid_session'}},401));
    await rejected;
    expect(workspace.deny).not.toHaveBeenCalled();
  });
});
