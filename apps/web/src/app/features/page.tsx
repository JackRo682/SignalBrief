import MarketingLayout, {ClosingBanner, Glyph} from '@/components/marketing/layout';
import {DashboardPreview, AccountLink} from '@/components/marketing/actions';
import {DesignCard, DesignHeading, DesignHero, TrustItems} from '@/components/marketing/design';
import {FeatureSample} from '@/components/marketing/interactive';
export const metadata={title:'주요 기능',description:'변화와 근거를 연결하는 SignalBrief의 기능을 직접 살펴보세요.'};
const features = [
 {kind:'today',icon:'home',title:'오늘의 변화',copy:'내 종목과 관련된 새 공시와 중요한 이벤트를 먼저 살펴보세요.',href:'/today'},
 {kind:'portfolio',icon:'pie',title:'관심종목',copy:'관심종목과 보유종목을 모아, 관련 자료를 한곳에서 확인하세요.',href:'/watchlist'},
 {kind:'summary',icon:'spark',title:'AI 브리핑',copy:'확인한 사실과 이전 대비 변화, 해석을 구분해 읽으세요.',href:'/today'},
 {kind:'sources',icon:'file',title:'출처·인용 근거',copy:'연결된 원문과 인용 근거에서 자료의 맥락을 확인하세요.',href:'/today'},
 {kind:'timeline',icon:'timeline',title:'기업 타임라인',copy:'시간 순서로 공시와 이벤트를 연결해 변화의 흐름을 살펴보세요.',href:'/timeline'},
 {kind:'questions',icon:'search',title:'근거 질문',copy:'선택한 공시에 질문하고 확인 가능한 인용 근거를 읽으세요.',href:'/questions'},
] as const;
export default function Features(){return <MarketingLayout current="/features">
 <DesignHero eyebrow="FEATURES" title={<>중요한 변화부터,<br/><em>원문 근거까지.</em></>} art={<div className="d-phone-preview"><DashboardPreview/></div>}>흩어진 공시, 종목과 일정을 하나의 흐름으로. 필요한 정보를 찾고 이전 자료와의 차이를 함께 확인하세요.</DesignHero>
 <div className="d-band"><div className="public-info-container"><DesignHeading eyebrow="BUILT AROUND YOUR COMPANIES" title="내 종목을 중심으로, 근거 있는 흐름을 만듭니다">확인할 사실과 해석을 나누고 원문을 연결합니다.</DesignHeading><TrustItems/></div></div>
 <div className="public-info-container d-content"><section><DesignHeading eyebrow="CORE FEATURES" title="눌러보고, 직접 확인하세요">아래 화면은 합성 예시입니다. 실제 데이터는 로그인 후 확인할 수 있습니다.</DesignHeading><div className="d-feature-grid">{features.map(feature=><article className="d-feature-card public-info-card" key={feature.kind}><span className="d-icon tone-blue"><Glyph name={feature.icon}/></span><h3>{feature.title}</h3><p>{feature.copy}</p><FeatureSample kind={feature.kind}/><AccountLink href="/login" destination={feature.href} ariaLabel={feature.title+' 자세히 보기'} className="d-card-link">자세히 보기 →</AccountLink></article>)}</div></section>
 <section><DesignHeading eyebrow="MORE WAYS TO STAY ORGANIZED" title="다음 확인도 편하게"/><div className="d-card-grid">{[['calendar','캘린더','확인된 일정과 직접 등록한 일정을 관리하세요.','/calendar'],['bell','알림','관심종목의 새 이벤트와 알림 설정을 확인하세요.','/alerts'],['settings','계정·설정','계정과 선택적 이용 통계 동의를 관리하세요.','/settings']].map(([icon,title,copy,href])=><DesignCard key={title} icon={icon as 'calendar'|'bell'|'settings'} title={title} href={href} protectedPage>{copy}</DesignCard>)}</div></section>
 <ClosingBanner title="지금, 내 종목의 변화를 읽어보세요." secondary={{href:'#demo',label:'데모 다시 보기'}}>사실과 이전 대비 변화, 확인 가능한 근거를 함께 살펴보세요.</ClosingBanner></div>
 </MarketingLayout>;}
