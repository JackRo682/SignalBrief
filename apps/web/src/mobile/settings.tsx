'use client';
import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {useEffect,useState} from 'react';
import {z} from 'zod';
import {useAuth} from '@/components/auth';
import {usePrefs} from '@/workspace/preferences';
import {useIdentity} from '@/workspace/account';
import {useMutation} from '@/workspace/ui';
import {MIcon,LoadState,ActionNotice,Dialog} from '@/mobile/ui';
import './collections.css';

const releaseSchema=z.object({release:z.string(),commit:z.string().nullable().optional(),branch:z.string().nullable().optional()});
type Release=z.infer<typeof releaseSchema>;
function GoogleMark(){return <svg viewBox="0 0 48 48" width="34" height="34" aria-hidden="true"><path fill="#4285f4" d="M44.5 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h11.5a9.8 9.8 0 0 1-4.3 6.5v5.4h6.9c4-3.7 6.4-9.2 6.4-15.9Z"/><path fill="#34a853" d="M24 45c5.8 0 10.8-1.9 14.4-5.2l-7-5.4c-1.9 1.3-4.3 2.1-7.4 2.1-5.6 0-10.4-3.8-12.1-8.9H4.7v5.6A21.7 21.7 0 0 0 24 45Z"/><path fill="#fbbc05" d="M11.9 27.6a13 13 0 0 1 0-7.2v-5.6H4.7a21.5 21.5 0 0 0 0 18.4l7.2-5.6Z"/><path fill="#ea4335" d="M24 11.5c3.3 0 6.2 1.1 8.5 3.3l6.3-6.3A21 21 0 0 0 24 3 21.7 21.7 0 0 0 4.7 14.8l7.2 5.6c1.7-5.1 6.5-8.9 12.1-8.9Z"/></svg>;}
export default function MobileSettings(){
 const auth=useAuth(),router=useRouter(),{text:t}=usePrefs(),identity=useIdentity(),action=useMutation(),[logout,setLogout]=useState(false),[about,setAbout]=useState(false),[release,setRelease]=useState<Release|null>(null),[releaseError,setReleaseError]=useState(false),[releaseRevision,setReleaseRevision]=useState(0);
 useEffect(()=>{const ctrl=new AbortController();let active=true;setReleaseError(false);fetch('/api/release',{cache:'no-store',signal:AbortSignal.any([ctrl.signal,AbortSignal.timeout(15000)])}).then(async response=>{if(!response.ok)throw new Error('unavailable');return releaseSchema.parse(await response.json());}).then(value=>{if(active)setRelease(value);}).catch(()=>{if(active)setReleaseError(true);});return()=>{active=false;ctrl.abort();};},[releaseRevision]);
 const providers=[...new Set(identity.user?.identities?.map(i=>i.provider)??[])];
 const entries=[
  {href:'/settings/account',icon:'person' as const,color:'blue',title:t('계정 정보','Account information'),description:t('프로필, 이메일, 개인정보를 관리할 수 있습니다.','Manage your profile, email and personal information.')},
  {href:'/settings/security',icon:'lock' as const,color:'purple',title:t('보안 및 로그인','Security and sign-in'),description:t('비밀번호, 2단계 인증 등 계정 보안을 설정할 수 있습니다.','Manage passwords, two-factor authentication and account security.')},
  {href:'/settings/notifications',icon:'bell' as const,color:'yellow',title:t('알림 설정','Notification settings'),description:t('관심 종목, 주요 뉴스, 리포트 알림을 관리할 수 있습니다.','Manage company and important event notifications.')},
  {href:'/settings/appearance',icon:'monitor' as const,color:'green',title:t('화면 및 언어 설정','Appearance and language'),description:t('앱 테마, 언어 등 화면 표시 방식을 설정할 수 있습니다.','Choose your theme, language and display preferences.')},
  {href:'/help',icon:'help' as const,color:'blue',title:t('도움말 및 지원','Help and support'),description:t('자주 묻는 질문과 고객센터를 이용할 수 있습니다.','Browse frequently asked questions and contact support.')},
 ];
 return <div className="m-settings-page"><header className="m-settings-heading"><h1>{t('설정','Settings')}</h1><p>{t('나만의 투자 경험을 더 편리하게 설정하세요.','Make your investment research experience your own.')}</p></header><ActionNotice action={action}/><LoadState loading={!identity.user&&!identity.error} error={identity.error||undefined} retry={identity.reload}/>
 <Link className="m-card m-settings-profile" href="/settings/account"><span className="m-settings-avatar"><MIcon name="person" size={44}/></span><div><strong>{auth.me?.display_name??t('내 계정','My account')}{auth.me?.display_name?t('님',''):''}</strong><span>{identity.user?.email??t('이메일 확인 중','Loading email')}</span></div><MIcon name="chevron" size={22}/></Link>
 {providers.map(provider=><Link className="m-card m-settings-provider" href="/settings/security" key={provider}><span className="m-settings-icon blue">{provider==='google'?<GoogleMark/>:<MIcon name="shield" size={27}/>}</span><div><strong>{t('연결된 계정: ','Connected account: ')}{provider==='google'?'Google':provider==='email'?t('이메일','Email'):provider}</strong><p>{provider==='google'?t('Google 계정으로 간편하게 로그인되어 있습니다.','Your Google account is connected for sign-in.'):t('이 계정에 연결된 로그인 수단입니다.','This sign-in method is connected to your account.')}</p></div><span className="m-settings-connected">{t('연결됨','Connected')}</span></Link>)}
 <div className="m-settings-list">{entries.map(item=><Link className="m-card m-settings-row" key={item.href} href={item.href}><span className={`m-settings-icon ${item.color}`}><MIcon name={item.icon} size={27}/></span><div><strong>{item.title}</strong><p>{item.description}</p></div><MIcon name="chevron" size={21}/></Link>)}<button className="m-card m-settings-row" onClick={()=>setLogout(true)}><span className="m-settings-icon red"><MIcon name="logout" size={27}/></span><div><strong>{t('로그아웃','Sign out')}</strong><p>{t('현재 계정에서 로그아웃합니다.','Sign out of your account on this device.')}</p></div><MIcon name="chevron" size={21}/></button><button className="m-card m-settings-row" onClick={()=>setAbout(true)}><span className="m-settings-icon gray"><MIcon name="info" size={27}/></span><div><strong>{t('앱 정보','App information')}</strong><p>{release?`${release.release}${release.commit?` · ${release.commit.slice(0,7)}`:''}`:t('현재 배포 버전과 서비스 정보를 확인합니다.','View the current release and service information.')}</p></div><MIcon name="chevron" size={21}/></button></div>
 {logout&&<Dialog title={t('로그아웃할까요?','Sign out?')} onClose={()=>setLogout(false)}><ActionNotice action={action}/><p>{t('현재 기기의 로그인 세션을 종료합니다.','This ends your sign-in session on this device.')}</p><button className="m-button m-settings-logout" disabled={action.busy} onClick={()=>void action.run(async()=>{await auth.logout();router.replace('/login');})}>{action.busy?t('로그아웃 중…','Signing out…'):t('로그아웃','Sign out')}</button></Dialog>}
 {about&&<Dialog title={t('SignalBrief 앱 정보','About SignalBrief')} onClose={()=>setAbout(false)}><div className="m-settings-about"><strong>SignalBrief</strong><p>{t('세상의 신호를, 더 나은 투자로','A clearer view, grounded in evidence.')}</p>{release?<dl><dt>{t('배포 버전','Release')}</dt><dd>{release.release}</dd>{release.commit&&<><dt>{t('빌드','Build')}</dt><dd>{release.commit}</dd></>}</dl>:<LoadState loading={!releaseError} error={releaseError?t('배포 정보를 불러오지 못했습니다.','Could not load release information.'):undefined} retry={()=>setReleaseRevision(v=>v+1)}/>}<Link className="m-button-secondary" href="/help">{t('도움말 및 지원','Help and support')}<MIcon name="chevron" size={17}/></Link></div></Dialog>}
 </div>;
}
