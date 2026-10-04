import Link from 'next/link';
import MarketingLayout, {ClosingBanner} from '@/components/marketing/layout';
import {AccountLink, DashboardPreview} from '@/components/marketing/actions';
import {DesignCard, DesignFaq, DesignHeading, DesignHero, DesignSteps, SourceCards} from '@/components/marketing/design';
import {PricingPlans} from '@/components/marketing/interactive';

const features = [
  ['home','오늘의 변화','중요한 새 공시와 변화를 먼저 확인합니다.','/today'],
  ['pie','내 포트폴리오','보유종목과 관련된 근거를 한곳에서 읽습니다.','/portfolio'],
  ['spark','AI 브리핑','사실과 해석을 구분해 변화의 맥락을 살펴봅니다.','/today'],
  ['file','원문 근거','확인 가능한 인용과 원문 링크를 연결합니다.','/today'],
  ['timeline','기업 타임라인','이전 자료부터 지금까지의 흐름을 이어 봅니다.','/timeline'],
  ['search','근거 질문','선택한 공시의 인용 근거에 질문합니다.','/questions'],
] as const;
export default function Home() {
  return <MarketingLayout current="/">
    <DesignHero eyebrow="LESS NOISE. MORE CONTEXT." title={<>시장은 복잡해도,<br/>내 종목의 변화는<br/><em>선명하게.</em></>} art={<div className="d-phone-preview"><DashboardPreview/><div className="d-preview-footer"><AccountLink className="previewStart">내 관심종목으로 시작 <span aria-hidden="true">→</span></AccountLink><span>화면 예시 · 공개 베타 무료</span></div></div>} secondary={{href:'/login',label:'로그인'}}>
      무엇이 바뀌었는지, 왜 중요한지. 기업의 공시와 이전 자료를 연결해 확인 가능한 근거를 한곳에서 읽으세요.
    </DesignHero>
    <section className="d-band"><div className="public-info-container"><DesignHeading eyebrow="A CLEARER PERSPECTIVE" title="정보는 넘치는데, 내 종목의 변화는 찾기 어렵나요?">흩어진 소식부터 읽기보다, 확인할 변화와 원문 근거를 먼저 살펴보세요.</DesignHeading><div className="d-problems">{['중요한 변화가 소음에 묻혀요','내 종목에 미치는 맥락이 궁금해요','요약의 근거를 직접 확인하고 싶어요'].map((text,i)=><p key={text}><span>{i+1}</span>{text}</p>)}</div></div></section>
    <div className="public-info-container d-content">
      <section><DesignHeading eyebrow="OUR FEATURES" title="투자 정보를 읽는 여섯 가지 방법">종목을 모으고, 변화를 읽고, 원문에서 확인하세요.</DesignHeading><div className="d-card-grid">{features.map(([icon,title,copy,href])=><DesignCard key={title} icon={icon} title={title} href={href} protectedPage>{copy}</DesignCard>)}</div></section>
      <section><DesignHeading eyebrow="OUR SOURCES" title="출처부터 확인하는 정보">수집 상태와 제공 범위는 출처마다 다릅니다.</DesignHeading><SourceCards compact/><div className="d-center-link"><Link href="/sources">데이터 출처와 제공 범위 보기 →</Link></div></section>
      <section><DesignHeading eyebrow="HOW IT WORKS" title="나만의 브리핑, 네 단계로 시작하세요"/><DesignSteps/></section>
      <div className="d-home-bottom"><section><DesignHeading eyebrow="PRICING" title="부담 없이 시작하세요"/><PricingPlans compact/></section><section><DesignHeading eyebrow="EVERYDAY USE" title="이렇게 활용할 수 있어요"/>{[['매일의 확인','관심종목의 새 공시에서 중요한 사실부터 읽습니다.'],['내 종목의 맥락','포트폴리오와 관련된 변화를 타임라인에 연결합니다.'],['원문에서 확인','궁금한 내용을 질문하고 연결된 인용 근거를 읽습니다.']].map(([title,text])=><article className="d-use-quote public-info-card" key={title}><span className="d-avatar">{title.slice(0,1)}</span><div><h3>{title}</h3><p>{text}</p><small>서비스 활용 예시 · 실제 고객 후기가 아닙니다</small></div></article>)}<Link className="d-card-link" href="/customers">활용 흐름 더 보기 →</Link></section></div>
      <div className="landing-faq"><DesignFaq items={[{question:'무료로 이용할 수 있나요?',answer:<>현재 공개 베타는 무료이고 결제 정보를 요구하지 않습니다. <Link href="/pricing">요금제 확인</Link></>},{question:'종목 매수·매도를 추천하나요?',answer:'매매 추천이나 목표 주가를 제공하지 않습니다. 사실과 이전 대비 변화, 원문 근거를 읽고 스스로 판단하도록 돕습니다.'},{question:'내 보유종목 정보는 어떻게 처리하나요?',answer:<>계정별 접근 권한을 적용하며, 개인 보유 수량과 질문을 이용 통계로 보내지 않습니다. <Link href="/privacy">개인정보 안내</Link></>} ]}/></div>
      <ClosingBanner title="다음 변화는, 근거와 함께 읽으세요." secondary={{href:'/features',label:'주요 기능 살펴보기'}}>내 관심종목을 정리하고 중요한 변화를 차근차근 확인해 보세요.</ClosingBanner>
    </div>
  </MarketingLayout>;
}
