'use client';
import Link from 'next/link';
import {useEffect, useState} from 'react';
import {z} from 'zod';
import {useAuth} from '@/components/auth';
import {Icon} from '@/components/icons';
import {workspace} from '@/workspace/client';
import {resourceHref, safeSource, type Resource, sourceOverviewSchema} from '@/workspace/contracts';
import {usePrefs} from '@/workspace/preferences';
import {useMutation, Notice} from '@/workspace/ui';
import './research-workspace.css';

const saveResult=z.object({saved:z.boolean()});
type CalendarEntry=z.infer<typeof sourceOverviewSchema>['calendar'][number];
export function ResearchResourceCard({item,onSaved}:{item:Resource;onSaved?:()=>void}){
 const {token}=useAuth(),{text:t,date}=usePrefs(),action=useMutation();
 const [saved,setSaved]=useState(item.is_saved);
 useEffect(()=>setSaved(item.is_saved),[item.is_saved,item.id,item.kind]);
 const isAnalysis=item.kind==='us_analysis'||item.kind==='dart_analysis',isEvent=item.kind==='event',source=safeSource(item.source_url);
 return <article className="rw-resource">
  <div className="rw-resource-top"><span className={`rw-badge ${isAnalysis||isEvent?'rw-badge-analysis':''}`}>{isAnalysis?t('승인된 발췌 요약','Approved excerpt summary'):isEvent?t('게시된 변화 분석','Published event analysis'):t('공식 공시','Official disclosure')}</span><span>{item.category}</span></div>
  <h3><Link href={resourceHref(item)}>{item.title}</Link></h3>
  {item.summary&&<p className="rw-resource-summary">{item.summary}</p>}
  <div className="rw-resource-meta"><Link href={`/companies/${encodeURIComponent(item.company_id)}`}>{item.company_name} · {item.ticker}</Link><span>{t('원문 공시','Source date')}: <time dateTime={item.published_at??undefined}>{item.published_at?date(item.published_at,item.publication_precision):t('미제공','Unavailable')}</time></span>
   {isAnalysis&&<span>{t('분석 승인','Reviewed')}: {item.reviewed_at?date(item.reviewed_at):t('승인 시각 미기록','Review time not recorded')}</span>}
  </div>
  <div className="rw-resource-actions"><Link className="rw-text-link" href={resourceHref(item)}>{isAnalysis||isEvent?t('요약과 근거 보기','Read summary and evidence'):t('문서와 분석 보기','Open disclosure')} <Icon name="arrow" size={15}/></Link>{source&&<a href={source} target="_blank" rel="noopener noreferrer">{t('공식 원문','Official source')} ↗</a>}
   {item.kind!=='company'&&<button type="button" className="rw-save" aria-pressed={saved} disabled={action.busy} aria-label={`${item.title} ${saved?t('저장 취소','Unsave'):t('저장','Save')}`} onClick={()=>void action.run(async()=>{const response=await workspace(token,{action:'save',p:{kind:item.kind as Exclude<Resource['kind'],'company'>,id:item.id,saved:!saved}},saveResult);setSaved(response.saved);onSaved?.();})}><Icon name="star" size={16}/>{saved?t('저장됨','Saved'):t('저장','Save')}</button>}
  </div><Notice action={action}/>
 </article>;
}
export function ResearchResources({items,empty,onSaved}:{items:Resource[];empty:string;onSaved?:()=>void}){
 return items.length?<div className="rw-resource-list">{items.map(item=><ResearchResourceCard item={item} key={`${item.kind}:${item.id}`} onSaved={onSaved}/>)}</div>:<p className="rw-empty">{empty}</p>;
}
export function VerifiedCalendar({items,empty}:{items:CalendarEntry[];empty:string}){
 const {text:t,date}=usePrefs();
 return items.length?<ul className="rw-calendar-list">{items.map(item=><li key={item.id}><time dateTime={item.occurs_on}>{date(item.occurs_on,'date')}</time><div><Link href={`/companies/${encodeURIComponent(item.company_id)}?tab=events`}>{item.title}</Link><small>{t('공식 출처 확인','Verified official source')}{item.source_timezone?` · ${item.source_timezone}`:''}</small>{safeSource(item.source_url)&&<a href={safeSource(item.source_url)} target="_blank" rel="noopener noreferrer">{t('일정 원문','Event source')} ↗</a>}</div></li>)}</ul>:<p className="rw-empty">{empty}</p>;
}
