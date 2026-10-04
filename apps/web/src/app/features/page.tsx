import MarketingLayout,{Hero,SectionTitle,Card,ClosingBanner} from '@/components/marketing/layout';
export const metadata={title:'주요 기능',description:'관심종목, 포트폴리오, 타임라인과 근거 질문을 한 흐름에서 만나보세요.'};
const features=[
 {icon:'bars',title:'오늘의 변화',description:'시장과 주요 종목에 관련된 공시의 변화를 선별해 한눈에 보여드립니다.',href:'/today'},
 {icon:'star',title:'관심종목',description:'관심 있는 종목을 등록하고, 기업의 새 공시와 주요 이벤트를 연결해 확인하세요.',href:'/watchlist'},
 {icon:'pie',title:'포트폴리오',description:'보유종목을 관리하고 내 포트폴리오와 관련된 이벤트와 원문 근거를 살펴보세요.',href:'/portfolio'},
 {icon:'file',title:'기업 타임라인',description:'기업의 공시와 이벤트를 시간 순서로 정리해 이전과 현재의 흐름을 파악합니다.',href:'/timeline'},
 {icon:'search',title:'이벤트 상세 / 근거',description:'각 변화의 상세 내용과 사실, 비교, 해석을 읽고 연결된 원문 자료를 함께 확인합니다.',href:'/today'},
 {icon:'spark',title:'근거 질문',description:'공시 내용에 궁금한 점을 질문하고 확인 가능한 인용 근거와 함께 답변을 읽습니다.',href:'/questions'},
 {icon:'calendar',title:'캘린더',description:'확인된 공시 일정과 직접 등록한 일정을 캘린더에서 관리하고 다음 확인을 준비합니다.',href:'/calendar'},
 {icon:'bell',title:'알림',description:'관심종목과 관련된 새 이벤트와 알림 설정을 한곳에서 확인합니다.',href:'/alerts'},
] as const;
export default function Features(){return <MarketingLayout current="/features"><Hero eyebrow="FEATURES" title={<>흩어진 투자 정보를<br/>하나의 <em>근거 있는 흐름</em>으로.</>} description={<>SignalBrief는 기업의 공시와 원문 자료를 정리해,<br/>투자에 필요한 정보를 한곳에서<br/>체계적으로 확인하도록 돕습니다.</>} secondary={{href:'#demo',label:'데모 화면 보기'}} stats={[{value:'더 빠른 확인',label:'중요한 변화부터 탐색'},{value:'더 깊은 이해',label:'이전 자료와 근거 연결'},{value:'더 나은 판단',label:'내 종목 중심 정보'}]}/><div className="public-info-container public-info-content"><SectionTitle eyebrow="OUR FEATURES" title="투자를 더 스마트하게 만드는 핵심 기능" id="features">주요 기능을 통해 기업의 변화를 빠르게 파악하고,<br/>확인 가능한 근거와 함께 투자 정보를 탐색하세요.</SectionTitle><div className="public-info-grid cols-4">{features.map((feature,i)=><Card key={feature.href+feature.title} icon={feature.icon} title={feature.title} href={feature.href} protectedPage tone={i%2?'purple':'blue'}>{feature.description}</Card>)}</div><ClosingBanner title="지금, 더 스마트한 투자를 시작하세요." secondary={{href:'#features',label:'주요 기능 둘러보기'}}>SignalBrief의 기능을 직접 경험하고,<br/>내 종목의 변화와 원문 근거를 한 흐름에서 확인하세요.</ClosingBanner></div></MarketingLayout>;}
