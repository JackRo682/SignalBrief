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
