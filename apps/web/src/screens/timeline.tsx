"use client";
import { useState } from "react";
import { eventsSchema } from "@/lib/contracts";
import { useResource,PageHeading,Loading,ErrorState,Empty,EventTile } from "@/components/ui";
export default function Timeline({id}:{id:string}){const [offset,setOffset]=useState(0),result=useResource(`/v1/companies/${encodeURIComponent(id)}/timeline?limit=20&offset=${offset}`,eventsSchema);
return <><PageHeading eyebrow="COMPANY CHANGE TIMELINE" title={result.data?.[0]?.company.name??"기업 변화 타임라인"} description="게시된 공시 기반 변화를 시간순으로 확인합니다. 주가 변동의 원인을 단정하지 않습니다."/>{result.loading?<Loading/>:result.error?<ErrorState message={result.error} retry={result.reload}/>:result.data?.length?<div className="timeline-list">{result.data.map(item=><EventTile key={item.id} item={item}/>)}</div>:<Empty title="아직 게시된 변화가 없습니다."><p>문서 수집·추출·검증·검토를 통과한 이벤트가 여기에 나타납니다.</p></Empty>}<div className="pagination"><button className="button secondary" disabled={!offset||result.loading} onClick={()=>setOffset(v=>Math.max(0,v-20))}>이전</button><button className="button secondary" disabled={(result.data?.length??0)<20||result.loading} onClick={()=>setOffset(v=>v+20)}>다음</button></div></>;}
