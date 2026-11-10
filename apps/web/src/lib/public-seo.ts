import type {Metadata} from 'next';
export const SITE_ORIGIN='https://signalbrief.online';
export const publicPages=[
 {path:'/',title:'SignalBrief · 근거로 읽는 변화',description:'기업 공시와 공식 일정, 중요한 변화의 근거를 한곳에서 확인하세요.'},
 {path:'/features',title:'기능 소개',description:'기업 공시 탐색, 관심기업 모니터링, 공식 일정과 근거 확인 기능을 살펴보세요.'},
 {path:'/about',title:'서비스 소개',description:'공식 자료와 확인 가능한 근거를 중심으로 기업의 변화를 읽는 SignalBrief를 소개합니다.'},
 {path:'/pricing',title:'요금 안내',description:'SignalBrief의 이용 범위와 요금 안내를 확인하세요.'},
] as const;
export function publicMetadata(path:string):Metadata{
 const page=publicPages.find(p=>p.path===path);if(!page)throw new Error('Unknown public page');
 const url=SITE_ORIGIN+page.path;
 return {title:path==='/'?{absolute:page.title}:page.title,description:page.description,alternates:{canonical:url},robots:{index:true,follow:true},openGraph:{type:'website',locale:'ko_KR',siteName:'SignalBrief',url,title:page.title,description:page.description},twitter:{card:'summary',title:page.title,description:page.description}};
}
