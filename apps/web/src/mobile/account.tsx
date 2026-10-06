'use client';

import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {useState,type ReactNode} from 'react';
import {z} from 'zod';
import {useAuth} from '@/components/auth';
import {useIdentity} from '@/workspace/account';
import {usePrefs} from '@/workspace/preferences';
import {useData,useMutation} from '@/workspace/ui';
import {accountSchema} from '@/workspace/contracts';
import {workspace,downloadJSON} from '@/workspace/client';
import {body,request} from '@/lib/api';
import {meSchema} from '@/lib/contracts';
import {ActionNotice,Dialog,LoadState,MIcon} from './ui';
import './account-security.css';

export function AccountIcon({name,tone='blue'}:{name:string;tone?:string}){
 return <span className={`m-account-icon tone-${tone}`} aria-hidden="true">{name==='google'?<span className="m-account-google">G</span>:<MIcon name={name} size={27}/>}</span>;
}
export function AccountRow({icon,tone,title,description,value,disabled,onClick,href}:{icon:string;tone?:string;title:string;description:string;value?:ReactNode;disabled?:boolean;onClick?:()=>void;href?:string}){
 const content=<><AccountIcon name={icon} tone={tone}/><span className="m-account-row-copy"><strong>{title}</strong><span>{description}</span>{value&&<small>{value}</small>}</span><MIcon name="chevron" size={21}/></>;
 return href?<Link className="m-card m-account-row" href={href}>{content}</Link>:<button type="button" className="m-card m-account-row" disabled={disabled} onClick={onClick}>{content}</button>;
}
export function AccountToggle({label,checked,disabled,onChange}:{label:string;checked:boolean;disabled?:boolean;onChange?:()=>void}){
 return <button type="button" className="m-account-switch" role="switch" aria-label={label} aria-checked={checked} disabled={disabled} onClick={onChange}><span/></button>;
}
export const providerName=(provider:string)=>provider==='google'?'Google':provider==='email'?'Email':provider;
const zones=[['Asia/Seoul','서울, 한국','Seoul, South Korea'],['America/New_York','뉴욕, 미국','New York, US'],['America/Los_Angeles','로스앤젤레스, 미국','Los Angeles, US'],['Europe/London','런던, 영국','London, UK'],['Europe/Berlin','베를린, 독일','Berlin, Germany'],['Asia/Tokyo','도쿄, 일본','Tokyo, Japan'],['Australia/Sydney','시드니, 호주','Sydney, Australia'],['UTC','세계 협정시','UTC']];

export default function MobileAccount(){
 const auth=useAuth(),router=useRouter(),prefs=usePrefs(),{text:t,value,date}=prefs,identity=useIdentity(),account=useData({action:'account',p:{}},accountSchema),action=useMutation();
 const [dialog,setDialog]=useState<'profile'|'timezone'|'language'|'privacy'|'logout'|null>(null),[name,setName]=useState(''),[bio,setBio]=useState('');
 const identityLoading=!identity.user&&!identity.error,zone=zones.find(([key])=>key===value.timezone),providers=identity.user?.identities??[];
 const close=()=>{if(!action.busy)setDialog(null);};
 const savePreference=(patch:Parameters<typeof prefs.save>[0])=>void action.run(async()=>{await prefs.save(patch);setDialog(null);},t('설정을 저장했습니다.','Settings saved.'));
 const exportData=()=>void action.run(async()=>{const data=await workspace(auth.token,{action:'export',p:{}},z.record(z.unknown()));downloadJSON(data,`SignalBrief-my-data-${new Date().toISOString().slice(0,10)}.json`);},t('내 데이터 파일을 만들었습니다.','Your data file is ready.'));
 return <div className="m-account-page"><h1 className="m-visually-hidden">{t('계정 정보','Account information')}</h1>
  <ActionNotice action={action}/><LoadState loading={!prefs.loaded&&!prefs.error} error={prefs.error||identity.error} retry={()=>{prefs.reload();identity.reload();}}/>
  <section className="m-card m-account-profile"><div className="m-account-profile-body"><span className="m-account-avatar" aria-hidden="true"><MIcon name="person" size={61}/></span><div><h2>{auth.me?.display_name}<span>{t('베타 사용자','Beta user')}</span></h2><p className="m-account-email">{identity.user?.email??t('이메일 확인 중','Checking email')}</p><p>{value.bio||t('한 줄 소개를 추가해 보세요.','Add a short introduction.')}</p></div></div><button type="button" disabled={!prefs.loaded||action.busy} onClick={()=>{setName(auth.me?.display_name??'');setBio(value.bio);setDialog('profile');}}>{t('프로필 수정','Edit profile')}</button></section>
  <div className="m-account-rows">
   <AccountRow icon="clock" tone="purple" title={t('시간대','Time zone')} description={t('알림, 캘린더, 일정이 표시되는 기준 시간대를 설정합니다.','Choose the time zone used for dates and notifications.')} value={zone?`${t(zone[1],zone[2])} · ${value.timezone}`:value.timezone} disabled={!prefs.loaded||action.busy} onClick={()=>setDialog('timezone')}/>
   <AccountRow icon="globe" tone="green" title={t('언어 및 지역 설정','Language and regional format')} description={t('앱에서 사용할 언어와 날짜·숫자 표시를 설정합니다.','Choose the app language and date/number format.')} value={value.locale==='ko'?'한국어 (대한민국)':'English (United States)'} disabled={!prefs.loaded||action.busy} onClick={()=>setDialog('language')}/>
   <AccountRow icon={providers.some(i=>i.provider==='google')?'google':'lock'} title={t('연결된 로그인 수단','Connected sign-in methods')} description={t('연결된 계정과 로그인 방법을 관리합니다.','Manage your connected accounts and sign-in methods.')} value={identityLoading?t('계정 확인 중','Checking account'):providers.length?providers.map(i=>providerName(i.provider)).join(' · '):t('연결된 로그인 수단 확인 필요','Sign-in methods unavailable')} href="/settings/security"/>
   <AccountRow icon="file" title={t('내 데이터 내보내기','Export my data')} description={t('저장된 관심종목, 기록, 설정 등의 데이터를 내보낼 수 있습니다.','Download your saved watchlist, history and account settings.')} disabled={action.busy} onClick={exportData}/>
   <AccountRow icon="logout" tone="red" title={t('로그아웃','Sign out')} description={t('현재 계정에서 로그아웃합니다.','Sign out of this account on this device.')} disabled={action.busy} onClick={()=>setDialog('logout')}/>
  </div>
  <aside className="m-account-info"><AccountIcon name="info"/><div><strong>{t('언어와 시간대는 알림과 캘린더에 반영됩니다.','Language and time zone apply to dates and notifications.')}</strong><p>{t('날짜만 알려진 공시는 원래 날짜를 유지합니다. 원문과 분석 내용은 작성된 언어로 표시됩니다.','Date-only filings retain their source date. Source text and analyses retain their original language.')}</p></div></aside>
  <button type="button" className="m-account-privacy-link" disabled={!prefs.loaded||action.busy} onClick={()=>setDialog('privacy')}>{t('개인정보 및 기록 설정','Privacy and history settings')}<MIcon name="chevron" size={14}/></button>

  {dialog==='profile'&&<Dialog title={t('프로필 수정','Edit profile')} onClose={close}><ActionNotice action={action}/><form onSubmit={e=>{e.preventDefault();void action.run(async()=>{if(!name.trim())throw new Error(t('이름을 입력해 주세요.','Enter your name.'));await prefs.save({bio});await request('/v1/me',auth.token,meSchema,body('PATCH',{display_name:name.trim()}));await auth.refresh();setDialog(null);},t('프로필을 저장했습니다.','Profile saved.'));}}><label>{t('이름','Display name')}<input autoFocus required maxLength={100} value={name} onChange={e=>setName(e.target.value)} disabled={action.busy}/></label><label>{t('한 줄 소개','Short bio')}<textarea maxLength={160} value={bio} onChange={e=>setBio(e.target.value)} disabled={action.busy}/></label><small>{bio.length} / 160</small><p className="m-account-dialog-note">{t('가입일','Joined')}: {date(account.data?.created_at??null,'date')}</p><button className="m-button" disabled={action.busy}>{t('저장','Save')}</button></form></Dialog>}
  {dialog==='timezone'&&<Dialog title={t('시간대','Time zone')} onClose={close}><ActionNotice action={action}/><div className="m-account-choices">{zones.map(([key,ko,en])=><button key={key} disabled={action.busy||prefs.busy} aria-pressed={value.timezone===key} onClick={()=>savePreference({timezone:key})}><span><strong>{t(ko,en)}</strong><small>{key}</small></span>{value.timezone===key&&<MIcon name="check"/>}</button>)}</div></Dialog>}
  {dialog==='language'&&<Dialog title={t('언어 및 지역 설정','Language and regional format')} onClose={close}><ActionNotice action={action}/><div className="m-account-choices">{(['ko','en'] as const).map(locale=><button key={locale} disabled={action.busy||prefs.busy} aria-pressed={value.locale===locale} onClick={()=>savePreference({locale})}><span>{locale==='ko'?'한국어 (대한민국)':'English (United States)'}</span>{value.locale===locale&&<MIcon name="check"/>}</button>)}</div><Link className="m-account-dialog-link" href="/settings/appearance">{t('화면 설정','Appearance')}<MIcon name="chevron" size={15}/></Link></Dialog>}
  {dialog==='privacy'&&<Dialog title={t('개인정보 및 기록 설정','Privacy and history settings')} onClose={close}><ActionNotice action={action}/><div className="m-account-privacy"><section><div><strong>{t('방문·검색 기록 저장','Save browsing and search history')}</strong><AccountToggle label={t('방문·검색 기록 저장','Save browsing and search history')} checked={value.history_enabled} disabled={action.busy||prefs.busy} onChange={()=>void action.run(()=>prefs.save({history_enabled:!value.history_enabled}),t('기록 설정을 저장했습니다.','History preference saved.'))}/></div><p>{t('최근 방문 100개와 검색어 10개를 저장합니다. 끄면 기존 방문·검색 기록도 삭제되며 북마크는 유지됩니다.','Save up to 100 visits and 10 searches. Turning this off also removes existing history; bookmarks are retained.')}</p></section><section><div><strong>{t('선택적 이용 통계','Optional analytics')}</strong><AccountToggle label={t('선택적 이용 통계','Optional analytics')} checked={!!auth.me?.analytics_consent} disabled={action.busy} onChange={()=>void action.run(async()=>{await request('/v1/me',auth.token,meSchema,body('PATCH',{analytics_consent:!auth.me?.analytics_consent}));await auth.refresh();},t('통계 동의를 저장했습니다.','Analytics preference saved.'))}/></div><p>{t('질문과 보유 수량은 통계로 보내지 않습니다.','Questions and holding quantities are not sent as analytics.')}</p></section><Link className="m-account-dialog-link" href="/help?category=privacy">{t('개인정보 삭제 / 계정 탈퇴 요청','Request data or account deletion')}<MIcon name="chevron" size={15}/></Link></div></Dialog>}
  {dialog==='logout'&&<Dialog title={t('로그아웃할까요?','Sign out?')} onClose={close}><ActionNotice action={action}/><p className="m-account-dialog-note">{t('현재 기기의 로그인 세션을 종료합니다.','End the session on this device.')}</p><button className="m-button m-account-danger" disabled={action.busy} onClick={()=>void action.run(async()=>{await auth.logout();router.replace('/login');})}>{t('현재 기기에서 로그아웃','Sign out on this device')}</button></Dialog>}
 </div>;
}
