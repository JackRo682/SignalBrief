'use client';

import Link from 'next/link';
import {useEffect,useRef,useState,type FormEvent} from 'react';
import {z} from 'zod';
import {useAuth} from '@/components/auth';
import {body,errorMessage,request} from '@/lib/api';
import {useEventAnalytics} from '@/lib/use-event-analytics';
import {answerSchema,detailSchema,type Answer,type EventDetail} from '@/lib/contracts';
import {workspace} from '@/workspace/client';
import {resourceSchema,safeSource} from '@/workspace/contracts';
import {usePrefs} from '@/workspace/preferences';
import {useData,useMutation} from '@/workspace/ui';
import {ActionNotice,CompanyLogo,Dialog,EmptyState,LoadState,MIcon,SectionTitle} from './ui';
import './event.css';

const fieldNames:Record<string,[string,string]>={
 revenue:['매출액','Revenue'],sales:['매출액','Revenue'],operating_income:['영업이익','Operating income'],
 operating_profit:['영업이익','Operating profit'],net_income:['순이익','Net income'],net_profit:['순이익','Net profit'],
 eps:['주당순이익','Earnings per share'],capex:['설비투자','Capital expenditure'],guidance:['가이던스','Guidance'],
 risk:['위험 요인','Risk factor'],dividend:['배당','Dividend'],management:['경영진','Management'],
};
const eventNames:Record<string,[string,string]>={earnings:['실적','Earnings'],guidance:['가이던스','Guidance'],capex:['투자 / 설비','Investment'],regulation:['규제 / 정책','Regulation'],management:['경영진','Management'],risk:['위험 요인','Risk'],other:['공시','Filing']};
type Source={id:string;title:string;url:string;provider:string;published_at:string;precision:string};

export default function MobileEvent({id}:{id:string}){
 return <EventContent key={id} id={id}/>;
}
function EventContent({id}:{id:string}){
 const {token}=useAuth(),{text:t,date,value}=usePrefs();
 const [detail,setDetail]=useState<EventDetail|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[revision,setRevision]=useState(0);
 const [saved,setSaved]=useState(false),[evidenceOpen,setEvidenceOpen]=useState(false),[askOpen,setAskOpen]=useState(false),[question,setQuestion]=useState(''),[answer,setAnswer]=useState<Answer|null>(null);
 const action=useMutation(),ask=useMutation(),evidenceRef=useRef<HTMLElement>(null);
 const engageEvidence=useEventAnalytics(detail?.event.id??null,evidenceOpen&&!!detail?.evidence.length);
 const resource=useData({action:'resource',p:{kind:'event',id}},resourceSchema);
 useEffect(()=>{setSaved(false);setAnswer(null);setQuestion('');setAskOpen(false);setEvidenceOpen(new URLSearchParams(window.location.search).get('panel')==='evidence');},[id]);
 useEffect(()=>{if(resource.data)setSaved(resource.data.is_saved);},[resource.data]);
 useEffect(()=>{
  setDetail(null);setError('');if(!token){setLoading(false);return;}
  const controller=new AbortController();let alive=true;setLoading(true);
  request(`/v1/events/${encodeURIComponent(id)}`,token,detailSchema,{signal:controller.signal})
   .then(data=>{if(alive)setDetail(data);}).catch(reason=>{if(alive)setError(errorMessage(reason));}).finally(()=>{if(alive)setLoading(false);});
  return()=>{alive=false;controller.abort();};
 },[id,token,revision]);
 useEffect(()=>{if(detail&&value.history_enabled)void workspace(token,{action:'visit',p:{kind:'event',id:detail.event.id}},z.unknown()).catch(()=>{});},[detail,token,value.history_enabled]);
 useEffect(()=>{if(detail&&evidenceOpen&&new URLSearchParams(window.location.search).get('panel')==='evidence')evidenceRef.current?.scrollIntoView({block:'start'});},[detail,evidenceOpen]);
 const label=(field:string)=>{const labels=fieldNames[field];return labels?t(...labels):field;};
 async function askQuestion(event:FormEvent){event.preventDefault();const q=question.trim();if(!q)return;await ask.run(async()=>{setAnswer(null);setAnswer(await request(`/v1/events/${encodeURIComponent(id)}/questions`,token,answerSchema,body('POST',{question:q})));});}
 const retry=()=>{setRevision(x=>x+1);resource.reload();};
 if(!detail)return <div className="m-event"><LoadState loading={loading} error={error} retry={retry}/>{!loading&&!error&&<EmptyState title={t('이벤트를 확인할 수 없습니다','Event not available')} href="/today" label={t('오늘의 변화로 이동','Open Today')}/>}</div>;
 const {event,brief,facts,changes,evidence,document:documentSource}=detail,company=event.company;
 const type=eventNames[event.event_type]??eventNames.other;
 const sources:Source[]=[...new Map< string,Source>([
  [documentSource.id,{id:documentSource.id,title:documentSource.title,url:documentSource.source_url,provider:documentSource.provider,published_at:documentSource.published_at,precision:documentSource.publication_precision}],
  ...evidence.map(item=>[item.document_id,{id:item.document_id,title:item.document_id===documentSource.id?documentSource.title:item.source_name,url:item.source_url,provider:item.source_name,published_at:item.published_at,precision:item.publication_precision}] as [string,Source]),
 ]).values()];
 const changeItems=changes.length?changes.slice(0,3).map(change=>{
  const fact=facts.find(item=>item.id===change.current_fact_id);
  const comparison=change.previous_value!==null?`${t('이전','Previous')} ${change.previous_value} → ${t('현재','Current')} ${change.current_value??t('원문 확인','View source')}`:change.current_value??fact?.quote??t('원문 확인','View source');
  return {id:change.id,title:`${label(change.field)} · ${comparison}`,description:fact?.quote??'',fact:change.current_fact_id};
 }):facts.length?facts.slice(0,3).map(fact=>({id:fact.id,title:`${label(fact.field)}${fact.value_raw!==null?` · ${fact.value_raw}${fact.unit?` ${fact.unit}`:''}`:''}`,description:fact.quote,fact:fact.id})):[{id:event.id,title:brief.what_happened||event.what_happened,description:'',fact:''}];
 const cards=[{icon:'trend' as const,title:t('기업에 미치는 영향','Why it matters'),text:brief.interpretation},{icon:'chip' as const,title:t('나와의 관련성','Relevance to me'),text:event.ranking.reason},{icon:'spark' as const,title:t('다음 확인 포인트','What to monitor'),text:brief.monitor_next}];
 return <article className="m-event">
  <header className="m-event-hero"><Link href={`/companies/${company.id}`} className="m-event-hero-logo" aria-label={`${company.name} ${t('기업 개요','Company overview')}`}><CompanyLogo ticker={company.ticker} size={64}/></Link><div className="m-event-identity"><div className="m-event-meta"><div className="m-event-hero-company"><Link href={`/companies/${company.id}`}>{company.name}</Link><span>{company.ticker}</span></div><div className="m-event-tags"><span>{t(...type)}</span><span>{t('공개된 분석','Published analysis')}</span><button aria-label={saved?t('이벤트 저장 취소','Unsave event'):t('이벤트 저장','Save event')} aria-pressed={saved} disabled={action.busy||resource.loading||!!resource.error} onClick={()=>void action.run(async()=>{const result=await workspace(token,{action:'save',p:{kind:'event',id:event.id,saved:!saved}},z.object({saved:z.boolean()}));setSaved(result.saved);},saved?t('저장을 취소했습니다.','Event unsaved.'):t('이벤트를 저장했습니다.','Event saved.'))}><MIcon name="bookmark" size={17}/></button></div></div><h1>{event.headline}</h1><time>{date(event.published_at,event.publication_precision)}</time></div></header>
  <ActionNotice action={action}/>{resource.error&&<div className="m-event-resource-error"><LoadState loading={false} error={resource.error} retry={resource.reload}/></div>}
  <section className="m-event-section"><SectionTitle title={t('무엇이 바뀌었나요?','What changed?')}/><div className="m-event-changes">{changeItems.map((item,index)=><div className="m-event-change" key={item.id}>{item.fact?<button type="button" className="m-event-number" aria-label={`${index+1}. ${item.title} · ${t('원문 근거 보기','View evidence')}`} aria-expanded={evidenceOpen} aria-controls="mobile-event-evidence" onClick={()=>{setEvidenceOpen(true);setTimeout(()=>document.getElementById(`mobile-evidence-${item.fact}`)?.scrollIntoView({block:'center'}),0);}}>{index+1}</button>:<span className="m-event-number">{index+1}</span>}<div><strong>{item.title}</strong>{item.description&&<p>{item.description}</p>}</div></div>)}</div></section>
  <section className="m-event-section"><SectionTitle title={t('왜 중요한가요?','Why is it important?')}/><div className="m-event-impact">{cards.map((card,index)=><div className={`m-event-impact-card tone-${index}`} key={card.title}><span className="m-event-impact-icon"><MIcon name={card.icon} size={24}/></span><h3>{card.title}</h3><p>{card.text||t('검토된 내용이 없습니다.','No reviewed information is available.')}</p></div>)}</div>{brief.uncertainty&&<p className="m-event-uncertainty"><MIcon name="info" size={15}/><span><strong>{t('불확실성','Uncertainty')}</strong> · {brief.uncertainty}</span></p>}</section>
  <div className="m-event-evidence-grid"><section className="m-event-section"><SectionTitle title={t('이전과 차이','Previous and current')}/><div className="m-event-comparison">{changes.length?<><div className="m-event-comparison-column"><h3>{t('이전 근거','Previous evidence')}</h3>{changes.slice(0,3).map(change=><div className="m-event-comparison-value" key={change.id}><span>{label(change.field)}</span><strong>{change.previous_value??t('비교 근거 없음','No comparison')}</strong></div>)}</div><span className="m-event-comparison-arrow" aria-hidden="true"><MIcon name="arrow" size={18}/></span><div className="m-event-comparison-column current"><h3>{t('현재 근거','Current evidence')}</h3>{changes.slice(0,3).map(change=><div className="m-event-comparison-value" key={change.id}><span>{label(change.field)}</span><strong>{change.current_value??t('원문 확인','View source')}{change.percentage_change!==null&&<small> ({change.percentage_change}%)</small>}</strong></div>)}</div></>:<p className="m-event-no-comparison">{t('비교 가능한 이전·현재 근거가 아직 없습니다.','Comparable previous and current evidence is not available.')}</p>}</div></section>
   <section className="m-event-section"><SectionTitle title={t('근거 / 출처','Evidence / sources')}/><div className="m-event-sources">{sources.map((source,index)=><div className="m-event-source" key={source.id}><span className={`m-event-source-icon source-${index%3}`}><MIcon name="file" size={22}/></span><div><Link href={`/documents/${source.id}?kind=document`} onClick={engageEvidence}>{source.title}</Link><p>{source.provider}</p><time>{date(source.published_at,source.precision)}</time></div>{safeSource(source.url)&&<a href={safeSource(source.url)} target="_blank" rel="noopener noreferrer" className="m-event-external" onClick={engageEvidence} aria-label={`${source.title} ${t('공식 원문 열기','Open original source')}`}><MIcon name="arrow" size={17}/></a>}</div>)}<button className="m-event-citations-button" aria-expanded={evidenceOpen} aria-controls="mobile-event-evidence" onClick={()=>setEvidenceOpen(x=>!x)}>{t('원문 인용 보기','View source quotes')} ({evidence.length}) <MIcon name="chevron" size={14}/></button></div></section></div>
  {evidenceOpen&&<section id="mobile-event-evidence" ref={evidenceRef} className="m-event-expanded-evidence"><SectionTitle title={t('원문 인용과 검증 근거','Quoted source evidence')} action={<button aria-label={t('원문 인용 닫기','Close source quotes')} onClick={()=>setEvidenceOpen(false)}><MIcon name="close" size={18}/></button>}/>{evidence.length?evidence.map((item,index)=><article key={`${item.fact_id}-${index}`} id={`mobile-evidence-${item.fact_id}`}><div><span>{item.role==='previous'?t('이전 근거','Previous evidence'):t('현재 근거','Current evidence')}</span><strong>{item.source_name}</strong></div><blockquote>{item.quote}</blockquote><footer><span>{item.location}</span>{safeSource(item.source_url)&&<a href={safeSource(item.source_url)} onClick={engageEvidence} target="_blank" rel="noopener noreferrer">{t('공식 원문','Original source')} ↗</a>}</footer></article>):<EmptyState title={t('표시할 검증 근거가 없습니다','No verified evidence to show')}/>}</section>}
  <section className="m-event-followup"><span className="m-event-ai-icon"><MIcon name="spark" size={25}/></span><div><h2>{t('더 궁금한 점이 있으신가요?','Have another question?')}</h2><p>{t('원문 근거에 대해 후속 질문을 해보세요.','Ask a follow-up about the source evidence.')}</p></div><button onClick={()=>setAskOpen(true)}>{t('AI 후속 질문하기','Ask a follow-up')} <MIcon name="chevron" size={16}/></button></section>
  {askOpen&&<Dialog title={t('AI 후속 질문','AI follow-up question')} onClose={()=>setAskOpen(false)}><div className="m-event-question-dialog"><p>{t('저장된 검증 근거에서 답을 찾습니다. 근거가 부족하면 그 한계를 표시합니다.','Answers use stored, verified evidence and show when it is insufficient.')}</p><div className="m-event-suggestions">{[t('이전 공시와 무엇이 달라졌나요?','What changed from the previous filing?'),t('매출 수치의 근거를 보여줘','Show the evidence for revenue'),t('위험 요인의 원문을 보여줘','Show the original risk factors')].map(text=><button key={text} disabled={ask.busy} onClick={()=>setQuestion(text)}>{text}</button>)}</div><form onSubmit={askQuestion}><label>{t('질문','Question')}<textarea required maxLength={2000} rows={3} value={question} onChange={e=>setQuestion(e.target.value)} disabled={ask.busy}/></label><button className="m-event-ask-submit" disabled={ask.busy||!question.trim()}>{ask.busy?t('근거 확인 중…','Checking evidence…'):t('질문 보내기','Send question')} <MIcon name="arrow" size={16}/></button></form><ActionNotice action={ask}/>{answer&&<section className="m-event-answer" aria-live="polite"><h3>{answer.status==='answered'?t('근거 검색 결과','Evidence search result'):t('확인 가능한 범위','Limits of available evidence')}</h3><p>{answer.message}</p>{answer.evidence.map((item,index)=><blockquote key={`${item.source_id}-${index}`}><p>{item.quote}</p>{safeSource(item.source_url)&&<a href={safeSource(item.source_url)} onClick={engageEvidence} target="_blank" rel="noopener noreferrer">{item.location||t('원문 근거','Source evidence')} ↗</a>}</blockquote>)}</section>}<Link href={`/questions?event=${encodeURIComponent(event.id)}`} className="m-event-text-link">{t('전체 대화와 기록 열기','Open conversation and history')} <MIcon name="chevron" size={13}/></Link></div></Dialog>}
 </article>;
}
