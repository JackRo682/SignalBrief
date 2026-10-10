'use client';
import Link from 'next/link';
import {usePathname} from 'next/navigation';
import {useAuth} from '@/components/auth';
import {Loading,ErrorState} from '@/components/ui';
import './research.css';
const nav=[['/ops','운영 대시보드','01'],['/ops/analytics','사용자 행동 분석','02'],['/ops/experiments','A/B 실험 관리','03'],['/ops/evaluations','AI 평가 관리','04'],['/ops/quality','금융정보 품질 검수','05'],['/ops/reliability','장애·안전성 관리','06'],['/ops/reports','실험·평가 보고서','07']];
export default function ResearchShell({children}:{children:React.ReactNode}){
 const auth=useAuth(),path=usePathname();
 if(auth.loading)return <Loading/>;
 if(auth.error)return <ErrorState message={auth.error}/>;
 if(!auth.me)return <main className="research-login"><h1>SignalBrief Admin</h1><p>관리자 계정으로 로그인해 주세요.</p><Link href="/login" className="button primary">로그인</Link></main>;
 if(!auth.me.is_admin)return <main className="research-login"><ErrorState message="관리자만 접근할 수 있습니다. 서버에서도 권한을 검증합니다."/><Link href="/today">서비스로 돌아가기</Link></main>;
 return <div className="research-shell"><aside className="research-sidebar"><Link className="research-brand" href="/ops"><span>◈</span> SignalBrief <small>ADMIN / RESEARCH</small></Link><p className="research-nav-label">운영 및 검증</p><nav aria-label="관리자 메뉴">{nav.map(([href,label,index])=><Link key={href} href={href} className={(href==='/ops'?path===href:path.startsWith(href))?'selected':''} aria-current={(href==='/ops'?path===href:path.startsWith(href))?'page':undefined}><span>{index}</span>{label}</Link>)}</nav><div className="research-sidebar-bottom"><span className="research-live">● 실제 데이터 연결</span><p>측정할 수 있는 결과,<br/>확인할 수 있는 근거.</p><Link href="/today">← 일반 서비스로 돌아가기</Link></div></aside><div className="research-body"><header className="research-top"><span>INTERNAL WORKSPACE</span><span>{auth.me.display_name} <b>관리자</b></span></header><main className="research-main">{children}</main></div></div>;
}
