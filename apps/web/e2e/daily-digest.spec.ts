import {test,expect} from '@playwright/test';
import {mobileFixture} from './mobile-fixture';
test('daily digest consent and time persist across a reload',async({page})=>{
 const fixture=await mobileFixture(page);
 let enabled=false,time='09:00',writes=0;
 await page.route('https://test-project.supabase.co/rest/v1/rpc/sb_digest_preferences',async route=>{
  const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':route.request().headers()['access-control-request-headers']??'authorization,apikey,content-type,x-client-info'};
  if(route.request().method()==='OPTIONS'){await route.fulfill({status:204,headers});return;}
  const {p}=route.request().postDataJSON();
  if(Object.keys(p).length){writes++;enabled=p.enabled??enabled;time=p.time??time;}
  await route.fulfill({json:{available:true,enabled,time},headers});
 });
 await page.goto('/settings/notifications');
 const toggle=page.getByRole('switch',{name:'일일 요약 이메일'});
 await expect(toggle).toBeEnabled();await expect(toggle).not.toBeChecked();expect(writes).toBe(0);
 await toggle.click();await expect(toggle).toBeChecked();
 await page.getByLabel('일일 요약 발송 시각').fill('18:30');
 await page.getByRole('button',{name:'발송 시각 저장'}).click();
 await expect(page.getByText('일일 요약 설정을 저장했습니다.')).toBeVisible();
 await page.reload();await expect(toggle).toBeChecked();await expect(page.getByLabel('일일 요약 발송 시각')).toHaveValue('18:30');expect(writes).toBe(2);
 await toggle.click();await expect(toggle).not.toBeChecked();
 expect(fixture.state.unexpected).toEqual([]);
});
