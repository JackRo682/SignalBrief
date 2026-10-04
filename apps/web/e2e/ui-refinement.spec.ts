import {test,expect,type Page} from '@playwright/test';
import {openPublicMenu} from './public-navigation';
test.setTimeout(60000);
async function anonymous(page:Page){
 await page.route('**/v1/config',route=>route.fulfill({json:{auth_mode:'supabase',demo_mode:false,demo_admin_enabled:false}}));
 await page.route('**/api/auth-config',route=>route.fulfill({json:{url:'https://test-project.supabase.co',publishableKey:'sb_publishable_isolated_fixture'}}));
}
test('home is readable without auth, has a working demo and keyboard FAQ',async({page})=>{
 let configs=0;await anonymous(page);
 await page.route('**/v1/config',async route=>{configs++;await route.fulfill({json:{auth_mode:'supabase',demo_mode:false,demo_admin_enabled:false}});});
 await page.goto('/');await expect(page.getByRole('heading',{level:1})).toContainText('내 종목의 변화는');
 await expect(page.locator('input[type=password]')).toHaveCount(0);
 await expect(page.getByRole('link',{name:'내 관심종목으로 시작',exact:true})).toHaveAttribute('href','/signup');
 const tab=page.getByRole('tab',{name:'캘린더',exact:true});await tab.click();await expect(tab).toHaveAttribute('aria-selected','true');await expect(page.getByRole('tabpanel')).toContainText('다가오는 일정');await tab.press('ArrowRight');await expect(page.getByRole('tab',{name:'알림',exact:true})).toBeFocused();
 const summary=page.locator('.landing-faq summary').filter({hasText:'무료로 이용할 수 있나요?'});await summary.focus();await summary.press('Enter');
 await expect(page.locator('.landing-faq details[open]')).toContainText('결제 정보를 요구하지 않습니다');
 await summary.press('Enter');await expect(page.locator('.landing-faq details[open]')).toHaveCount(0);
 expect(configs).toBe(1);
});
test('mobile public menu closes on Escape and client navigation, and narrow screens fit',async({page})=>{
 await anonymous(page);await page.setViewportSize({width:320,height:740});await page.goto('/');
 const toggle=page.getByRole('button',{name:'서비스 메뉴 열기'});await toggle.click();await expect(page.locator('.public-info-menu-toggle')).toHaveAttribute('aria-expanded','true');
 await page.getByRole('link',{name:'서비스 소개',exact:true}).first().focus();await page.keyboard.press('Escape');await expect(toggle).toBeFocused();await expect(toggle).toHaveAttribute('aria-expanded','false');
 await page.evaluate(()=>{(window as Window&{__uiMarker?:string}).__uiMarker='retained';});
 for(const path of ['/features','/privacy']){
  await openPublicMenu(page);await page.locator('.public-info-nav a[href="'+path+'"]').click();await expect(page).toHaveURL(new RegExp(path+'$'));await expect(toggle).toHaveAttribute('aria-expanded','false');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2)).toBe(false);
 }
 expect(await page.evaluate(()=>(window as Window&{__uiMarker?:string}).__uiMarker)).toBe('retained');
 await page.goto('/signup');expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2)).toBe(false);
 expect(await page.getByLabel('이메일',{exact:true}).evaluate(el=>parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);
});
test('signup gives password feedback and sends only one pending request',async({page})=>{
 await anonymous(page);let release!:()=>void,calls=0;const pending=new Promise<void>(resolve=>{release=resolve;});
 await page.route('https://test-project.supabase.co/auth/v1/signup**',async route=>{calls++;await pending;await route.fulfill({json:{id:'00000001-0000-4000-8000-000000000001',email:'fixture@example.com'},headers:{'Access-Control-Allow-Origin':'*'}});});
 await page.goto('/signup');await page.getByLabel('이메일',{exact:true}).fill('fixture@example.com');const password=page.getByLabel('비밀번호',{exact:true});await password.fill('fixture-password-123');
 await expect(page.locator('#password-requirement')).toContainText('12자 이상 입력했습니다');await page.getByRole('button',{name:'비밀번호 보기'}).click();await expect(password).toHaveAttribute('type','text');await page.getByRole('button',{name:'비밀번호 숨기기'}).click();await expect(password).toHaveAttribute('type','password');
 await page.getByRole('checkbox').check();await page.getByRole('button',{name:'계정 만들기'}).click();await expect(page.getByRole('button',{name:'처리 중…'})).toBeDisabled();await expect(password).toBeDisabled();
 await expect.poll(()=>calls).toBe(1);await page.locator('.login-box form').dispatchEvent('submit');expect(calls).toBe(1);
 release();await expect(page.getByRole('status')).toContainText('가입 요청을 접수');await expect(password).toBeEnabled();
});
test('recovery failure can be retried and a reset mismatch stays on the form',async({page})=>{
 await anonymous(page);let calls=0;
 await page.route('https://test-project.supabase.co/auth/v1/recover**',async route=>{calls++;await route.fulfill({status:calls===1?400:200,json:calls===1?{msg:'Isolated rejected fixture'}:{},headers:{'Access-Control-Allow-Origin':'*'}});});
 await page.goto('/forgot-password');await page.getByLabel('이메일',{exact:true}).fill('fixture@example.com');await page.getByRole('button',{name:'복구 메일 요청'}).click();await expect(page.locator('.auth-form-column').getByRole('alert')).toContainText('완료하지 못했습니다');
 await page.getByRole('button',{name:'복구 메일 요청'}).click();await expect(page.getByRole('status')).toContainText('복구 가능한 계정');expect(calls).toBe(2);
 await page.goto('/reset-password');await page.getByLabel('새 비밀번호 · 12자 이상').fill('fixture-password-123');await page.getByLabel('다시 입력').fill('different-password');await page.getByRole('button',{name:'비밀번호 저장'}).click();await expect(page.locator('.auth-form-column').getByRole('alert')).toContainText('두 비밀번호가 다릅니다');
 await page.getByRole('link',{name:'새 복구 메일 요청'}).click();await expect(page).toHaveURL(/\/forgot-password$/);
});
test('authenticated public header offers the workspace instead of login',async({page})=>{
 await page.addInitScript(()=>sessionStorage.setItem('signalbrief.demo.token','isolated-synthetic-token'));
 await page.route('**/v1/**',route=>route.fulfill({json:route.request().url().endsWith('/config')?{auth_mode:'demo',demo_mode:true,demo_admin_enabled:false}:{id:'fixture-user',display_name:'Test',density:'advanced',onboarding_completed:true,analytics_consent:false,is_admin:false,demo_mode:true}}));
 await page.goto('/');await expect(page.locator('.public-info-header').getByRole('link',{name:'내 브리핑 열기'})).toHaveAttribute('href','/today');await expect(page.locator('.public-info-header').getByRole('link',{name:'로그인',exact:true})).toHaveCount(0);
});
