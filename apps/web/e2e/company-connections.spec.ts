import {test,expect} from '@playwright/test';
import {mobileFixture,companyId,companyResources,eventId,fixtureNow} from './mobile-fixture';

// Synthetic, intercepted browser data only. No production account or provider calls.
test('company profile, sourced financials, DART filings and licensed chart states connect on both layouts',async({page},info)=>{
 const f=await mobileFixture(page),mobile=info.project.name==='mobile';
 const filing={...companyResources[0],id:'40000000-0000-4000-8000-000000000001',kind:'filing',title:'Synthetic Korean official filing',ticker:'123456',market:'KRX',category:'DART',source_url:'https://dart.fss.or.kr/dsaf001/main.do?rcpNo=20261019000001',publication_precision:'date',published_at:fixtureNow};
 await page.route('**/api/workspace',async route=>{
  const request=route.request().postDataJSON();if(request.action!=='company'){await route.fallback();return;}
  await route.fulfill({json:{company:{...companyResources[0],ticker:'123456',market:'KRX'},documents:[filing],events:[],facts:[{id:'synthetic-revenue',field:'revenue',value_raw:'12345678901234567890.12345678',unit:'KRW',period:'Synthetic FY2026',basis:'IFRS',quote:'Synthetic source quote',event_id:eventId}],watching:false,holding:false}});
 });
 await page.route('**/api/company-profile?**',route=>route.fulfill({json:{status:'verified',provider:'OpenDART',fetched_at:fixtureNow,source_url:'https://opendart.fss.or.kr/guide/main.do',profile:{corp_code:'12345678',ticker:'123456',name:'Synthetic Korean issuer',english_name:null,ceo:'Synthetic executive',address:null,website:null,established_on:null,industry_code:'1234',fiscal_month:'12'}}}));
 await page.goto(`/companies/${companyId}`);
 await expect(page.getByText('Synthetic executive')).toBeVisible();
 await expect(page.getByText('12,345,678,901,234,567,890.12345678')).toBeVisible();
 const source=page.getByRole('link',{name:/Synthetic Korean official filing/});
 await expect(source).toHaveAttribute('href',`/documents/${filing.id}?kind=filing`);
 await expect(page.getByRole('img',{name:mobile?'실제 종가 추이':'공급자 종가 추이'}).first()).toBeVisible();
 if(mobile)await page.getByRole('button',{name:'주가 차트 자세히 보기'}).click();
 else await page.getByRole('button',{name:'주가 차트',exact:true}).click();
 await expect(page.getByText(/Synthetic E2E quotes/).last()).toBeVisible();
 expect(f.state.unexpected).toEqual([]);expect(f.state.runtimeErrors).toEqual([]);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2)).toBe(true);
});

test('company chart explains missing public display authorization',async({page},info)=>{
 await mobileFixture(page);
 await page.route('**/api/market?**',route=>route.fulfill({json:{quotes:[],available:false,reason:'fmp_display_license_unverified'}}));
 await page.goto(`/companies/${companyId}`);
 await expect(page.getByText('미국 주가의 웹 표시 승인 대기 중입니다.').first()).toBeVisible();
 if(info.project.name==='desktop'){
  await page.getByRole('button',{name:'주가 차트',exact:true}).click();
  await expect(page.getByText('미국 주가의 웹 표시 승인 대기 중입니다.').last()).toBeVisible();
 }
});

// The provider is intercepted for this lifecycle test; no prices are fabricated in production.
test('external market fallback loads only when opened and retains its provider link',async({page})=>{
 await mobileFixture(page);
 await page.route('https://s3.tradingview.com/external-embedding/embed-widget-symbol-overview.js',route=>route.abort());
 await page.goto(`/companies/${companyId}`);
 const chart=page.getByRole('region',{name:'외부 시세 차트'});
 await expect(chart.locator('script')).toHaveCount(0);
 await chart.getByRole('button',{name:'외부 차트 불러오기'}).click();
 await expect(chart.getByText('차트를 불러오지 못했습니다. 공급자 링크에서 확인하세요.')).toBeVisible();
 await expect(chart.getByRole('link',{name:'TradingView에서 확인'})).toHaveAttribute('href',/^https:\/\/www\.tradingview\.com\/symbols\//);
 await expect(chart.getByRole('button',{name:'다시 시도'})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2)).toBe(true);
});
