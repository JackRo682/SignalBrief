import Link from 'next/link';
import type {ReactNode} from 'react';
import {Icon} from './icons';
import {Brand} from './marketing/layout';

export default function AuthLayout({children,recovery=false}:{children:ReactNode;recovery?:boolean}) {
 return <main className="auth-page auth-experience"><div className="auth-top"><Brand/><Link href="/" className="auth-home"><Icon name="arrow" size={16}/>홈으로 돌아가기</Link></div><div className="auth-grid">
  <aside className="auth-story" aria-label="SignalBrief 소개"><p className="public-info-eyebrow">YOUR NEXT CLEARER PERSPECTIVE</p><h1>{recovery?<>다시 연결하고,<br/><em>변화를 이어서.</em></>:<>내 종목의 변화,<br/><em>근거부터 확인.</em></>}</h1><p>흩어진 공시에서 중요한 변화를 읽고,<br/>이전과의 차이를 원문과 함께 살펴보세요.</p><div className="auth-evidence"><div className="auth-evidence-head"><span><Icon name="file" size={17}/>원문에서 브리핑까지</span><span>서비스 흐름</span></div>{[['file','FACT','무엇이 일어났는지','공식 자료에서 확인한 사실'],['timeline','CHANGE','이전과 무엇이 다른지','이전 자료와 현재 자료 비교'],['shield','EVIDENCE','어디에서 확인할 수 있는지','검토한 출처와 원문 연결']].map(([icon,label,title,description])=><div className="auth-evidence-row" key={label}><span className="auth-evidence-icon"><Icon name={icon as 'file'|'timeline'|'shield'}/></span><div><small>{label}</small><strong>{title}</strong><p>{description}</p></div><Icon name="check" size={18}/></div>)}</div><p className="auth-story-note"><Icon name="shield" size={16}/>공개 근거를 읽는 서비스 · 매매 추천 및 주가 예측을 제공하지 않습니다.</p><Link href="/features" className="public-info-card-link">서비스 먼저 둘러보기 <Icon name="arrow" size={16}/></Link></aside>
  <div className="auth-form-column">{children}</div>
 </div><div className="auth-page-footer"><span>© 2026 SignalBrief</span><Link href="/privacy">개인정보처리방침</Link><Link href="/status">서비스 상태</Link></div></main>;
}
