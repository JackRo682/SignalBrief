export const marketingNav = [
  {href:'/about',label:'서비스 소개'},
  {href:'/features',label:'주요 기능'},
  {href:'/sources',label:'데이터 출처'},
  {href:'/pricing',label:'요금제'},
  {href:'/customers',label:'고객 사례'},
  {href:'/privacy',label:'개인정보'},
] as const;
export type MarketingRoute = '/' | typeof marketingNav[number]['href'];
