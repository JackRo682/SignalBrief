"use client";
import Link from 'next/link';
import { useAuth } from '@/components/auth';
import { useResource,PageHeading,Loading,ErrorState } from '@/components/ui';
import { jsonObjectSchema } from '@/lib/contracts';
export default function OpsRun({id}:{id:string}){
 const auth=useAuth(),run=useResource(auth.me?.is_admin?`/v1/ops/runs/${encodeURIComponent(id)}`:null,jsonObjectSchema);
 if(!auth.me?.is_admin)return <ErrorState message="운영자만 분석 실행 기록을 볼 수 있습니다."/>;
 return <><PageHeading title="분석 실행 기록" description="실제 저장된 실행 결과입니다. 기록되지 않은 비용이나 오류 원인은 추정하지 않습니다." actions={<Link className="button secondary" href="/ops">Ops 콘솔로 돌아가기</Link>}/>{run.loading?<Loading/>:run.error?<ErrorState message={run.error} retry={run.reload}/>:<section className="panel"><dl className="metadata">{Object.entries(run.data??{}).filter(([k])=>k!=='validation_result').map(([key,value])=><div key={key} style={{display:'contents'}}><dt>{key}</dt><dd>{value==null?'미기록':String(value)}</dd></div>)}</dl><h2>검증 결과</h2><pre>{JSON.stringify(run.data?.validation_result??{},null,2)}</pre></section>}</>;
}
