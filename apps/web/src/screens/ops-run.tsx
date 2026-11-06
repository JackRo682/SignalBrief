"use client";
import { useAuth } from '@/components/auth';
import { Loading,ErrorState } from '@/components/ui';
import { Heading } from '@/research/ui';
import { useOperationRecord } from '@/admin-logs/record-client';
export default function OpsRun({id}:{id:string}){
 const auth=useAuth(),run=useOperationRecord(`/v1/ops/runs/${encodeURIComponent(id)}`);
 if(!auth.me?.is_admin)return <ErrorState message="운영자만 분석 실행 기록을 볼 수 있습니다."/>;
 return <><Heading tag="OPERATIONS / RUN" title="분석 실행 기록" description="실제 저장된 실행 결과입니다. 기록되지 않은 비용이나 오류 원인은 추정하지 않습니다."/>{run.loading?<Loading/>:run.error?<ErrorState message={run.error} retry={run.reload}/>:<section className="panel"><dl className="metadata">{Object.entries(run.data??{}).filter(([k])=>k!=='validation_result').map(([key,value])=><div key={key} style={{display:'contents'}}><dt>{key}</dt><dd>{value==null?'미기록':typeof value==='object'?JSON.stringify(value):String(value)}</dd></div>)}</dl><h3>검증 결과</h3><pre>{JSON.stringify(run.data?.validation_result??{},null,2)}</pre></section>}</>;
}
