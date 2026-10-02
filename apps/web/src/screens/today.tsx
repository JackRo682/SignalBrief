"use client";
import { useEffect,useState } from "react";
import Link from "next/link";
import { useAuth } from "@/components/auth";
import { useResource,Loading,ErrorState,Empty,EventTile,PageHeading,SourceLink } from "@/components/ui";
import { feedSchema,calendarSchema } from "@/lib/contracts";
import { dateText } from "@/lib/format";
export default function Today(){const [days,setDays]=useState(30),[offset,setOffset]=useState(0),{track}=useAuth();
 const feed=useResource(`/v1/feed?days=${days}&limit=12&offset=${offset}`,feedSchema),calendar=useResource("/v1/calendar",calendarSchema);
 useEffect(()=>{if(feed.data)for(const item of feed.data.items)track("brief_impression",{event_id:item.id,screen:"today"});},[feed.data,track]);
 return <><PageHeading eyebrow="YOUR DAILY SIGNAL" title="오늘, 내 종목의 중요한 변화" description="새로운 사실과 이전 근거를 비교해 읽습니다. 순위의 이유도 함께 확인하세요." actions={<label className="filter-select">기간<select value={days} onChange={e=>{setDays(Number(e.target.value));setOffset(0);}}><option value={7}>최근 7일</option><option value={30}>최근 30일</option><option value={90}>최근 90일</option></select></label>}/>
 <div className="stat-strip"><div><span>확인할 브리핑</span><strong>{feed.data?.total??"—"}<small>건</small></strong></div><div><span>근거 확인 원칙</span><strong>원문 우선</strong></div><div><span>최근 수집</span><strong className="stat-date">{feed.data?.latest_ingested_at?dateText(feed.data.latest_ingested_at):"아직 수집 전"}</strong></div></div>
 {feed.data?.stale&&<div className="notice">마지막 문서 수집이 72시간 이전입니다. 새 공시가 없거나 수집이 지연될 수 있으므로 최신 원문을 함께 확인하세요.</div>}
 {feed.data?.truncated&&<div className="notice">최신 1,000건 안에서 순위를 계산했습니다. 더 짧은 기간으로 좁혀 확인하세요.</div>}
 {feed.loading?<Loading/>:feed.error?<ErrorState message={feed.error} retry={feed.reload}/>:feed.data?.items.length?<div className="event-grid">{feed.data.items.map(item=><EventTile key={item.id} item={item}/>)}</div>:<Empty title="아직 표시할 변화가 없습니다."><p>관심종목을 추가하거나 공시 수집·검토가 끝난 뒤 다시 확인하세요.</p><Link className="button secondary" href="/watchlist">관심종목 관리</Link></Empty>}
 {(offset>0||feed.data?.has_more)&&<div className="pagination"><button className="button secondary" disabled={offset===0||feed.loading} onClick={()=>setOffset(v=>Math.max(0,v-12))}>이전</button><span>{Math.floor(offset/12)+1}페이지</span><button className="button secondary" disabled={!feed.data?.has_more||feed.loading} onClick={()=>setOffset(v=>v+12)}>다음</button></div>}
 <section className="upcoming"><div className="section-heading"><h2>다가오는 확인 포인트</h2><Link className="text-button" href="/calendar">캘린더 전체 보기 →</Link></div>{calendar.loading?<Loading/>:calendar.error?<ErrorState message={calendar.error} retry={calendar.reload}/>:calendar.data?.length?<div className="panel">{calendar.data.slice(0,4).map(item=><div className="list-row" key={item.id}><time className="date-pill">{item.occurs_on}</time><div className="grow"><strong>{item.title}</strong><p className="small muted">{item.origin==="user"?"직접 등록한 일정":"공시에서 확인한 날짜"}</p></div>{item.source_url&&<SourceLink url={item.source_url} demo={item.is_demo}/>}</div>)}</div>:<p className="muted">원문에서 확인된 미래 일정이 없습니다. 예상 날짜를 사실처럼 표시하지 않습니다.</p>}</section></>;
}
