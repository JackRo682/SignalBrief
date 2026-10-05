import {openPublicMenu} from './public-navigation';
import {test,expect,type Page} from '@playwright/test';
test.setTimeout(120000);
const navPages=[['about','서비스 소개'],['features','주요 기능'],['sources','데이터 출처'],['pricing','요금제'],['customers','고객 사례']] as const;
const allPages=['','about','features','sources','customers','pricing','login','signup','forgot-password','reset-password','terms','privacy','disclaimer'];
async function anonymous(page:Page){
 await page.route('**/v1/config',r=>r.fulfill({json:{auth_mode:'supabase',demo_mode:false,demo_admin_enabled:false}}));
 await page.route('**/api/auth-config',r=>r.fulfill({json:{url:'https://test-project.supabase.co',publishableKey:'sb_publishable_isolated_fixture'}}));
 await page.route('**/api/public-stats',r=>r.fulfill({json:{}}));
}
test('all thirteen reference designs render semantic, responsive content without script errors',async({page},testInfo)=>{
 await anonymous(page);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 if(testInfo.project.name==='desktop')await page.setViewportSize({width:1448,height:1086});
 for(const path of allPages){
  await page.goto('/'+path);await expect(page.getByRole('heading',{level:1})).toHaveCount(1);await expect(page.getByRole('heading',{level:1})).toBeVisible();
  await expect(page.locator('[data-design="prelogin-20261005"]')).toHaveCount(1);
  await expect(page.locator('.v-footer')).toBeVisible();
  await page.evaluate(()=>document.fonts.ready);expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual((page.viewportSize()?.width??0)+2);
  await expect(page.locator('canvas,img[src^="data:"]')).toHaveCount(0);
  if(!['login','signup'].includes(path))await expect(page.locator('.public-info-nav a')).toHaveCount(5);
  const known=navPages.find(([p])=>p===path);if(known)await expect(page.locator('.public-info-nav [aria-current="page"]')).toHaveText(known[1]);
  await page.screenshot({path:testInfo.outputPath((path||'home')+'.png'),fullPage:true});
 }
 expect(errors).toEqual([]);
});
test('five header links and legal footer links navigate without recreating the document',async({page})=>{
 await anonymous(page);await page.goto('/');await page.evaluate(()=>{(window as Window&{__publicMarker?:string}).__publicMarker='retained';});
 for(const [path,label] of navPages){await openPublicMenu(page);await page.locator('.public-info-nav').getByRole('link',{name:label,exact:true}).click();await expect(page).toHaveURL(new RegExp('/'+path+'$'));}
 for(const [path,label] of [['terms','이용약관'],['privacy','개인정보처리방침'],['disclaimer','투자 유의사항']]){await page.locator('.v-footer').getByRole('link',{name:label,exact:true}).click();await expect(page).toHaveURL(new RegExp('/'+path+'$'));}
 expect(await page.evaluate(()=>(window as Window&{__publicMarker?:string}).__publicMarker)).toBe('retained');
 await page.locator('.public-info-header-actions').getByRole('link',{name:'무료로 시작하기'}).click();await expect(page).toHaveURL(/\/signup$/);
});
test('the miniature dashboard has functional controls and explicitly marked sample data',async({page})=>{
 await anonymous(page);await page.goto('/');
 const nav=page.getByRole('navigation',{name:'미리보기 화면 선택'});
 await expect(page.locator('.v-browser-top')).toContainText('실제 시세·고객 데이터가 아닙니다');
 const portfolio=nav.getByRole('button',{name:'포트폴리오',exact:true});await portfolio.click();await expect(portfolio).toHaveAttribute('aria-pressed','true');
 await expect(page.locator('.v-demo-content>.v-widget-portfolio')).toBeVisible();
 const watch=nav.getByRole('button',{name:'관심종목',exact:true});await watch.focus();await watch.press('Enter');await expect(watch).toHaveAttribute('aria-pressed','true');
 await expect(page.locator('.v-demo-content>.v-widget-watchlist')).toBeVisible();
 await page.locator('.v-demo-content>.v-widget-watchlist .v-more').click();await expect(page).toHaveURL(/\/login$/);
});
test('feature and beta CTAs resolve to actual authentication or availability pages',async({page})=>{
 await anonymous(page);await page.goto('/features');await page.locator('.v-widget-watchlist .v-more').click();await expect(page).toHaveURL(/\/login$/);
 await expect(page.locator('body')).not.toContainText('authentication_required');
 await page.goto('/pricing');await page.locator('.v-plan').first().getByRole('link',{name:'무료로 시작하기'}).click();await expect(page).toHaveURL(/\/signup$/);
 await page.goto('/pricing');await page.locator('.v-plan-featured').getByRole('link').click();await expect(page).toHaveURL(/\/pricing#availability$/);
 await page.locator('#availability').getByRole('link').click();await expect(page).toHaveURL(/\/privacy#contact$/);await expect(page.locator('#contact')).toBeVisible();
});
test('privacy sections, consent controls and official source destinations remain accessible',async({page})=>{
 await anonymous(page);await page.goto('/privacy');await expect(page.locator('.v-policy-section')).toHaveCount(11);
 await page.getByRole('navigation',{name:'안내 목차'}).getByRole('link',{name:'수집하는 개인정보 항목'}).click();await expect(page).toHaveURL(/#collection$/);
 await expect(page.locator('#collection')).toContainText('보유 수량·평균 취득가');await expect(page.locator('#collection table')).toBeVisible();
 await page.locator('#rights').getByRole('link',{name:'동의 설정 관리'}).click();await expect(page).toHaveURL(/\/login$/);
 await page.goto('/sources');const sec=page.locator('.v-source-seven a[href="https://www.sec.gov/edgar/search/"]');
 await expect(sec).toHaveAttribute('target','_blank');await expect(sec).toHaveAttribute('rel','noopener noreferrer');
});
test('signed-in visitors open their real workspace from a feature card',async({page})=>{
 await page.addInitScript(()=>sessionStorage.setItem('signalbrief.demo.token','isolated-synthetic-token'));
 await page.route('**/v1/**',route=>{const path=new URL(route.request().url()).pathname.replace(/^\/api/,'');let json:unknown=[];
  if(path==='/v1/config')json={auth_mode:'demo',demo_mode:true,demo_admin_enabled:false};
  if(path==='/v1/me')json={id:'fixture-user',display_name:'Test',density:'advanced',onboarding_completed:true,analytics_consent:false,is_admin:false,demo_mode:true};
  return route.fulfill({json});
 });
 await page.goto('/features');const calendar=page.locator('.v-widget-calendar').getByRole('link',{name:'알림 설정'});await expect(calendar).toHaveAttribute('href','/calendar');
 await calendar.click();await expect(page).toHaveURL(/\/calendar$/);await expect(page.locator('[data-screen="calendar"]')).toBeVisible();
});
