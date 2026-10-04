import {test,expect,type Page} from '@playwright/test';
async function anonymous(page:Page){
 await page.route('**/v1/config',route=>route.fulfill({json:{auth_mode:'supabase',demo_mode:false,demo_admin_enabled:false}}));
 await page.route('**/api/auth-config',route=>route.fulfill({json:{url:'https://test-project.supabase.co',publishableKey:'sb_publishable_isolated_fixture'}}));
}
test('feature samples change their real content and accept a question without fabricating live data',async({page})=>{
 await anonymous(page);await page.goto('/features');
 const portfolio=page.locator('.d-feature-card').filter({has:page.getByRole('heading',{name:'관심종목',exact:true})});
 await portfolio.getByRole('button',{name:'관심종목',exact:true}).click();await expect(portfolio.getByRole('button',{name:'관심종목',exact:true})).toHaveAttribute('aria-pressed','true');await expect(portfolio.locator('tbody')).toContainText('관심종목');
 const summary=page.locator('.d-feature-card').filter({has:page.getByRole('heading',{name:'AI 브리핑',exact:true})});
 await summary.getByRole('button',{name:'왜 중요한가'}).click();await expect(summary.locator('.d-feature-sample')).toContainText('이전 자료와 현재 자료의 차이');
 await page.getByRole('button',{name:'이전 자료와 무엇이 달라졌나요?',exact:true}).click();await expect(page.getByLabel('예시 질문',{exact:true})).toHaveValue('이전 자료와 무엇이 달라졌나요?');
 await page.getByRole('button',{name:'예시 질문 확인'}).click();await expect(page.getByRole('status')).toContainText('화면 예시입니다');
 await page.getByRole('link',{name:'근거 질문 열기',exact:true}).click();await expect(page).toHaveURL(/\/login$/);
});
test('billing controls change the display period while paid plans remain unavailable',async({page})=>{
 await anonymous(page);await page.goto('/pricing');await page.getByRole('button',{name:'연간',exact:true}).click();await expect(page.getByRole('button',{name:'연간',exact:true})).toHaveAttribute('aria-pressed','true');await expect(page.getByRole('status')).toContainText('연 단위');await expect(page.locator('.d-plan-price').first()).toContainText('₩0 / 년');
 await expect(page.locator('.d-plan').nth(1)).toContainText('미정');await page.getByRole('link',{name:'준비 상태 확인'}).first().click();await expect(page.locator('.d-plan-availability')).toBeVisible();await expect(page.locator('body')).toContainText('자동 갱신이 이루어지지 않습니다');
 await page.getByRole('button',{name:'월간',exact:true}).click();await expect(page.getByRole('status')).toContainText('월 단위');
});
test('customer walkthrough opens as a dialog and closes with Escape and its button',async({page})=>{
 await anonymous(page);await page.goto('/customers');await page.getByRole('button',{name:'사용 흐름 보기'}).click();await expect(page.getByRole('dialog')).toBeVisible();await expect(page.getByRole('dialog').locator('li')).toHaveCount(4);await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).not.toBeVisible();await page.getByRole('button',{name:'사용 흐름 보기'}).click();await page.getByRole('button',{name:'사용 흐름 닫기'}).click();await expect(page.getByRole('dialog')).not.toBeVisible();
});
test('legal table of contents opens and links to the selected section without reloading',async({page})=>{
 await anonymous(page);await page.goto('/terms');await page.evaluate(()=>{(window as Window&{__designMarker?:string}).__designMarker='retained';});
 await page.getByRole('navigation',{name:'안내 목차'}).getByRole('link',{name:'개인정보와 동의'}).click();await expect(page).toHaveURL(/\/terms#privacy$/);await expect(page.locator('#privacy details')).toHaveAttribute('open','');await expect(page.locator('#privacy .privacy-policy-detail')).toContainText('선택적 이용 통계');expect(await page.evaluate(()=>(window as Window&{__designMarker?:string}).__designMarker)).toBe('retained');
 await page.getByRole('link',{name:'개인정보 안내 보기'}).click();await expect(page).toHaveURL(/\/privacy$/);await page.getByRole('navigation',{name:'안내 목차'}).getByRole('link',{name:'사용자 권리'}).click();await expect(page.locator('#rights details')).toHaveAttribute('open','');
});
test('all ten pages use semantic responsive UI, and the desktop account form stays left of the illustration',async({page})=>{
 await anonymous(page);
 for(const path of ['/','/features','/sources','/pricing','/customers','/privacy','/terms','/login','/signup','/forgot-password']){
  await page.goto(path);await page.evaluate(()=>document.fonts.ready);await expect(page.getByRole('heading',{level:1})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2)).toBe(false);await expect(page.locator('img[src^="data:"]')).toHaveCount(0);await expect(page.locator('canvas')).toHaveCount(0);
  if(test.info().project.name==='mobile'&&await page.locator('.public-info-demo').count()){
   const frame=await page.locator('.public-info-demo').boundingBox(),last=await page.locator('.demo-indices>div').last().boundingBox();expect(last!.x+last!.width).toBeLessThanOrEqual(frame!.x+frame!.width);expect(last!.x).toBeGreaterThanOrEqual(frame!.x);
  }
  if(['/login','/signup','/forgot-password'].includes(path)){
   const form=await page.locator('.auth-form-column').boundingBox(),story=await page.locator('.auth-story').boundingBox();if(test.info().project.name==='desktop')expect(story!.x).toBeGreaterThanOrEqual(form!.x+form!.width);else expect(story!.y).toBeGreaterThanOrEqual(form!.y+form!.height);
  }
 }
});
