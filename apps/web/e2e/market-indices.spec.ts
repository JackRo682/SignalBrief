import {test,expect} from '@playwright/test';
import {mobileFixture,fixtureNow} from './mobile-fixture';

test('homepage indices recover from API failure and show partial authorized coverage',async({page},info)=>{
 const fixture=await mobileFixture(page);let fail=true,requests=0;
 await page.route('**/api/us/indices',async route=>{
  requests++;expect(route.request().headers().authorization).toMatch(/^Bearer /);
  if(fail)return route.fulfill({status:502,json:{error:{code:'us_provider_api_unreachable'}}});
  return route.fulfill({json:{available:true,indices:[
   {symbol:'KOSPI',price:2600.12,currency:'POINTS',change_pct:1.23,as_of:fixtureNow,source:'KIS',timestamp_kind:'request_observed_at_not_exchange_timestamp'},
   {symbol:'NASDAQ',price:23456.78,currency:'POINTS',change_pct:-.5,as_of:fixtureNow,source:'FMP',timestamp_kind:'provider_timestamp'},
  ],unavailable:[{symbol:'KOSDAQ',reason:'missing_credentials'},{symbol:'S&P500',reason:'index_entitlement_unverified'}]}});
 });
 await page.goto('/today');
 await expect(page.getByRole('alert').filter({hasText:'지수 API 오류'})).toContainText('HTTP 502');
 // Development Strict Mode replays the initial effect; each user retry must add exactly one request.
 const initialRequests=requests;
 fail=false;await page.getByRole('button',{name:'지수 다시 조회'}).click();
 const cards=page.locator('.pc-today-market, .m-market-strip');
 await expect(cards.getByText('2,600.12',{exact:true})).toBeVisible();
 await expect(cards.getByText('23,456.78',{exact:true})).toBeVisible();
 await expect(cards.getByText('공급자 계정 연결 필요',{exact:true})).toBeVisible();
 await expect(cards.getByText('시세 표시 권한 확인 대기',{exact:true})).toBeVisible();
 await expect(cards.getByText('REST 스냅샷 · 거래소 시각 아님')).toBeVisible();
 await expect(cards.getByText(/시세 기준/)).toBeVisible();
 expect(requests).toBe(initialRequests+1);expect(fixture.state.unexpected).toEqual([]);expect(fixture.state.runtimeErrors).toEqual([]);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await page.screenshot({path:info.outputPath('market-indices.png'),fullPage:true});
});
