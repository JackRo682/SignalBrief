'use client';
import Link from 'next/link';
import {usePathname, useRouter} from 'next/navigation';
import {useState} from 'react';
import {useAuth} from '@/components/auth';
import {Loading} from '@/components/ui';
import {signInLink} from '@/lib/auth-return';
import './research.css';

const nav=[['/ops','운영 현황','01']];

export default function ResearchShell({children}:{children:React.ReactNode}) {
  const auth=useAuth(),path=usePathname(),router=useRouter();
  const [busy,setBusy]=useState(false),[recoveryError,setRecoveryError]=useState('');
  const loginHref=signInLink(path);
  async function switchAccount() {
    if(busy)return;
    setBusy(true);setRecoveryError('');
    try{await auth.logout();router.replace(loginHref);}
    catch{setRecoveryError('로그아웃을 완료하지 못했습니다. 연결을 확인한 뒤 다시 시도해 주세요.');}
    finally{setBusy(false);}
  }
  async function retryAccess() {
    if(busy)return;
    if(!auth.token){window.location.reload();return;}
    setBusy(true);setRecoveryError('');
    try{await auth.refresh();}
    catch{setRecoveryError('계정 권한을 확인하지 못했습니다. 잠시 후 다시 시도하거나 다시 로그인해 주세요.');}
    finally{setBusy(false);}
  }
  if(auth.loading)return <Loading/>;
  if(auth.error||!auth.me||!auth.me.is_admin) {
    const denied=Boolean(auth.me&&!auth.me.is_admin);
    return <main className="research-login research-access" aria-busy={busy}>
      <span className="research-badge">SIGNALBRIEF ADMIN</span>
      <h1>{auth.error?'계정 연결을 확인해 주세요':denied?'관리자 권한이 필요합니다':'관리자 계정으로 로그인해 주세요'}</h1>
      <p role={auth.error||denied?'alert':undefined}>{auth.error?'인증 서비스에 연결하지 못했거나 세션을 확인할 수 없습니다. 사용자 로그는 표시하지 않습니다.':denied?'관리자만 접근할 수 있습니다. 현재 계정으로는 사용자 활동 로그와 관리자 화면을 열 수 없습니다.':'로그인이 만료되었거나 아직 로그인하지 않았습니다. 로그인 후 이 화면으로 돌아옵니다.'}</p>
      <div className="research-access-actions">
        {auth.token?<button type="button" className="button primary" disabled={busy} onClick={()=>void switchAccount()}>{busy?'처리 중…':'다른 계정으로 로그인'}</button>:<Link href={loginHref} className="button primary">로그인</Link>}
        {(auth.error||denied)&&<button type="button" className="button secondary" disabled={busy} onClick={()=>void retryAccess()}>권한 다시 확인</button>}
        <Link href="/today" className="button secondary">서비스로 돌아가기</Link>
      </div>
      {recoveryError&&<p className="notice danger" role="alert">{recoveryError}</p>}
      <details className="research-access-help"><summary>관리자 계정으로 접속할 수 없나요?</summary><p>평소 사용한 로그인 방식과 계정을 확인해 주세요. 이메일 로그인 비밀번호를 잊었다면 <Link href="/forgot-password">비밀번호를 재설정</Link>할 수 있습니다. Google 계정은 Google 로그인으로 다시 접속해 주세요.</p><p>등록된 관리자 계정인데 권한이 계속 없다면 프로젝트 소유자가 관리자 계정 등록 상태를 확인해야 합니다. 이 화면에서 권한을 자동으로 추가하지 않습니다.</p></details>
    </main>;
  }
  return <div className="research-shell"><aside className="research-sidebar"><Link className="research-brand" href="/ops"><span>◈</span> SignalBrief <small>ADMIN / LOGS</small></Link><p className="research-nav-label">운영</p><nav aria-label="관리자 메뉴">{nav.map(([href,label,index])=><Link key={href} href={href} className={(href==='/ops'?path===href:path.startsWith(href))?'selected':''} aria-current={(href==='/ops'?path===href:path.startsWith(href))?'page':undefined}><span>{index}</span>{label}</Link>)}</nav><div className="research-sidebar-bottom"><span className="research-live">● 실제 데이터 연결</span><p>측정할 수 있는 결과,<br/>확인할 수 있는 근거.</p><Link href="/today">← 일반 서비스로 돌아가기</Link></div></aside><div className="research-body"><header className="research-top"><span>INTERNAL WORKSPACE</span><span>{auth.me.display_name} <b>관리자</b></span></header><main className="research-main" key={`${auth.me.id}:${auth.token}`}>{children}</main></div></div>;
}
