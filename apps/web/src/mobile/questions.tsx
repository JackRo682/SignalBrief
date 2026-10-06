'use client';
import Link from 'next/link';
import {useEffect,useState} from 'react';
import {useRouter,useSearchParams} from 'next/navigation';
import {z} from 'zod';
import {useAuth} from '@/components/auth';
import {useResource} from '@/components/ui';
import {useMutation} from '@/workspace/ui';
import {usePrefs} from '@/workspace/preferences';
import {safeSource} from '@/workspace/contracts';
import {answerSchema,detailSchema,feedSchema,type Answer} from '@/lib/contracts';
import {request,body,emptySchema} from '@/lib/api';
import {ActionNotice,EmptyState,LoadState,MIcon} from './ui';
import './research.css';

const historySchema=z.array(z.object({id:z.string(),event_id:z.string(),question:z.string(),answer:answerSchema,created_at:z.string()}));
type HistoryItem=z.infer<typeof historySchema>[number];
type LocalMessage={id:string;question:string;answer:Answer;knownIds:string[]};
function persistedMessage(message:LocalMessage,items:HistoryItem[]){
 return items.some(item=>!message.knownIds.includes(item.id)&&item.question===message.question&&JSON.stringify(item.answer)===JSON.stringify(message.answer));
}
export default function MobileQuestions({eventId=''}:{eventId?:string}){
 return <QuestionsContent key={eventId} eventId={eventId}/>;
}
function QuestionsContent({eventId}:{eventId:string}){
 const auth=useAuth(),router=useRouter(),{text:t,date}=usePrefs(),action=useMutation(),[question,setQuestion]=useState('');
 const selectedQuestion=useSearchParams().get('question')??'';
 const [localMessages,setLocalMessages]=useState<LocalMessage[]>([]),[clearedIds,setClearedIds]=useState<string[]>([]);
 const feed=useResource('/v1/feed?days=180&limit=100',feedSchema),history=useResource(auth.me?.demo_mode?null:'/v1/questions',historySchema),detail=useResource(eventId?`/v1/events/${encodeURIComponent(eventId)}`:null,detailSchema);
 const savedHistory=(history.data??[]).filter(item=>!clearedIds.includes(item.id));
 const selectedHistory=savedHistory.filter(item=>item.event_id===eventId).sort((a,b)=>Date.parse(a.created_at)-Date.parse(b.created_at)||a.id.localeCompare(b.id));
 const conversation=[...selectedHistory,...localMessages.filter(message=>!persistedMessage(message,selectedHistory))];
 const canAsk=detail.data?.event.id===eventId&&!detail.loading&&!detail.error&&!history.loading&&!action.busy;
 useEffect(()=>{if(!history.data)return;const saved=history.data.filter(item=>item.event_id===eventId);setLocalMessages(previous=>{const pending=previous.filter(message=>!persistedMessage(message,saved));return pending.length===previous.length?previous:pending;});},[eventId,history.data]);
 useEffect(()=>{if(selectedQuestion&&history.data?.some(item=>item.id===selectedQuestion&&item.event_id===eventId))document.getElementById(`mobile-question-${selectedQuestion}`)?.scrollIntoView({block:'center'});},[selectedQuestion,eventId,history.data]);
 function choose(id:string,questionId=''){const params=new URLSearchParams({event:id});if(questionId)params.set('question',questionId);router.replace(id?`/questions?${params}`:'/questions',{scroll:false});}
 function ask(){const sent=question.trim();if(!sent||!canAsk)return;const knownIds=savedHistory.map(item=>item.id);if(selectedQuestion)choose(eventId);void action.run(async()=>{const answer=await request(`/v1/events/${encodeURIComponent(eventId)}/questions`,auth.token,answerSchema,body('POST',{question:sent}));setLocalMessages(old=>[...old,{id:`pending-${crypto.randomUUID()}`,question:sent,answer,knownIds}]);setQuestion('');history.reload();});}
 return <div className="m-questions"><header className="m-page-heading"><h1>{t('AI 후속 질문','Evidence follow-up')}</h1><p>{t('선택한 이벤트의 확인 가능한 근거 안에서 질문하세요.','Ask questions within the evidence for a selected event.')}</p></header>
 <LoadState {...feed} retry={feed.reload}/><label className="m-field"><span>{t('질문할 이벤트','Event to ask about')}</span><select value={eventId} disabled={action.busy} onChange={e=>choose(e.target.value)}><option value="">{t('이벤트를 선택하세요','Choose an event')}</option>{detail.data&&!feed.data?.items.some(e=>e.id===eventId)&&<option value={eventId}>{detail.data.event.company.name} · {detail.data.event.headline}</option>}{feed.data?.items.map(e=><option value={e.id} key={e.id}>{e.company.name} · {e.headline}</option>)}</select></label>
 <LoadState {...detail} retry={detail.reload}/>{detail.data&&<section className="m-card m-question-context"><span className="m-pill">{detail.data.event.company.ticker}</span><h2>{detail.data.event.headline}</h2><p>{detail.data.event.what_happened}</p><Link href={`/events/${eventId}`}>{t('이벤트 상세 보기','Open event details')}<MIcon name="chevron" size={14}/></Link></section>}
 <ActionNotice action={action}/>
 {!eventId&&<EmptyState title={t('이벤트를 선택해 주세요','Select an event')} description={t('게시된 이벤트를 선택하면 관련 근거를 질문할 수 있어요.','Select a published event to ask about its evidence.')}/>}
 <div className="m-conversation" aria-live="polite">{conversation.map(message=><div key={message.id} id={`mobile-question-${message.id}`} className={selectedQuestion===message.id?'is-selected':''}><p className="m-question-user">{message.question}</p><article className="m-card m-question-answer"><span className="m-pill">{message.answer.status==='answered'?t('근거 검색 결과','Evidence result'):t('확인 가능한 범위','Available evidence')}</span><p>{message.answer.message}</p>{message.answer.evidence.map((e,j)=><section key={`${e.source_id}-${j}`}><blockquote>{e.quote}</blockquote>{safeSource(e.source_url)&&<a href={safeSource(e.source_url)} target="_blank" rel="noopener noreferrer">{e.location}<MIcon name="external" size={13}/></a>}</section>)}</article></div>)}</div>
 {eventId&&<><div className="m-question-suggestions">{[['이전 공시와 무엇이 달라졌나요?','What changed from the prior filing?'],['매출 수치의 근거를 보여줘','Show the evidence for revenue figures.'],['위험 요인의 원문을 보여줘','Show the source risk disclosures.']].map(([ko,en])=><button className="m-pill" type="button" key={ko} disabled={!canAsk} onClick={()=>setQuestion(t(ko,en))}>{t(ko,en)}</button>)}</div><form className="m-question-compose" onSubmit={e=>{e.preventDefault();ask();}}><label className="m-field"><span>{t('공시에 관한 질문','Question about the filing')}</span><textarea value={question} maxLength={2000} disabled={!canAsk} onChange={e=>setQuestion(e.target.value)} placeholder={t('어떤 근거가 궁금한가요?','What evidence would you like to explore?')}/></label><button className="m-button" disabled={!canAsk||!question.trim()}>{action.busy?t('근거 확인 중…','Checking evidence…'):t('질문 보내기','Send question')}<MIcon name="arrow" size={18}/></button></form><p className="m-note">{t('근거가 부족하면 확인할 수 없다고 안내합니다. 매매 추천과 목표주가는 제공하지 않습니다.','Insufficient evidence is stated explicitly. Responses do not provide trading recommendations or price targets.')}</p></>}
 <section className="m-question-history"><div className="m-section-title"><h2>{t('최근 질문 기록','Recent questions')}</h2><button type="button" disabled={action.busy||history.loading||!savedHistory.length} onClick={()=>{if(window.confirm(t('내 질문 기록을 모두 삭제할까요?','Delete all your question history?')))void action.run(async()=>{await request('/v1/questions',auth.token,emptySchema,body('DELETE'));setClearedIds(old=>[...new Set([...old,...savedHistory.map(item=>item.id)])]);setLocalMessages([]);history.reload();});}}>{t('기록 삭제','Clear history')}</button></div><LoadState {...history} retry={history.reload}/>{savedHistory.slice(0,20).map(item=><button className="m-card m-question-history-item" type="button" key={item.id} disabled={action.busy} onClick={()=>choose(item.event_id,item.id)}><strong>{item.question}</strong><span>{date(item.created_at)}</span><MIcon name="chevron" size={16}/></button>)}{history.data?.length===100&&<p className="m-note">{t('최근 100개 질문에서 선택한 이벤트의 대화를 표시합니다.','The conversation includes this event’s questions from the latest 100 saved questions.')}</p>}{!history.loading&&!history.error&&!savedHistory.length&&<p className="m-note">{t('저장된 질문이 없습니다.','No saved questions.')}</p>}</section>
 </div>;
}
