import Link from 'next/link';
import type {ReactNode} from 'react';
import {Icon} from './icons';
import {Brand} from './marketing/layout';
import {DashboardPreview} from './marketing/actions';
import {SecurityArt,TrustItems,SourceCards} from './marketing/design';
export default function AuthLayout({children,recovery=false,mode='login'}:{children:ReactNode;recovery?:boolean;mode?:'login'|'signup'}) {
 return <main className={'auth-page auth-experience d-account '+(recovery?'is-recovery':mode==='signup'?'is-signup':'is-login')}>
 <div className="auth-top"><Brand/><Link href="/" className="auth-home"><Icon name="arrow" size={16}/>홈으로 돌아가기</Link></div>
 {!recovery&&<header className="d-account-intro"><p className="d-eyebrow">{mode==='signup'?'START YOUR CLEARER PERSPECTIVE':'WELCOME BACK'}</p><h1>{mode==='signup'?'내 종목의 변화, 더 선명하게.':'다시 만나 반갑습니다.'}</h1><p>{mode==='signup'?'무료 계정으로 나만의 브리핑을 시작하세요.':'로그인하고 내 종목의 새로운 변화를 이어서 확인하세요.'}</p></header>}
 <div className="auth-grid"><div className="auth-form-column">{children}</div>
 <aside className="auth-story" aria-label="SignalBrief 소개">{recovery?<><SecurityArt/><h2>안전하게 계정을<br/><em>다시 연결하세요.</em></h2><p>이메일로 받은 복구 링크에서 새 비밀번호를 설정할 수 있습니다.</p><Link className="d-card-link" href="/privacy#contact">도움이 필요하신가요? →</Link></>:<><p className="d-eyebrow">FACT · CHANGE · EVIDENCE</p><h2>내 종목의 변화,<br/><em>근거부터 확인.</em></h2><p>중요한 사실과 이전 자료의 차이를 읽고, 연결된 원문에서 확인하세요.</p><div className="d-phone-preview"><DashboardPreview/></div><Link href="/features" className="d-card-link">서비스 먼저 둘러보기 →</Link></>}</aside></div>
 <div className="d-account-benefits"><TrustItems/></div>{mode==='signup'&&!recovery&&<section className="d-account-sources"><h2>확인 가능한 출처에서 시작합니다.</h2><SourceCards compact/></section>}
 <div className="auth-page-footer"><span>© 2026 SignalBrief</span><Link href="/terms">서비스 이용 안내</Link><Link href="/privacy">개인정보처리방침</Link><Link href="/status">서비스 상태</Link></div></main>;
}
