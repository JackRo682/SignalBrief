import type {Metadata} from 'next';
export const PUBLIC_ORIGIN='https://signalbrief.online';
export const publicPages={
 '/':['SignalBrief · 근거로 읽는 변화','공식 자료의 중요한 변화와 원문 근거를 한곳에서 확인하는 SignalBrief 공개 베타입니다.'],
 '/about':['서비스 소개','SignalBrief의 서비스 목적과 근거 중심 정보 확인 방식을 소개합니다.'],
 '/features':['주요 기능','관심 기업 업데이트, 원문 근거, 일정과 알림 등 SignalBrief의 주요 기능을 확인하세요.'],
 '/sources':['데이터 출처','SignalBrief가 사용하는 공식 데이터 출처와 수집·검토 범위를 확인하세요.'],
 '/pricing':['요금제 안내','SignalBrief 공개 베타의 이용 범위와 요금제 준비 상태를 확인하세요.'],
 '/customers':['활용 예시','SignalBrief를 활용하는 방법과 서비스 화면 예시를 살펴보세요.'],
 '/privacy':['개인정보처리방침','계정 정보와 선택적 방문 통계의 처리 범위, 보관 기간 및 동의 설정을 안내합니다.'],
 '/terms':['이용약관 안내','SignalBrief 공개 베타의 현재 이용 범위와 서비스 안내입니다.'],
 '/disclaimer':['서비스 이용 유의사항','SignalBrief 자료의 이용 범위와 오류·지연 등 유의사항을 확인하세요.'],
} as const;
export type PublicPath=keyof typeof publicPages;
export const publicIndexing=()=>process.env.VERCEL_ENV!=='preview'&&process.env.VERCEL_ENV!=='development';
export function publicMetadata(path:PublicPath):Metadata{
 const [title,description]=publicPages[path],url=new URL(path,PUBLIC_ORIGIN).href;
 return {title:path==='/'?{absolute:title}:title,description,alternates:{canonical:url},
  robots:{index:publicIndexing(),follow:publicIndexing()},
  openGraph:{type:'website',locale:'ko_KR',siteName:'SignalBrief',title,description,url},
  twitter:{card:'summary',title,description}};
}
