import {test,expect} from '@playwright/test';
import {mobileFixture,companyId,companies} from './mobile-fixture';

test('company price explains pending permission without inventing a price',async({page},info)=>{
 const fixture=await mobileFixture(page);
 await page.route('**/api/market?**',route=>route.fulfill({json:{quotes:[],available:false,unavailable:[{symbol:companies[0].ticker,reason:'fmp_display_license_unverified'}],reason:'fmp_display_license_unverified'}}));
 await page.goto('/companies/'+companyId);
 await expect(page.getByText('미국 주가의 웹 표시 승인 대기 중입니다.',{exact:false})).toBeVisible();
 const price=page.locator(info.project.name==='mobile'?'.m-company-quote strong':'.pc-research-quote strong');
 await expect(price).toHaveText('—');
 expect(fixture.state.runtimeErrors).toEqual([]);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await page.screenshot({path:info.outputPath('quote-permission-pending.png'),fullPage:true});
});

test('licensed EOD response shows its trading date and source',async({page},info)=>{
 const fixture=await mobileFixture(page);
 await page.route('**/api/market?**',route=>{
  expect(route.request().headers().authorization).toMatch(/^Bearer /);
  return route.fulfill({json:{quotes:[{symbol:companies[0].ticker,price:123.45,currency:'USD',change_pct:null,as_of:'2026-10-16',source:'FMP EOD',price_kind:'end_of_day_close',timestamp_kind:'provider_date',history:[{date:'2026-10-15',close:120},{date:'2026-10-16',close:123.45}]}],unavailable:[],available:true}});
 });
 await page.goto('/companies/'+companyId);
 const price=page.locator(info.project.name==='mobile'?'.m-company-quote strong':'.pc-research-quote strong');
 await expect(price).toContainText('123.45');
 const meta=page.locator(info.project.name==='mobile'?'.m-company-quote-meta':'.pc-research-quote small');
 await expect(meta).toContainText('FMP EOD');await expect(meta).toContainText('16');
 expect(await meta.textContent()).not.toMatch(/\d{2}:\d{2}/);
 expect(fixture.state.runtimeErrors).toEqual([]);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await page.screenshot({path:info.outputPath('quote-eod.png'),fullPage:true});
});
