import Link from 'next/link';
import MarketingLayout,{ClosingBanner} from '@/components/marketing/layout';
import {SecurityArt} from '@/components/marketing/design';
import {LegalToc,LegalSection} from '@/components/marketing/legal';
const sections=[
 {id:'acceptance',title:'안내의 범위',summary:'현재 공개 베타의 이용 범위를 설명합니다.',detail:'이 페이지는 공개 베타 서비스 이용 안내입니다. 정식 이용약관과 운영 주체·연락처·적용 조건은 확정 후 별도로 게시할 예정입니다. 아직 확정되지 않은 법적 조건을 약정한 것으로 표시하지 않습니다.'},
 {id:'accounts',title:'계정과 로그인',summary:'이메일 또는 Google 계정으로 이용합니다.',detail:'Supabase 인증으로 계정을 관리합니다. 이메일 가입은 인증 메일의 안내를 따라 완료하며, 비밀번호 찾기에서 복구 메일을 요청할 수 있습니다. 공용 기기에서는 이용 후 로그아웃하세요.'},
 {id:'billing',title:'요금과 결제',summary:'현재 공개 베타는 무료이며 자동 결제가 없습니다.',detail:'유료 결제 기능은 연결되어 있지 않습니다. Pro·Pro+의 가격, 제공 범위와 시작 시점은 미정입니다. 향후 변경 시 가격과 조건을 먼저 안내하고 별도 신청 절차를 제공합니다.'},
 {id:'data',title:'자료의 제공 범위',summary:'수집과 검토가 완료된 출처를 기준으로 제공합니다.',detail:'현재 미국 기업 공시를 우선 연결하며 DART·KRX는 보류 중입니다. 공급자 사용 조건, 수집 및 검토 상태에 따라 제공 범위가 달라질 수 있습니다. 전체 시장의 실시간 정보 제공을 보장하지 않습니다.'},
 {id:'sources',title:'출처와 자료 이용',summary:'공식 원문과 제공자의 조건을 함께 확인하세요.',detail:'공개 자료의 원문 링크와 인용 근거를 제공합니다. 자료의 권리와 사용 조건은 해당 출처의 정책을 확인하세요. 출처 표시가 기관과의 제휴나 원문 권리의 이전을 뜻하지 않습니다.'},
 {id:'scope',title:'서비스의 성격',summary:'투자 정보 탐색과 근거 확인을 돕습니다.',detail:'매수·매도 추천, 목표주가 또는 수익 보장을 제공하지 않습니다. AI 해석은 오류나 누락 가능성이 있으므로 원문에서 확인하고 사실과 해석을 구분해 읽으세요.'},
 {id:'limitations',title:'자료와 운영의 한계',summary:'정보의 시점과 검토 상태를 확인하세요.',detail:'자료 수집이나 외부 제공자 연결이 지연될 수 있습니다. 근거가 부족하거나 충돌하는 자료는 검토 대상으로 취급합니다. 화면의 합성 예시는 실제 기업의 자료나 성과가 아닙니다.'},
 {id:'security',title:'계정과 자료 관리',summary:'다른 사람의 계정과 자료에 접근하지 마세요.',detail:'계정별 접근 권한을 적용합니다. 로그인 정보는 안전하게 관리하고, 앱의 인증이나 접근 제한을 우회하지 마세요. 자신의 종목·일정·동의 설정은 각 관리 화면에서 확인할 수 있습니다.'},
 {id:'changes',title:'변경 안내',summary:'공개 베타의 기능과 범위는 개선될 수 있습니다.',detail:'기능, 데이터 연결과 운영 안내가 변경되면 해당 화면과 서비스 상태 페이지에 반영합니다. 유료 요금제의 실제 조건은 확정 전까지 미정으로 표시합니다.'},
 {id:'privacy',title:'개인정보와 동의',summary:'개인정보 처리 안내와 선택적 동의 설정을 확인하세요.',detail:'처리 정보, 목적, 외부 제공자와 이용자 권리는 개인정보 안내에서 설명합니다. 선택적 이용 통계 동의는 설정에서 변경할 수 있습니다. 계정 삭제 등의 운영 접수 채널은 준비 중입니다.'},
 {id:'contact',title:'문의와 운영 안내',summary:'공식 문의 채널은 준비 중입니다.',detail:'운영 연락처와 접수 방법이 확정되면 개인정보 안내의 문의 항목에 게시합니다. 확인되지 않은 주소나 연락처를 문의 창구로 안내하지 않습니다.'},
] as const;
export const metadata={title:'서비스 이용 안내',description:'SignalBrief 공개 베타의 계정, 무료 이용, 출처와 서비스 범위를 안내합니다.'};
export default function Terms(){return <MarketingLayout current="/terms"><section className="d-legal-hero"><div className="public-info-container public-info-hero-grid"><div className="public-info-hero-copy"><p className="d-eyebrow">SERVICE GUIDE</p><h1>서비스 이용 안내</h1><p className="d-lead">공개 베타를 시작하기 전에 계정, 제공 범위와 운영 상태를 확인하세요.</p><span className="d-legal-date">안내 갱신 · 2026년 10월 4일</span><p className="d-legal-status">정식 이용약관은 준비 중입니다. 아래는 현재 서비스 이용 범위를 설명하는 안내입니다.</p></div><div className="public-info-hero-art"><SecurityArt/></div></div></section><div className="public-info-container d-content"><div className="d-legal-layout"><LegalToc items={sections}/><div>{sections.map((section,i)=><LegalSection key={section.id} {...section} number={i+1}><p>{section.detail}</p>{section.id==='privacy'&&<Link className="d-card-link" href="/privacy">개인정보 안내 보기 →</Link>}{section.id==='contact'&&<Link className="d-card-link" href="/privacy#contact">문의 안내 확인 →</Link>}{section.id==='data'&&<Link className="d-card-link" href="/status">현재 연결 상태 확인 →</Link>}</LegalSection>)}</div></div><ClosingBanner title="근거를 읽는 첫걸음을 시작하세요." secondary={{href:'/privacy',label:'개인정보 안내'}}>현재 제공 범위를 확인하고 나만의 브리핑을 시작해 보세요.</ClosingBanner></div></MarketingLayout>;}
