"use client";
import Link from "next/link";
import { useAuth } from "@/components/auth";
import { useResource,PageHeading,Loading,ErrorState,useAction,ActionNotice } from "@/components/ui";
import { jsonObjectSchema } from "@/lib/contracts";
import { API_URL } from "@/lib/api";
export default function OpsDocument({id}:{id:string}){const auth=useAuth(),action=useAction(),result=useResource(auth.me?.is_admin?`/v1/ops/documents/${encodeURIComponent(id)}`:null,jsonObjectSchema);
 if(!auth.me?.is_admin)return <ErrorState message="운영자 권한이 필요합니다."/>;
 async function download(){await action.run(async()=>{const response=await fetch(`${API_URL}/v1/ops/documents/${encodeURIComponent(id)}/raw`,{headers:{Authorization:`Bearer ${auth.token}`},credentials:"omit",cache:"no-store"});if(!response.ok)throw new Error("raw_download_failed");const url=URL.createObjectURL(await response.blob()),a=document.createElement("a");a.href=url;a.download=`source-${id}.bin`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});}
 return <><Link className="back-link" href="/ops">← 운영 콘솔</Link><PageHeading title="원문·출처·처리 이력" description="원본 파일은 브라우저에 실행 가능한 HTML로 렌더링하지 않습니다." actions={<button className="button secondary" disabled={action.busy} onClick={download}>원본 파일 받기</button>}/><ActionNotice action={action}/>{result.loading?<Loading/>:result.error?<ErrorState message={result.error} retry={result.reload}/>:<section className="panel"><pre className="document-json">{JSON.stringify(result.data,null,2)}</pre></section>}</>;
}
