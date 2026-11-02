import {test,expect} from '@playwright/test';
import {mobileFixture,companyResources,companyId} from './mobile-fixture';
test('Korean company profile shows verified source data and recovers from failure',async({page},info)=>{
 const original={...companyResources[0]};let fail=true;
 Object.assign(companyResources[0],{ticker:'123456',market:'KOSPI',title:'합성 기업',company_name:'합성 기업'});
 try{
  const fixture=await mobileFixture(page);
  await page.route('**/api/company-profile?*',async route=>{
   expect(route.request().headers().authorization).toMatch(/^Bearer /);
   expect(new URL(route.request().url()).searchParams.get('company_id')).toBe(companyId);
   if(fail)return route.fulfill({status:502,json:{error:{code:'profile_unavailable'}}});
   return route.fulfill({json:{status:'verified',provider:'OpenDART',company_id:companyId,fetched_at:'2026-10-18T00:00:00Z',source_sha256:'a'.repeat(64),source_url:'https://opendart.fss.or.kr/guide/detail.do?apiGrpCd=DS001&apiId=2019002',profile:{corp_code:'12345678',ticker:'123456',name:'합성 기업 주식회사',english_name:'Synthetic company',ceo:'합성 대표',address:null,website:'https://example.com/',established_on:'2020-01-01',industry_code:'12345',fiscal_month:'12'}}});
  });
  await page.goto('/companies/'+companyId);
  const profile=page.getByRole('region',{name:'기업 기본정보'});
  await expect(profile.getByRole('button',{name:'다시 시도'})).toBeVisible();
  fail=false;
  await profile.getByRole('button',{name:'다시 시도'}).click();
  await expect(profile.getByText('합성 기업 주식회사',{exact:true})).toBeVisible();
  await expect(profile.getByText('합성 대표',{exact:true})).toBeVisible();
  await expect(profile.getByRole('link',{name:'공식 홈페이지 ↗'})).toHaveAttribute('href','https://example.com/');
  await expect(profile).toContainText('정보 없음');
  await expect(profile).toContainText('실시간 정보가 아닙니다.');
  expect(fixture.state.unexpected).toEqual([]);
  expect(fixture.state.runtimeErrors).toEqual([]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.screenshot({path:info.outputPath('company-profile.png'),fullPage:true});
 }finally{Object.assign(companyResources[0],original);}
});

test('new issuer profile, exact figures and company news populate from collected sources',async({page},info)=>{
 const original={...companyResources[0]},stamp='2026-10-18T00:00:00Z',sha='a'.repeat(64);
 Object.assign(companyResources[0],{ticker:'SYNTH',market:'NYSE',title:'Synthetic Unlisted Issuer',company_name:'Synthetic Unlisted Issuer'});
 try{
  const fixture=await mobileFixture(page);let failedFinancial=true;
  await page.route('**/api/workspace',async route=>{
   const request=route.request().postDataJSON();if(request.action!=='company'){await route.fallback();return;}
   await route.fulfill({json:{company:companyResources[0],documents:[],analyses:[],events:[],facts:[],watching:false,holding:false}});
  });
  const source={id:'synthetic-annual',provider:'SEC EDGAR',source_url:'https://www.sec.gov/Archives/synthetic.htm',source_sha256:sha,
   fetched_at:stamp,published_on:'2026-10-01',publication_precision:'date',report_period:'2026-09-30',form_type:'10-K',title:'Synthetic annual filing',normalization:'profile-visible-text-v1'};
  const evidence={source_id:source.id,quote:'Synthetic evidence, verified by this isolated test.',location:{kind:'normalized_text',start:1,end:51,section:'Business'}};
  await page.route('**/api/company-profile?**',route=>route.fulfill({json:{status:'verified',provider:'SEC EDGAR',fetched_at:stamp,source_url:source.source_url,
   profile:{corp_code:'0000000001',ticker:'SYNTH',name:'Synthetic Unlisted Issuer',english_name:null,ceo:null,address:null,website:null,established_on:null,industry_code:'1234',fiscal_month:'12'},
   enrichment:{schema:'signalbrief.company-profile.v1',company_id:companyId,status:'ready',checked_at:stamp,next_refresh_at:'2026-10-19T00:00:00Z',sources:[source],
    leadership:[{name:'Synthetic Source Leader',role:'Chief Executive Officer',as_of:'2026-10-01',basis:'filing',evidence}],
    formation:[{kind:'incorporated',date:'2007',precision:'year',evidence}],
    business:[{text:'Synthetic sourced business description for a newly registered issuer.',evidence}],
    products:[{name:'Synthetic sourced product',description:'Synthetic exact product description.',evidence}],
    segments:[{name:'Synthetic sourced reportable segment',description:null,evidence}],limitations:[],last_error:null}}}));
  await page.route('**/api/us/company-financials**',async route=>{
   expect(route.request().headers().authorization).toMatch(/^Bearer /);
   expect(route.request().postDataJSON()).toEqual({company_id:companyId});
   if(failedFinancial)return route.fulfill({status:502,json:{error:{code:'synthetic_provider_failure'}}});
   return route.fulfill({json:{company_id:companyId,provider:'sec',status:'ready',last_success_at:stamp,error_code:null,
    source:{url:'https://data.sec.gov/api/xbrl/companyfacts/CIK0000000001.json',raw_sha256:sha,fetched_at:stamp},
    items:[{metric:'revenue',taxonomy:'us-gaap',concept:'Revenues',label:'Synthetic exact revenue',value_raw:'9007199254740993.120000',unit:'USD',
     period_start:'2026-01-01',period_end:'2026-03-31',period_label:'2026-01-01 — 2026-03-31',period_kind:'duration',fiscal_year:2026,fiscal_period:'Q1',
     form:'10-Q',accession:'0000000001-26-000001',filed_on:'2026-04-29',basis:'reported',scope:'entity',accounting_standard:'US-GAAP',source_url:'https://data.sec.gov/api/xbrl/companyfacts/CIK0000000001.json',
     source_quote:'{"val":9007199254740993.120000,"end":"2026-03-31"}',location:'/facts/us-gaap/Revenues/units/USD/0',raw_sha256:sha}],
    analysis:{status:'pending_review',approved:0,pending_review:1,error_code:null}}});
  });
  await page.route('**/api/news?**',route=>route.fulfill({json:{provider:'NAVER',query:'Synthetic Unlisted Issuer',retrievedAt:stamp,
   items:[{title:'Synthetic company-specific article',link:'https://example.com/synthetic-article',originalLink:null,publishedAt:stamp}]}}));
  await page.goto('/companies/'+companyId);
  await expect(page.getByText('Synthetic Source Leader',{exact:true})).toBeVisible();
  await expect(page.getByText('법인 설립: 2007',{exact:true})).toBeVisible();
  await expect(page.getByText(/Synthetic sourced business description/)).toBeVisible();
  await expect(page.getByRole('heading',{name:'Synthetic sourced product'})).toBeVisible();
  await expect(page.getByRole('heading',{name:'Synthetic sourced reportable segment'})).toBeVisible();
  await expect(page.getByRole('button',{name:'수치 다시 불러오기'})).toBeVisible();
  failedFinancial=false;await page.getByRole('button',{name:'수치 다시 불러오기'}).click();
  await expect(page.getByText('9,007,199,254,740,993.120000 USD',{exact:true})).toBeVisible();
  await expect(page.getByText('2026-01-01 — 2026-03-31',{exact:true})).toBeVisible();
  await page.getByRole('tab',{name:'분석',exact:true}).click();
  await expect(page.getByText(/1건의 분석이 작성되어 근거 검토/)).toBeVisible();
  await expect(page.getByText(/전체 보고서 분석을 의미하지 않습니다/)).toHaveCount(0);
  await page.getByRole('tab',{name:'뉴스',exact:true}).click();
  await expect(page.getByRole('link',{name:'Synthetic company-specific article'})).toBeVisible();
  expect(fixture.state.unexpected).toEqual([]);expect(fixture.state.runtimeErrors).toEqual([]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.screenshot({path:info.outputPath('generic-company-source-data.png'),fullPage:true});
 }finally{Object.assign(companyResources[0],original);}
});
