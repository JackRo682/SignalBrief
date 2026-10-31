import {test,expect} from '@playwright/test';
import {mobileFixture,companyResources} from './mobile-fixture';

// Synthetic intercepted records prove presentation; SQL tests separately prove DB authorization.
test('collected metadata remains visible without a published AI interpretation, with historical dates and no overflow',async({page})=>{
 const f=await mobileFixture(page);
 const filing={...companyResources[0],id:'40000000-0000-4000-8000-000000000081',kind:'filing',title:'Synthetic collected filing awaiting analysis',source_url:'https://www.sec.gov/Archives/synthetic.htm',published_at:'2020-01-01T00:00:00Z',publication_precision:'date'};
 await page.route('**/api/workspace',async route=>{
  if(route.request().postDataJSON().action!=='source_overview'){await route.fallback();return;}
  await route.fulfill({json:{companies:1,filing_count:1,published_count:0,filings:[filing],historical_events:[],calendar:[{id:'official-past',company_id:filing.company_id,title:'Synthetic historical official date',occurs_on:'2020-01-02',source_url:'https://www.microsoft.com/en-us/Investor/',source_timezone:'America/Los_Angeles',verified_at:'2020-01-01T00:00:00Z'}]}});
 });
 await page.route('**/api/market?**',route=>route.fulfill({json:{quotes:[],available:false,reason:'fmp_display_license_unverified'}}));
 for(const path of ['/today','/watchlist']){
  await page.goto(path);
  const records=page.getByRole('region',{name:'수집된 공식 자료'});
  await expect(records.getByRole('link',{name:/Synthetic collected filing awaiting analysis/})).toHaveAttribute('href',`/documents/${filing.id}?kind=filing`);
  await expect(records.getByText('Synthetic historical official date')).toBeVisible();
  await expect(records.getByText('2020년 1월 2일', {exact:false})).toBeVisible();
  await expect(records.getByText(/공개 요건을 통과한 분석이 없습니다/)).toBeVisible();
  await expect(records.getByRole('link',{name:/공식 원문/}).first()).toHaveAttribute('href',filing.source_url);
  if(path==='/watchlist')await expect(page.getByText('미국 주가의 웹 표시 승인 대기 중입니다.').first()).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2)).toBe(true);
 }
 expect(f.state.unexpected).toEqual([]);expect(f.state.runtimeErrors).toEqual([]);
});

test('source records show a recoverable error instead of a false zero',async({page})=>{
 await mobileFixture(page);
 let fail=true;
 await page.route('**/api/workspace',async route=>{
  if(route.request().postDataJSON().action!=='source_overview'){await route.fallback();return;}
  await route.fulfill(fail?{status:503,json:{error:{code:'workspace_configuration_missing'}}}:{json:{companies:0,filing_count:0,published_count:0,filings:[],historical_events:[],calendar:[]}});
 });
 await page.goto('/today');const records=page.getByRole('region',{name:'수집된 공식 자료'});
 await expect(records.getByRole('alert')).toBeVisible();
 await expect(records.getByText(/수집 공시 0건/)).toHaveCount(0);
 fail=false;await records.getByRole('button',{name:'다시 시도'}).click();
 await expect(records.getByText(/관심종목을 추가하면/)).toBeVisible();
});
