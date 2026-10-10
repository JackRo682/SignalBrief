'use client';
import {Loading,ErrorState} from '@/components/ui';
import type {useResearch} from './client';
export function Heading({tag,title,description,children}:{tag:string;title:string;description:string;children?:React.ReactNode}){return <header className="research-heading"><div><p>{tag}</p><h1>{title}</h1><span>{description}</span></div>{children}</header>;}
export function Panel({title,children,aside}:{title:string;children:React.ReactNode;aside?:React.ReactNode}){return <section className="research-panel"><header><h2>{title}</h2>{aside}</header>{children}</section>;}
export function Stat({label,value,note}:{label:string;value:React.ReactNode;note?:string}){return <div className="research-stat"><span>{label}</span><strong>{value}</strong>{note&&<small>{note}</small>}</div>;}
export function Empty({children='아직 수집된 데이터가 없습니다. 실제 기록이 생기면 표시됩니다.'}:{children?:React.ReactNode}){return <div className="research-empty"><span>◎</span><p>{children}</p></div>;}
export function State({resource,children}:{resource:ReturnType<typeof useResearch>;children:React.ReactNode}){return resource.loading?<Loading/>:resource.error?<ErrorState message={resource.error} retry={resource.reload}/>:<>{children}</>;}
export function Badge({value}:{value:unknown}){const labels:Record<string,string>={draft:'초안',running:'진행 중',paused:'일시 중지',completed:'완료',queued:'대기',failed:'실패',pending:'검수 대기',approved:'승인',rejected:'반려',held:'보류',review:'검수용',holdout:'최종 평가용',passed:'통과',blocked:'미검증',between:'참가자 간 A/B',crossover:'AB/BA 교차'};return <span className={`research-badge state-${String(value)}`}>{labels[String(value)]??String(value)}</span>;}
export function Field({label,children}:{label:string;children:React.ReactNode}){return <label className="research-field"><span>{label}</span>{children}</label>;}
export function Table({head,children}:{head:string[];children:React.ReactNode}){return <div className="research-table-wrap"><table className="research-table"><thead><tr>{head.map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{children}</tbody></table></div>;}
