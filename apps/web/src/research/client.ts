'use client';

import {useCallback,useEffect,useRef,useState} from 'react';
import {useAuth} from '@/components/auth';
import {useOpsWorkspace} from '@/admin-logs/workspace-context';
import {researchRequest,responseSchema,type Row} from './contracts';

export class ResearchRequestError extends Error {
  constructor(message:string,readonly status:number,readonly code:string) {
    super(message);
    this.name='ResearchRequestError';
  }
}

const messages:Record<string,string>={
  admin_required:'관리자 권한이 필요합니다.',
  independent_reviewer_required:'등록자와 다른 관리자가 정답을 검수해야 합니다.',
  production_fault_test_forbidden:'운영 환경의 장애 주입은 허용되지 않습니다. 격리된 테스트 환경의 검증 근거를 기록해 주세요.',
  review_holdout_overlap:'검수용과 최종 평가용 데이터에 같은 공시를 사용할 수 없습니다.',
  dataset_frozen_create_new_version:'평가에 사용한 데이터셋은 변경할 수 없습니다. 새 데이터셋을 등록하세요.',
  approve_all_cases_max_20:'독립 검수자가 모든 사례를 승인해야 합니다. 실행당 최대 20건입니다.',
  consent_withdrawn_or_expired:'동의가 철회되었거나 보관 기간이 만료되었습니다.',
  study_not_found:'실험을 찾을 수 없습니다.',
  missing_openai_key:'AI 공급자 연결이 필요합니다.',
  daily_request_limit:'일일 공급자 호출 한도에 도달했습니다.',
  mfa_required:'추가 인증이 필요합니다.',
};

// These existing policy rejections deny one action, not administrator access.
const actionPolicyDenials=new Set(['independent_reviewer_required','production_fault_test_forbidden']);

export async function research(token:string|null,action:string,p:Row={},signal?:AbortSignal):Promise<Row>{
  const payload=researchRequest.parse({action,p});
  const response=await fetch('/api/research',{
    method:'POST',
    headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},
    body:JSON.stringify(payload),cache:'no-store',
    signal:signal?AbortSignal.any([signal,AbortSignal.timeout(150000)]):AbortSignal.timeout(150000),
  });
  // A proxy may return HTML for an expired session. Keep its status even then.
  const data=await response.json().catch(()=>null);
  if(!response.ok){
    const code=typeof data?.error?.code==='string'?data.error.code:'research_request_failed';
    throw new ResearchRequestError(messages[code]??`요청을 완료하지 못했습니다 (${response.status}).`,response.status,code);
  }
  return responseSchema.parse(data);
}

function useWorkspaceRef(){
  const workspace=useOpsWorkspace(),latest=useRef(workspace);
  useEffect(()=>{latest.current=workspace;},[workspace]);
  return {workspace,latest};
}

/** Scope mutation results and access failures to the account that started them. */
export function useResearchOperation(){
  const {token,me}=useAuth(),userId=me?.id;
  const {latest}=useWorkspaceRef();
  const active=useRef<{token:string|null;userId:string|undefined;active:boolean}>({token,userId,active:false});
  useEffect(()=>{
    const scope={token,userId,active:true};
    active.current=scope;
    return()=>{scope.active=false;};
  },[token,userId]);
  return useCallback(async <T,>(operation:()=>Promise<T>):Promise<T>=>{
    const scope=active.current;
    if(!scope.active||scope.token!==token||scope.userId!==userId)throw new DOMException('계정이 변경되어 이전 요청을 취소했습니다.','AbortError');
    try{
      const value=await operation();
      if(!scope.active||active.current!==scope)throw new DOMException('계정이 변경되어 이전 요청을 취소했습니다.','AbortError');
      return value;
    }catch(error){
      if(scope.active&&active.current===scope&&error instanceof ResearchRequestError&&(error.status===401||(error.status===403&&!actionPolicyDenials.has(error.code))))latest.current?.deny(error);
      throw error;
    }
  },[token,userId,latest]);
}

export function useResearchMutation(){
  const {token}=useAuth(),operation=useResearchOperation();
  return useCallback((action:string,p:Row={})=>operation(()=>research(token,action,p)),[token,operation]);
}

type ResearchState={identity:string;key:string;data:Row|null;error:string;loading:boolean};

export function useResearch(action:string,p:Row={},enabled=true){
  const {token,me}=useAuth(),{workspace,latest}=useWorkspaceRef();
  const identity=JSON.stringify([token,me?.id]),key=JSON.stringify([action,p]);
  const [state,setState]=useState<ResearchState>({identity:'',key:'',data:null,error:'',loading:true});
  const [revision,setRevision]=useState(0),refreshVersion=workspace?.refreshVersion??0;
  const reload=useCallback(()=>{
    if(latest.current)latest.current.refreshAll();
    else setRevision(value=>value+1);
  },[latest]);
  useEffect(()=>{
    if(!token||!enabled){setState({identity,key,data:null,error:'',loading:false});return;}
    const controller=new AbortController();
    setState({identity,key,data:null,error:'',loading:true});
    // Strict Mode cleanup can cancel the read before it reaches the server.
    void Promise.resolve().then(()=>{
      if(controller.signal.aborted)return;
      const [requestAction,params]=JSON.parse(key) as [string,Row];
      return research(token,requestAction,params,controller.signal)
        .then(data=>{if(!controller.signal.aborted)setState({identity,key,data,error:'',loading:false});})
        .catch((error:unknown)=>{
          if(controller.signal.aborted)return;
          setState({identity,key,data:null,error:error instanceof Error?error.message:'기록을 불러오지 못했습니다.',loading:false});
          if(error instanceof ResearchRequestError&&(error.status===401||error.status===403))latest.current?.deny(error);
        });
    });
    return()=>controller.abort();
  },[token,identity,key,revision,refreshVersion,enabled,latest]);
  const current=state.identity===identity&&state.key===key,ready=Boolean(token&&enabled);
  return {data:ready&&current?state.data:null,error:ready&&current?state.error:'',loading:ready&&(!current||state.loading),reload};
}
