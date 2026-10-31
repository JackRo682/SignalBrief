'use client';
import Link from 'next/link';
import {useEffect,useState} from 'react';
import {z} from 'zod';
import {useAuth} from '@/components/auth';
import {useResource} from '@/components/ui';
import {alertsSchema,alertSchema} from '@/lib/contracts';
import {body,emptySchema,request} from '@/lib/api';
import {typeLabels} from '@/lib/format';
import {useMobileAlertBadge} from '@/mobile/shell';
import {workspace} from './client';
import {contentNotificationsSchema} from './contracts';
import {usePrefs} from './preferences';
import {DataState,Empty,Modal,Notice,ResourceCard,useData,useMutation} from './ui';
import './monitoring.css';

type AlertRule=z.infer<typeof alertSchema>;
function EventRules(){
 const {token}=useAuth(),{text:t,value}=usePrefs(),rules=useResource('/v1/alerts',alertsSchema),action=useMutation();
 const [editor,setEditor]=useState<AlertRule|'new'|null>(null),[name,setName]=useState(''),[threshold,setThreshold]=useState(.4),[types,setTypes]=useState<string[]>([]),[enabled,setEnabled]=useState(true);
 function edit(rule?:AlertRule){setEditor(rule??'new');setName(rule?.name??'');setThreshold(rule?.min_score??.4);setTypes(rule?.event_types??[]);setEnabled(rule?.enabled??true);}
 return <section className="sb-monitor-card"><header className="sb-monitor-toolbar"><h2>{t('검토된 이벤트 알림 규칙','Reviewed-event alert rules')}</h2><button className="sb-monitor-button" disabled={rules.loading||!rules.data||rules.data.length>=20} onClick={()=>edit()}>{t('규칙 추가','Add rule')}</button></header><p>{t('이 규칙은 검토된 이벤트에 적용됩니다. 공시 분석 알림은 관심 기업과 알림 설정을 따릅니다.','These rules apply to reviewed events. Disclosure analysis alerts follow your watchlist and notification settings.')}</p><Notice action={action}/><DataState loading={rules.loading} error={rules.error??''} retry={rules.reload}/>
 <div className="sb-monitor-result-list">{rules.data?.map(rule=><article className="sb-monitor-rule" key={rule.id}><button className="sb-monitor-rule-name" onClick={()=>edit(rule)}>{rule.name}</button><span>{Math.round(rule.min_score*100)} / 100 · {rule.event_types.length?rule.event_types.map(type=>value.locale==='ko'?typeLabels[type]??type:type).join(', '):t('전체 유형','All types')}</span><button className="sb-monitor-button" role="switch" aria-label={`${rule.name} ${t('사용','enabled')}`} aria-checked={rule.enabled} disabled={action.busy} onClick={()=>void action.run(async()=>{await request(`/v1/alerts/${rule.id}`,token,alertSchema,body('PUT',{name:rule.name,event_types:rule.event_types,min_score:rule.min_score,enabled:!rule.enabled}));rules.reload();})}>{rule.enabled?t('켜짐','On'):t('꺼짐','Off')}</button><button className="sb-monitor-button" disabled={action.busy} aria-label={`${rule.name} ${t('삭제','delete')}`} onClick={()=>void action.run(async()=>{await request(`/v1/alerts/${rule.id}`,token,emptySchema,body('DELETE'));rules.reload();})}>{t('삭제','Delete')}</button></article>)}</div>
 {rules.data&&!rules.data.length&&<Empty title={t('등록한 이벤트 규칙이 없습니다.','No reviewed-event rules yet.')}/>}
 {editor&&<Modal title={editor==='new'?t('이벤트 알림 규칙 추가','Add event alert rule'):t('이벤트 알림 규칙 수정','Edit event alert rule')} onClose={()=>setEditor(null)}><Notice action={action}/><form className="sb-monitor-rule-form" onSubmit={event=>{event.preventDefault();void action.run(async()=>{await request(editor==='new'?'/v1/alerts':`/v1/alerts/${editor.id}`,token,alertSchema,body(editor==='new'?'POST':'PUT',{name:name.trim(),min_score:threshold,event_types:types,enabled}));setEditor(null);rules.reload();});}}><label>{t('규칙 이름','Rule name')}<input required maxLength={100} value={name} onChange={event=>setName(event.target.value)}/></label><label>{t('중요도 기준','Importance threshold')} · {Math.round(threshold*100)} / 100<input type="range" min={0} max={1} step={.05} value={threshold} onChange={event=>setThreshold(Number(event.target.value))}/></label><fieldset><legend>{t('이벤트 유형','Event types')}</legend>{Object.entries(typeLabels).map(([key,label])=><label key={key}><input type="checkbox" checked={types.includes(key)} onChange={event=>setTypes(current=>event.target.checked?[...current,key]:current.filter(type=>type!==key))}/>{value.locale==='ko'?label:key}</label>)}</fieldset><p>{t('유형을 선택하지 않으면 전체 유형에 적용합니다. 중요도는 예상 수익률이 아닙니다.','Selecting no type includes all types. Importance is not an expected investment return.')}</p><label><input type="checkbox" checked={enabled} onChange={event=>setEnabled(event.target.checked)}/>{t('규칙 사용','Enable rule')}</label><button className="sb-monitor-button primary" disabled={action.busy||!name.trim()}>{t('규칙 저장','Save rule')}</button></form></Modal>}
 </section>;
}

export default function ContentAlerts(){
 const {token}=useAuth(),{text:t,date}=usePrefs(),data=useData({action:'content_notifications',p:{}},contentNotificationsSchema),action=useMutation(),badge=useMobileAlertBadge();
 const [unreadOnly,setUnreadOnly]=useState(false),[company,setCompany]=useState(''),[kind,setKind]=useState(''),[rules,setRules]=useState(false);
 useEffect(()=>{if(data.data)badge(data.data.unread_count);},[data.data,badge]);
 const reload=data.reload;
 useEffect(()=>{const refresh=()=>{if(document.visibilityState==='visible')reload();};const timer=setInterval(refresh,60000);window.addEventListener('focus',refresh);return()=>{clearInterval(timer);window.removeEventListener('focus',refresh);};},[reload]);
 const companies=[...new Map(data.data?.items.map(item=>[item.resource.company_id,item.resource.company_name])??[])];
 const shown=data.data?.items.filter(item=>(!unreadOnly||!item.read_at)&&(!company||item.resource.company_id===company)&&(!kind||(kind==='analysis'?item.resource.kind==='us_analysis'||item.resource.kind==='dart_analysis':item.resource.kind==='event')))??[];
 const mark=(id?:string)=>void action.run(async()=>{await workspace(token,{action:'content_notification_read',p:id?{id}:{all:true}},z.unknown());reload();window.dispatchEvent(new Event('signalbrief:content-updated'));});
 return <div className="sb-monitoring" data-screen="content-alerts"><header><div><h1>{t('알림','Notifications')}</h1><p>{t('관심 기업의 승인된 분석과 검토된 이벤트를 확인하세요.','Follow approved analyses and reviewed events from your watched companies.')}</p></div><Link className="sb-monitor-button" href="/settings/notifications">{t('알림 설정','Settings')}</Link></header><Notice action={action}/>
 <div className="sb-monitor-toolbar"><div className="sb-monitor-tabs"><button aria-pressed={!unreadOnly} onClick={()=>setUnreadOnly(false)}>{t('전체','All')}</button><button aria-pressed={unreadOnly} onClick={()=>setUnreadOnly(true)}>{t('읽지 않음','Unread')}{data.data?` (${data.data.unread_count})`:''}</button></div><label>{t('기업','Company')}<select value={company} onChange={event=>setCompany(event.target.value)}><option value="">{t('전체 기업','All companies')}</option>{companies.map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label><label>{t('자료 유형','Content type')}<select value={kind} onChange={event=>setKind(event.target.value)}><option value="">{t('전체 유형','All types')}</option><option value="analysis">{t('승인된 분석','Approved analyses')}</option><option value="event">{t('검토된 이벤트','Reviewed events')}</option></select></label><button className="sb-monitor-button" disabled={action.busy||!data.data?.unread_count} onClick={()=>mark()}>{t('모두 읽음으로 표시','Mark all read')}</button><button className="sb-monitor-button" disabled={data.loading} onClick={reload}>{t('새로고침','Refresh')}</button></div>
 <DataState {...data} retry={reload}/><div className="sb-monitor-result-list">{shown.map(item=><section key={item.id} className="sb-monitor-alert"><div className="sb-monitor-alert-state"><time dateTime={item.created_at}>{date(item.created_at)}</time><button className="sb-monitor-button" disabled={action.busy||!!item.read_at} onClick={()=>mark(item.id)} aria-label={`${item.resource.title} ${item.read_at?t('읽음','read'):t('읽음으로 표시','mark read')}`}>{item.read_at?t('읽음','Read'):t('읽음으로 표시','Mark read')}</button></div><ResourceCard item={item.resource} onOpen={()=>{if(!item.read_at)mark(item.id);}}/></section>)}</div>
 {data.data&&!shown.length&&!data.loading&&!data.error&&<Empty title={unreadOnly?t('읽지 않은 알림이 없습니다.','You are all caught up.'):t('조건에 맞는 알림이 없습니다.','No notifications match these filters.')} description={t('새 분석이나 이벤트가 게시되면 관심 기업과 알림 설정에 따라 표시됩니다.','New analyses and events appear according to your watchlist and notification settings.')}/>}
 {data.data?.items.length===100&&<p>{t('최근 알림 최대 100개를 표시합니다.','Showing up to 100 recent notifications.')}</p>}
 <button className="sb-monitor-button" aria-expanded={rules} onClick={()=>setRules(current=>!current)}>{t('이벤트 알림 규칙 관리','Manage event alert rules')}</button>{rules&&<EventRules/>}
 </div>;
}
