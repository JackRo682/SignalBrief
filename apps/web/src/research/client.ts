'use client';
import {useCallback,useEffect,useState} from 'react';
import {useAuth} from '@/components/auth';
import {researchRequest,responseSchema,type Row} from './contracts';
export async function research(token:string|null,action:string,p:Row={},signal?:AbortSignal):Promise<Row>{
 const payload=researchRequest.parse({action,p});
 const response=await fetch('/api/research',{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify(payload),cache:'no-store',signal:signal??AbortSignal.timeout(150000)});
 const data=await response.json();
 if(!response.ok){const code=data?.error?.code;const messages:Record<string,string>={admin_required:'관리자 권한이 필요합니다.',independent_reviewer_required:'등록자와 다른 관리자가 정답을 검수해야 합니다.',review_holdout_overlap:'검수용과 최종 평가용 데이터에 같은 공시를 사용할 수 없습니다.',dataset_frozen_create_new_version:'평가에 사용한 데이터셋은 변경할 수 없습니다. 새 데이터셋을 등록하세요.',approve_all_cases_max_20:'독립 검수자가 모든 사례를 승인해야 합니다. 실행당 최대 20건입니다.',consent_withdrawn_or_expired:'동의가 철회되었거나 보관 기간이 만료되었습니다.',study_not_found:'실험을 찾을 수 없습니다.',missing_openai_key:'AI 공급자 연결이 필요합니다.',daily_request_limit:'일일 공급자 호출 한도에 도달했습니다.',mfa_required:'추가 인증이 필요합니다.'};throw new Error(messages[code]??`요청을 완료하지 못했습니다 (${code??response.status}).`);}
 return responseSchema.parse(data);
}
export function useResearch(action:string,p:Row={},enabled=true){
 const {token}=useAuth(),[data,setData]=useState<Row|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[revision,setRevision]=useState(0);
 const key=JSON.stringify(p);const reload=useCallback(()=>setRevision(v=>v+1),[]);
 useEffect(()=>{if(!token||!enabled){setData(null);setLoading(false);return;}const controller=new AbortController();setLoading(true);setError('');research(token,action,JSON.parse(key),controller.signal).then(setData).catch(e=>{if(!controller.signal.aborted)setError(e.message);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});return()=>controller.abort();},[token,action,key,revision,enabled]);
 return {data,error,loading,reload};
}
