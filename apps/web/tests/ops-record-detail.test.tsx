import '@testing-library/jest-dom/vitest';
import {act,cleanup,fireEvent,render,renderHook,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import type {ReactNode} from 'react';
import {OpsWorkspaceProvider,type OpsWorkspace} from '../src/admin-logs/workspace-context';
import {useOperationRecord} from '../src/admin-logs/record-client';
import OpsDocument from '../src/screens/ops-document';

// Isolated synthetic identities and byte buffers; no production requests or files.
const mocks=vi.hoisted(()=>({
  token:'synthetic-record-token-one',id:'synthetic-admin-one',admin:true,
  fetch:vi.fn(),createObjectURL:vi.fn(),revokeObjectURL:vi.fn(),
}));
vi.mock('@/components/auth',()=>({useAuth:()=>({token:mocks.token,me:{id:mocks.id,is_admin:mocks.admin},loading:false,error:null})}));
vi.mock('@/lib/supabase',()=>({getSupabase:()=>{throw new Error('Unexpected synthetic RPC');}}));

const documentId='10000000-0000-4000-8000-000000000001';
const nextDocumentId='20000000-0000-4000-8000-000000000002';
const documentPath=`/v1/ops/documents/${documentId}`;
const nextDocumentPath=`/v1/ops/documents/${nextDocumentId}`;
const originalCreate=Object.getOwnPropertyDescriptor(URL,'createObjectURL');
const originalRevoke=Object.getOwnPropertyDescriptor(URL,'revokeObjectURL');
let workspace:OpsWorkspace;
let clicked:HTMLAnchorElement[];

function deferred<T>(){
  let resolve!:(value:T)=>void;
  const promise=new Promise<T>(value=>{resolve=value;});
  return {promise,resolve};
}
function Wrapper({children}:{children:ReactNode}){return <OpsWorkspaceProvider value={workspace}>{children}</OpsWorkspaceProvider>;}
function renderDocument(){return render(<OpsDocument id={documentId}/>,{wrapper:Wrapper});}

beforeEach(()=>{
  vi.clearAllMocks();
  mocks.token='synthetic-record-token-one';mocks.id='synthetic-admin-one';mocks.admin=true;
  mocks.createObjectURL.mockReturnValue('blob:synthetic-private-source');
  mocks.fetch.mockResolvedValue(Response.json({title:'Synthetic source record'}));
  vi.stubGlobal('fetch',mocks.fetch);
  Object.defineProperty(URL,'createObjectURL',{configurable:true,value:mocks.createObjectURL});
  Object.defineProperty(URL,'revokeObjectURL',{configurable:true,value:mocks.revokeObjectURL});
  clicked=[];
  vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(function(this:HTMLAnchorElement){clicked.push(this);});
  workspace={refreshVersion:0,refreshAll:vi.fn(),deny:vi.fn(),openDetail:vi.fn()};
});
afterEach(()=>{
  cleanup();vi.useRealTimers();vi.unstubAllGlobals();
  if(originalCreate)Object.defineProperty(URL,'createObjectURL',originalCreate);else Reflect.deleteProperty(URL,'createObjectURL');
  if(originalRevoke)Object.defineProperty(URL,'revokeObjectURL',originalRevoke);else Reflect.deleteProperty(URL,'revokeObjectURL');
});

describe('operation record details and raw-download lifetime',()=>{
  it('keeps authenticated record reads scoped across both detail and identity changes',async()=>{
    const oldDetail=deferred<Response>(),oldIdentity=deferred<Response>();
    mocks.fetch.mockReset();
    mocks.fetch.mockReturnValueOnce(oldDetail.promise).mockReturnValueOnce(oldIdentity.promise)
      .mockResolvedValueOnce(Response.json({title:'New account record'}));
    const view=renderHook(({path})=>useOperationRecord(path),{initialProps:{path:documentPath},wrapper:Wrapper});
    await waitFor(()=>expect(mocks.fetch).toHaveBeenCalledTimes(1));
    const firstSignal=mocks.fetch.mock.calls[0][1].signal as AbortSignal;
    expect(mocks.fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer synthetic-record-token-one');
    view.rerender({path:nextDocumentPath});
    expect(view.result.current.data).toBeNull();
    await waitFor(()=>expect(mocks.fetch).toHaveBeenCalledTimes(2));
    expect(firstSignal.aborted).toBe(true);
    const secondSignal=mocks.fetch.mock.calls[1][1].signal as AbortSignal;
    mocks.token='synthetic-record-token-two';mocks.id='synthetic-admin-two';
    view.rerender({path:nextDocumentPath});
    expect(view.result.current.data).toBeNull();
    await waitFor(()=>expect(view.result.current.data).toEqual({title:'New account record'}));
    expect(secondSignal.aborted).toBe(true);
    expect(mocks.fetch.mock.calls[2][1].headers.Authorization).toBe('Bearer synthetic-record-token-two');
    await act(async()=>{
      oldDetail.resolve(Response.json({title:'Stale previous detail'}));
      oldIdentity.resolve(Response.json({title:'Stale previous account'}));
      await Promise.all([oldDetail.promise,oldIdentity.promise]);
    });
    expect(view.result.current.data).toEqual({title:'New account record'});
    expect(workspace.deny).not.toHaveBeenCalled();
  });

  it('sends active read 401 and 403 responses to the shared access boundary',async()=>{
    for(const [status,code] of [[401,'authentication_required'],[403,'mfa_required']] as const){
      mocks.fetch.mockResolvedValueOnce(Response.json({error:{code}},{status}));
      const view=renderHook(()=>useOperationRecord(documentPath),{wrapper:Wrapper});
      await waitFor(()=>expect(workspace.deny).toHaveBeenLastCalledWith(expect.objectContaining({status,code})));
      expect(view.result.current.data).toBeNull();
      expect(view.result.current.error).not.toBe('');
      view.unmount();
    }
    expect(workspace.deny).toHaveBeenCalledTimes(2);
  });

  it('does not create or click a blob URL when a raw response arrives after unmount',async()=>{
    const pending=deferred<Response>();
    let rawSignal:AbortSignal|undefined;
    mocks.fetch.mockImplementation((url:string,init:RequestInit)=>{
      if(url.endsWith('/raw')){rawSignal=init.signal as AbortSignal;return pending.promise;}
      return Promise.resolve(Response.json({title:'Synthetic source record'}));
    });
    const view=renderDocument();
    await screen.findByText(/Synthetic source record/);
    fireEvent.click(screen.getByRole('button',{name:'원본 파일 받기'}));
    await waitFor(()=>expect(rawSignal).toBeDefined());
    view.unmount();
    expect(rawSignal?.aborted).toBe(true);
    const raw=new Response('Synthetic private bytes');
    const decode=vi.spyOn(raw,'blob');
    await act(async()=>{pending.resolve(raw);await pending.promise;});
    expect(decode).not.toHaveBeenCalled();
    expect(mocks.createObjectURL).not.toHaveBeenCalled();
    expect(clicked).toHaveLength(0);
  });

  it('does not create or click a blob URL when bytes finish decoding after the account changes',async()=>{
    const pending=deferred<Blob>();
    const raw=new Response('Synthetic private bytes');
    const decode=vi.spyOn(raw,'blob').mockReturnValue(pending.promise);
    let rawSignal:AbortSignal|undefined;
    mocks.fetch.mockImplementation((url:string,init:RequestInit)=>{
      if(url.endsWith('/raw')){rawSignal=init.signal as AbortSignal;return Promise.resolve(raw);}
      return Promise.resolve(Response.json({title:'Synthetic source record'}));
    });
    const view=renderDocument();
    await screen.findByText(/Synthetic source record/);
    fireEvent.click(screen.getByRole('button',{name:'원본 파일 받기'}));
    await waitFor(()=>expect(decode).toHaveBeenCalledTimes(1));
    mocks.token='synthetic-record-token-two';mocks.id='synthetic-admin-two';
    view.rerender(<OpsDocument id={documentId}/>);
    expect(rawSignal?.aborted).toBe(true);
    await act(async()=>{pending.resolve(new Blob(['Old identity bytes']));await pending.promise;});
    expect(mocks.createObjectURL).not.toHaveBeenCalled();
    expect(clicked).toHaveLength(0);
    expect(workspace.deny).not.toHaveBeenCalled();
  });

  it('downloads active authorized bytes with the record filename and revokes the blob URL',async()=>{
    const bytes=new Blob(['Synthetic active source bytes'],{type:'application/octet-stream'});
    const raw=new Response('Synthetic active source bytes');
    vi.spyOn(raw,'blob').mockResolvedValue(bytes);
    mocks.fetch.mockImplementation((url:string)=>Promise.resolve(url.endsWith('/raw')?raw:Response.json({title:'Synthetic source record'})));
    renderDocument();
    await screen.findByText(/Synthetic source record/);
    vi.useFakeTimers({toFake:['setTimeout','clearTimeout']});
    await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'원본 파일 받기'}));});
    expect(mocks.createObjectURL).toHaveBeenCalledOnce();
    expect(mocks.createObjectURL).toHaveBeenCalledWith(bytes);
    expect(clicked).toHaveLength(1);
    expect(clicked[0].href).toBe('blob:synthetic-private-source');
    expect(clicked[0].download).toBe(`source-${documentId}.bin`);
    expect(mocks.fetch).toHaveBeenLastCalledWith(expect.stringContaining(`${documentPath}/raw`),expect.objectContaining({headers:{Authorization:'Bearer synthetic-record-token-one'},credentials:'omit',cache:'no-store'}));
    expect(mocks.revokeObjectURL).not.toHaveBeenCalled();
    act(()=>vi.advanceTimersByTime(1000));
    expect(mocks.revokeObjectURL).toHaveBeenCalledWith('blob:synthetic-private-source');
    expect(workspace.deny).not.toHaveBeenCalled();
  });
});
