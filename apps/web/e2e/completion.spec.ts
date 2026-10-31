import {test,expect} from '@playwright/test';
import {mobileFixture,companyId,companyResources,fixtureNow} from './mobile-fixture';
test('company timeline shows official metadata independently of reviewed events',async({page})=>{
 const f=await mobileFixture(page),filing={...companyResources[0],id:'40000000-0000-4000-8000-000000000091',kind:'filing',title:'Synthetic original filing without AI review',published_at:fixtureNow,publication_precision:'date',source_url:'https://www.sec.gov/Archives/synthetic.htm'};
 await page.route('**/api/workspace',async route=>{if(route.request().postDataJSON().action!=='company'){await route.fallback();return;}await route.fulfill({json:{company:companyResources[0],documents:[filing],events:[],facts:[],watching:false,holding:false}});});
 await page.goto(`/companies/${companyId}/timeline`);const section=page.getByRole('region',{name:'공식 공시 이력'});await expect(section.getByRole('link',{name:filing.title})).toHaveAttribute('href',`/documents/${filing.id}?kind=filing`);await expect(section.getByText(/검토된 AI 분석과 구분/)).toBeVisible();expect(f.state.runtimeErrors).toEqual([]);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2)).toBe(true);
});
test('company widgets remain opt-in and provide provider links when the network fails',async({page})=>{
 await mobileFixture(page);await page.route('https://s3.tradingview.com/external-embedding/embed-widget-financials.js',route=>route.abort());await page.goto(`/companies/${companyId}`);
 const section=page.getByRole('region',{name:'외부 기업 자료'});await expect(section.locator('script')).toHaveCount(0);await section.getByRole('button',{name:'외부 기업 자료 불러오기'}).click();await expect(section.getByText('위젯을 불러오지 못했습니다.',{exact:false})).toBeVisible();await expect(section.getByRole('link',{name:/TradingView/})).toHaveAttribute('href',/^https:\/\/www.tradingview.com\/symbols\//);
});
test('calendar wider range queries real date boundaries',async({page})=>{
 const f=await mobileFixture(page);f.state.calendar.push({...f.state.calendar[0],id:'80000000-0000-4000-8000-000000000099',event_id:null,title:'Synthetic confirmed date outside thirty days',occurs_on:'2026-12-05'});await page.goto('/calendar');await expect(page.getByText('Synthetic confirmed date outside thirty days',{exact:true})).toHaveCount(0);const control=page.getByRole('combobox',{name:/조회 기간/});await control.selectOption('90');await expect(control).toHaveValue('90');await expect(page.getByText('Synthetic confirmed date outside thirty days',{exact:true}).first()).toBeVisible();await control.selectOption('365');await expect(control).toHaveValue('365');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2)).toBe(true);
});
test('billing never claims a return URL grants access',async({page})=>{
 await mobileFixture(page);await page.route('**/api/billing/status',route=>route.fulfill({json:{active:false,expires_at:null,test_active:false,test_expires_at:null,checkout:false,test:false}}));await page.goto('/billing?returned=1');await expect(page.getByText('활성 이용권 없음',{exact:true})).toBeVisible();await expect(page.getByText('결제 준비 중입니다.',{exact:false})).toBeVisible();await expect(page.getByRole('button',{name:'CSV 다운로드'})).toHaveCount(0);
});
