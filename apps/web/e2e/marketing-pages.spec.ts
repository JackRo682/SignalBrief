import {openPublicMenu} from './public-navigation';
import {test,expect,type Page} from '@playwright/test';
test.setTimeout(60000);
const pages=[['about','서비스 소개'],['features','주요 기능'],['sources','데이터 출처'],['pricing','요금제'],['customers','고객 사례'],['privacy','개인정보']] as const;
async function anonymous(page:Page){
 await page.route('**/v1/config',r=>r.fulfill({json:{auth_mode:'supabase',demo_mode:false,demo_admin_enabled:false}}));
 await page.route('**/api/auth-config',r=>r.fulfill({json:{url:'https://test-project.supabase.co',publishableKey:'sb_publishable_isolated_fixture'}}));
 await page.route('**/api/public-stats',r=>r.fulfill({json:{}}));
}
test('all six designs have readable content, navigation and responsive artwork',async({page})=>{
 await anonymous(page);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 for(const [path,label] of pages){
  await page.goto('/'+path);await expect(page.locator('.public-info-page h1')).toBeVisible();
  await expect(page.locator('.public-info-nav a')).toHaveCount(6);await expect(page.locator('.public-info-nav [aria-current="page"]')).toHaveText(label);
  await expect(page.locator('.public-info-closing')).toBeVisible();await expect(page.locator('.public-info-card').first()).toBeVisible();
  await page.evaluate(()=>document.fonts.ready);expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2)).toBe(false);
  const art=page.locator('.public-info-mountain');await art.scrollIntoViewIfNeeded();await expect(art).toBeVisible();await expect(art.locator('i')).toHaveCount(3);expect(await art.locator('i').first().evaluate(el=>getComputedStyle(el).clipPath)).toContain('polygon');
  if(test.info().project.name==='desktop'){
   const copy=await page.locator('.public-info-hero-copy').boundingBox(),art=await page.locator('.public-info-hero-art').boundingBox();expect(art!.x).toBeGreaterThan(copy!.x+copy!.width-1);
  }
 }
 expect(errors).toEqual([]);
});
test('header, footer and landing links navigate without recreating the document',async({page})=>{
 await anonymous(page);await page.goto('/');await openPublicMenu(page);await page.locator('.landNav').getByRole('link',{name:'개인정보',exact:true}).click();await expect(page).toHaveURL(/\/privacy$/);
 await page.evaluate(()=>{(window as Window&{__publicMarker?:string}).__publicMarker='retained';});
 for(const [path,label] of pages){await openPublicMenu(page);await page.locator('.public-info-nav').getByRole('link',{name:label,exact:true}).click();await expect(page).toHaveURL(new RegExp('/'+path+'$'));}
 expect(await page.evaluate(()=>(window as Window&{__publicMarker?:string}).__publicMarker)).toBe('retained');
 await page.locator('.public-info-footer').getByRole('link',{name:'개인정보처리방침',exact:true}).click();await expect(page).toHaveURL(/\/privacy$/);
 await page.locator('.public-info-closing').getByRole('link',{name:'무료로 시작하기'}).click();await expect(page).toHaveURL(/\/signup$/);
});
test('dashboard preview supports clicks and keyboard navigation with clearly marked sample data',async({page})=>{
 await anonymous(page);await page.goto('/features');await page.getByRole('link',{name:'데모 화면 보기',exact:true}).click();await expect(page).toHaveURL(/#demo$/);
 const portfolio=page.getByRole('tab',{name:'포트폴리오',exact:true});await portfolio.click();await expect(portfolio).toHaveAttribute('aria-selected','true');
 await expect(page.getByRole('tabpanel').getByRole('heading',{name:'포트폴리오',exact:true})).toBeVisible();
 await portfolio.press('ArrowDown');const timeline=page.getByRole('tab',{name:'기업 타임라인',exact:true});await expect(timeline).toBeFocused();await expect(timeline).toHaveAttribute('aria-selected','true');
 await timeline.press('Home');await expect(page.getByRole('tab',{name:'오늘의 변화',exact:true})).toBeFocused();
 await expect(page.getByRole('tabpanel')).toContainText('실제 기업·시세 데이터가 아닙니다');
 await page.getByRole('tabpanel').getByRole('link',{name:'이 기능 사용하기'}).click();await expect(page).toHaveURL(/\/login$/);
});
test('feature and beta CTAs send anonymous visitors to the correct account pages',async({page})=>{
 await anonymous(page);await page.goto('/features');await page.getByRole('link',{name:'관심종목 자세히 보기',exact:true}).click();await expect(page).toHaveURL(/\/login$/);
 await expect(page.locator('body')).not.toContainText('authentication_required');
 await page.goto('/pricing');await page.getByRole('link',{name:'지금 바로 시작하기'}).click();await expect(page).toHaveURL(/\/signup$/);
 await page.goto('/pricing');await page.getByRole('link',{name:'문의하기',exact:true}).click();await expect(page).toHaveURL(/\/privacy#contact$/);await expect(page.locator('#contact')).toBeVisible();
});
test('privacy details expand with keyboard and consent settings link to login',async({page})=>{
 await anonymous(page);await page.goto('/privacy');
 const summary=page.locator('#collection summary');if(await page.locator('#collection details').evaluate(el=>el.hasAttribute('open')))await summary.click();await summary.focus();await summary.press('Enter');await expect(page.locator('#collection details')).toHaveAttribute('open','');
 await expect(page.locator('#collection .privacy-policy-detail')).toContainText('보유 수량과 평균 취득가');
 await summary.press('Enter');await expect(page.locator('#collection details')).not.toHaveAttribute('open','');
 if(!await page.locator('#rights details').evaluate(el=>el.hasAttribute('open')))await page.locator('#rights summary').click();await page.locator('#rights').getByRole('link',{name:'동의 설정 관리'}).click();await expect(page).toHaveURL(/\/login$/);
 await page.goto('/sources');await expect(page.getByRole('link',{name:'SEC 공식 공시 SEC 자료 예시 보기'})).toHaveAttribute('href','https://www.sec.gov/edgar/search/');
 await expect(page.getByRole('link',{name:'SEC 공식 공시 SEC 자료 예시 보기'})).toHaveAttribute('rel','noopener noreferrer');
});
test('signed in visitors open their workspace directly from a feature card',async({page})=>{
 await page.addInitScript(()=>sessionStorage.setItem('signalbrief.demo.token','isolated-synthetic-token'));
 await page.route('**/v1/**',route=>{const path=new URL(route.request().url()).pathname.replace(/^\/api/,'');let json:unknown=[];
  if(path==='/v1/config')json={auth_mode:'demo',demo_mode:true,demo_admin_enabled:false};
  if(path==='/v1/me')json={id:'fixture-user',display_name:'Test',density:'advanced',onboarding_completed:true,analytics_consent:false,is_admin:false,demo_mode:true};
  return route.fulfill({json});
 });
 await page.goto('/features');await expect(page.getByRole('link',{name:'캘린더 자세히 보기',exact:true})).toHaveAttribute('href','/calendar');
 await page.getByRole('link',{name:'캘린더 자세히 보기',exact:true}).click();await expect(page).toHaveURL(/\/calendar$/);await expect(page.locator('[data-screen="calendar"]')).toBeVisible();
});
