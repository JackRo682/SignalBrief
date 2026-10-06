'use client';

import Link from 'next/link';
import {useEffect,useState,type ReactNode} from 'react';
import {useAuth} from '@/components/auth';
import {workspace} from '@/workspace/client';
import {catalogSchema,defaults,notificationsSettingsSchema} from '@/workspace/contracts';
import {usePrefs} from '@/workspace/preferences';
import {useData,useMutation} from '@/workspace/ui';
import {ActionNotice,CompanyLogo,Dialog,LoadState,MIcon} from '@/mobile/ui';
import './settings-notifications.css';

function PolicyIcon({name}:{name:string}){
 if(name==='moon')return <svg viewBox="0 0 24 24" width="25" height="25" fill="currentColor" aria-hidden="true"><path d="M20.8 15.8A9 9 0 0 1 8.2 3.2a9 9 0 1 0 12.6 12.6Z"/></svg>;
 if(name==='minus')return <svg viewBox="0 0 24 24" width="25" height="25" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="currentColor"/><path d="M7 12h10" stroke="white" strokeWidth="2.5"/></svg>;
 if(name==='bars')return <svg viewBox="0 0 24 24" width="25" height="25" fill="currentColor" aria-hidden="true"><rect x="3" y="14" width="4" height="8" rx="2"/><rect x="10" y="8" width="4" height="14" rx="2"/><rect x="17" y="2" width="4" height="20" rx="2"/></svg>;
 return <MIcon name={name} size={25}/>;
}
function PolicySwitch({label,checked,disabled,onChange}:{label:string;checked:boolean;disabled?:boolean;onChange:()=>void}){return <button type="button" className="mn-switch" role="switch" aria-label={label} aria-checked={checked} disabled={disabled} onClick={onChange}><span/></button>;}
function SettingCard({icon,tone,title,description,children,wide=false}:{icon:string;tone:string;title:string;description:string;children:ReactNode;wide?:boolean}){return <section className={`mn-card ${wide?'mn-wide':''}`}><span className={`mn-icon ${tone}`}><PolicyIcon name={icon}/></span><div className="mn-copy"><h2>{title}</h2><p>{description}</p></div><div className="mn-control">{children}</div></section>;}

export default function MobileNotifications(){
 const {token}=useAuth(),prefs=usePrefs(),{text:t,value}=prefs,action=useMutation();
 const settings=useData({action:'notifications',p:{}},notificationsSettingsSchema),companies=useData({action:'catalog',p:{kind:'company',limit:50}},catalogSchema);
 const [mute,setMute]=useState(false),[reset,setReset]=useState(false),[query,setQuery]=useState(''),[start,setStart]=useState(value.quiet_start),[end,setEnd]=useState(value.quiet_end),[threshold,setThreshold]=useState(.75),[cap,setCap]=useState(value.daily_cap);
 const search=useData(mute&&query.trim()?{action:'catalog',p:{kind:'company',q:query.trim(),limit:50}}:null,catalogSchema),catalog=query.trim()?search:companies;
 useEffect(()=>{setStart(value.quiet_start);setEnd(value.quiet_end);setCap(value.daily_cap);},[value.quiet_start,value.quiet_end,value.daily_cap]);
 useEffect(()=>{if(settings.data)setThreshold(settings.data.notify_min_score);},[settings.data]);
 const busy=action.busy||prefs.busy,ready=prefs.loaded&&!busy;
 const savedMessage=t('알림 설정을 저장했습니다.','Notification preferences saved.');
 const change=(patch:Parameters<typeof prefs.save>[0])=>void action.run(()=>prefs.save(patch),savedMessage);
 const baseChange=(p:{realtime_enabled?:boolean;notify_min_score?:number})=>void action.run(async()=>{await workspace(token,{action:'notification_save',p},notificationsSettingsSchema);settings.reload();},savedMessage);
 const thresholdText=(score:number)=>`${Math.round(score*100)} / 100 ${t('이상','or higher')}`;
 async function resetPolicy(){
  // Two existing stores have separate transactions. Reload the base policy even
  // if the preferences write fails, and never acknowledge an incomplete reset.
  await workspace(token,{action:'notification_save',p:{realtime_enabled:false,notify_min_score:.75}},notificationsSettingsSchema);
  settings.reload();
  try{await prefs.save({quiet_enabled:defaults.quiet_enabled,quiet_start:defaults.quiet_start,quiet_end:defaults.quiet_end,daily_cap:defaults.daily_cap,muted_companies:[]});}
  catch{throw new Error(t('앱 내 알림과 중요도는 초기화됐지만 나머지 정책은 저장하지 못했습니다. 다시 시도해 주세요.','In-app alerts and importance were reset, but the remaining preferences were not saved. Please retry.'));}
  setReset(false);
 }
 const summary=[
  {icon:'bell',tone:'blue',name:t('앱 내 알림','In-app alerts'),value:settings.data?(settings.data.realtime_enabled?t('사용 중','On'):t('꺼짐','Off')):'—'},
  {icon:'mail',tone:'purple',name:t('이메일 알림','Email alerts'),value:t('미제공','Unavailable')},
  {icon:'file',tone:'green',name:t('일간 요약 리포트','Daily digest'),value:t('미제공','Unavailable')},
  {icon:'shield',tone:'red',name:t('정정 / 철회 안내','Corrections'),value:t('분석 화면','On analysis')},
  {icon:'minus',tone:'red',name:t('알림 제외 기업','Muted companies'),value:prefs.loaded?`${value.muted_companies.length}${t('개','')}`:'—'},
  {icon:'bars',tone:'purple',name:t('중요도 임계값','Importance'),value:settings.data?thresholdText(settings.data.notify_min_score):'—'},
  {icon:'moon',tone:'green',name:t('방해 금지 시간','Quiet hours'),value:prefs.loaded?(value.quiet_enabled?`${value.quiet_start} – ${value.quiet_end}`:t('꺼짐','Off')):'—'},
  {icon:'bell',tone:'gold',name:t('일일 최대 알림 수','Daily alert cap'),value:prefs.loaded?`${value.daily_cap}${t('개',' / day')}`:'—'},
 ];
 return <div className="m-notification-settings"><h1 className="m-visually-hidden">{t('알림 설정','Notification settings')}</h1><p className="mn-intro">{t('관심 있는 소식을 더 빠르고 정확하게 받아보세요.','Receive the updates that matter to you.')}</p><ActionNotice action={action}/><LoadState loading={settings.loading||!prefs.loaded&&!prefs.error} error={settings.error||prefs.error} retry={()=>{settings.reload();prefs.reload();}}/>
  <div className="mn-settings-list">
   <SettingCard icon="bell" tone="blue" title={t('앱 내 알림','In-app alerts')} description={t('검토된 이벤트가 게시되면 앱 내 알림을 생성합니다.','Generate in-app alerts for reviewed events.')}><PolicySwitch label={t('앱 내 알림','In-app alerts')} checked={settings.data?.realtime_enabled??false} disabled={!settings.data||busy} onChange={()=>baseChange({realtime_enabled:!settings.data?.realtime_enabled})}/></SettingCard>
   <SettingCard icon="mail" tone="purple" title={t('이메일 알림','Email alerts')} description={t('메일 발송 서비스가 연결되면 제공됩니다.','Available when email delivery is connected.')}><PolicySwitch label={t('이메일 알림 — 미제공','Email alerts — unavailable')} checked={false} disabled onChange={()=>{}}/><small className="mn-unavailable">{t('현재 미제공','Unavailable')}</small></SettingCard>
   <SettingCard icon="file" tone="green" title={t('일간 요약 리포트','Daily digest')} description={t('예약 요약 발송은 현재 제공되지 않습니다.','Scheduled digests are not available.')}><div className="mn-segment" aria-label={t('일간 요약 발송 — 미제공','Daily digest — unavailable')}>{[t('안함','Off'),t('매일','Daily'),t('주 1회','Weekly')].map((label,i)=><button type="button" disabled aria-pressed={i===0} key={label}>{label}</button>)}</div></SettingCard>
   <SettingCard icon="shield" tone="red" title={t('정정 / 철회 안내','Corrections / withdrawals')} description={t('알림 설정과 관계없이 분석 화면에 표시됩니다.','Notices remain visible on the analysis screen.')}><span className="mn-status">{t('분석 화면에서 확인','On analysis')}</span></SettingCard>
   <SettingCard icon="minus" tone="red" title={t('알림 제외 기업','Muted companies')} description={t('선택 기업의 새 일반 알림을 생성하지 않습니다.','Do not generate new ordinary alerts for these companies.')} wide><div className="mn-chips">{value.muted_companies.map(id=>{const c=companies.data?.items.find(item=>item.id===id);return <button type="button" key={id} disabled={!ready} aria-label={`${c?.title??id} ${t('알림 제외 해제','unmute')}`} onClick={()=>change({muted_companies:value.muted_companies.filter(x=>x!==id)})}>{c?.ticker&&<CompanyLogo ticker={c.ticker} size={17}/>}<span>{c?.title??t('기업','Company')}</span><MIcon name="close" size={12}/></button>;})}<button type="button" className="mn-add" disabled={!ready||value.muted_companies.length>=50} onClick={()=>setMute(true)}><MIcon name="plus" size={14}/>{t('기업 추가하기','Add company')}</button></div></SettingCard>
   <SettingCard icon="bars" tone="purple" title={t('중요도 임계값','Importance threshold')} description={t('관련도 점수가 기준 이상인 알림을 생성합니다.','Generate alerts meeting the relevance threshold.')} wide><div className="mn-range"><label htmlFor="mn-threshold">{thresholdText(threshold)}</label><input id="mn-threshold" aria-label={t('중요도 임계값','Importance threshold')} aria-valuetext={thresholdText(threshold)} type="range" min="0" max="1" step="0.01" value={threshold} disabled={!settings.data||busy} style={{'--mn-fill':`${threshold*100}%`} as React.CSSProperties} onChange={e=>setThreshold(Number(e.target.value))}/><div className="mn-range-labels"><span>{t('낮음','Low')}</span><span>{t('보통','Medium')}</span><span>{t('높음','High')}</span><span>{t('매우 높음','Very high')}</span></div><button type="button" className="mn-apply" disabled={!settings.data||busy||threshold===settings.data.notify_min_score} onClick={()=>baseChange({notify_min_score:threshold})}>{t('기준 적용','Apply threshold')}</button></div></SettingCard>
   <SettingCard icon="moon" tone="green" title={t('방해 금지 시간','Quiet hours')} description={t('이 시간에는 새 일반 알림을 생성하지 않습니다.','Pause new ordinary alerts during these hours.')} wide><div className="mn-quiet"><div className="mn-quiet-top"><small>{value.timezone}</small><PolicySwitch label={t('방해 금지 시간','Quiet hours')} checked={value.quiet_enabled} disabled={!ready} onChange={()=>change({quiet_enabled:!value.quiet_enabled})}/></div><div className="mn-time-fields"><label><span>{t('시작 시간','Start')}</span><input aria-label={t('시작 시간','Start time')} type="time" value={start} disabled={!ready} onChange={e=>setStart(e.target.value)}/></label><span>–</span><label><span>{t('종료 시간','End')}</span><input aria-label={t('종료 시간','End time')} type="time" value={end} disabled={!ready} onChange={e=>setEnd(e.target.value)}/></label></div><button type="button" className="mn-apply" disabled={!ready||!start||!end||start===value.quiet_start&&end===value.quiet_end} onClick={()=>change({quiet_start:start,quiet_end:end})}>{t('시간 적용','Apply hours')}</button>{start===end&&<small className="mn-full-day">{t('같은 시간은 하루 종일 중단합니다.','Matching times pause the entire day.')}</small>}</div></SettingCard>
   <SettingCard icon="bell" tone="gold" title={t('일일 최대 알림 수','Daily alert cap')} description={t('선택한 시간대 기준 하루 알림 수를 제한합니다.','Limit new alerts per day in your time zone.')} wide><div className="mn-range"><label htmlFor="mn-cap">{cap}{t('개',' / day')}</label><input id="mn-cap" type="range" min="1" max="100" step="1" aria-label={t('일일 최대 알림 수','Daily alert cap')} value={cap} disabled={!ready} style={{'--mn-fill':`${(cap-1)/99*100}%`} as React.CSSProperties} onChange={e=>setCap(Number(e.target.value))}/><div className="mn-range-labels"><span>{t('1개','1')}</span><span>{t('100개','100')}</span></div><button type="button" className="mn-apply" disabled={!ready||cap===value.daily_cap} onClick={()=>change({daily_cap:cap})}>{t('최대 수 적용','Apply cap')}</button></div></SettingCard>
  </div>
  <section className="mn-summary"><header><span className="mn-icon blue"><PolicyIcon name="file"/></span><div><h2>{t('현재 알림 정책 요약','Current alert policy')}</h2><p>{t('저장된 설정이 아래와 같이 적용됩니다.','Your saved settings are applied below.')}</p></div><button type="button" disabled={!ready||!settings.data} onClick={()=>setReset(true)}><MIcon name="refresh" size={15}/>{t('설정 초기화','Reset')}</button></header><div className="mn-policy-grid">{summary.map(item=><div className="mn-policy-item" key={item.name}><span className={item.tone}><PolicyIcon name={item.icon}/></span><span>{item.name}</span><strong>{item.value}</strong></div>)}</div></section>
  <div className="mn-bottom-links"><Link href="/alerts">{t('알림 센터 / 규칙 관리','Alert center / rules')}<MIcon name="chevron" size={13}/></Link><Link href="/help?category=alerts">{t('알림 도움말','Notification help')}</Link></div><p className="mn-note">{t('일정 저장은 외부 푸시를 발송하지 않습니다. 방해 금지 시간에 제외된 일반 알림은 나중에 몰아서 보내지 않습니다.','Saved dates do not send external pushes. Ordinary alerts suppressed during quiet hours are not delivered later in a batch.')}</p>
  {mute&&<Dialog title={t('알림 제외 기업 추가','Mute a company')} onClose={()=>setMute(false)}><ActionNotice action={action}/><label className="m-field"><span>{t('기업 검색','Search companies')}</span><input value={query} maxLength={100} onChange={e=>setQuery(e.target.value)} placeholder={t('기업명 또는 종목코드','Company name or ticker')}/></label><LoadState loading={catalog.loading} error={catalog.error} retry={catalog.reload}/><div className="mn-mute-list">{catalog.data?.items.map(c=><button type="button" className="m-button m-button-secondary" key={c.id} disabled={!ready||value.muted_companies.includes(c.id)||value.muted_companies.length>=50} onClick={()=>void action.run(async()=>{await prefs.save({muted_companies:[...new Set([...value.muted_companies,c.id])]});setMute(false);},savedMessage)}><CompanyLogo ticker={c.ticker} size={28}/><span>{c.title} · {c.ticker}</span><MIcon name={value.muted_companies.includes(c.id)?'check':'plus'} size={16}/></button>)}</div>{!catalog.loading&&catalog.data&&!catalog.data.items.length&&<p className="m-muted">{t('검색 결과가 없습니다.','No companies found.')}</p>}</Dialog>}
  {reset&&<Dialog title={t('알림 정책 초기화','Reset notification policy')} onClose={()=>setReset(false)}><ActionNotice action={action}/><p>{t('앱 내 알림 끄기, 중요도 75 / 100, 방해 금지 끄기(22:00–07:00), 일일 최대 3개로 되돌리고 알림 제외 기업을 비웁니다.','Restore in-app alerts off, importance 75 / 100, quiet hours off (22:00–07:00), daily cap 3, and an empty muted-company list.')}</p><button className="m-button" disabled={busy} onClick={()=>void action.run(resetPolicy,t('알림 정책을 초기화했습니다.','Notification policy reset.'))}>{busy?t('저장 중…','Saving…'):t('초기화 적용','Apply reset')}</button></Dialog>}
 </div>;
}
