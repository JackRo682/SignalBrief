import {openPublicMenu} from './public-navigation';
import {test,expect,type Page} from '@playwright/test';

test.setTimeout(60000);

async function publicAuth(page:Page){
  await page.route('**/v1/config',r=>r.fulfill({json:{auth_mode:'supabase',demo_mode:false,demo_admin_enabled:false}}));
  await page.route('**/api/auth-config',r=>r.fulfill({json:{url:'https://test-project.supabase.co',publishableKey:'sb_publishable_isolated_fixture'}}));
  await page.route('**/api/public-stats',r=>r.fulfill({json:{}}));
}
async function expectExpiredWorkspaceLogin(page:Page){
  if(test.info().project.name==='mobile'){
    await expect(page).toHaveURL(/\/login\?next=%2Ftoday$/);
    expect(new URL(page.url()).searchParams.get('next')).toBe('/today');
  }else {await expect(page).toHaveURL(/\/login\?next=%2Ftoday$/);expect(new URL(page.url()).searchParams.get('next')).toBe('/today');}
}
test('public CTAs and all five header information pages have real destinations',async({page})=>{
  await publicAuth(page);await page.goto('/');
  await page.locator('.v-actions').getByRole('link',{name:'무료로 시작하기'}).click();
  await expect(page).toHaveURL(/\/signup$/);await expect(page.getByRole('button',{name:'무료로 시작하기',exact:true})).toBeVisible();
  await page.locator('.auth-links').getByRole('link',{name:'로그인',exact:true}).click();
  await expect(page).toHaveURL(/\/login$/);await page.getByRole('link',{name:'비밀번호 찾기'}).click();
  await expect(page).toHaveURL(/\/forgot-password$/);await expect(page.getByRole('button',{name:'재설정 링크 보내기'})).toBeVisible();
  for(const [label,path] of [['서비스 소개','about'],['주요 기능','features'],['데이터 출처','sources'],['요금제','pricing'],['고객 사례','customers']]){
    await page.goto('/');await openPublicMenu(page);await page.locator('.public-info-nav').getByRole('link',{name:label}).click();
    await expect(page).toHaveURL(new RegExp('/'+path+'$'));await expect(page.locator('h1')).toBeVisible();
    await expect(page.locator('.public-info-nav [aria-current="page"]')).toHaveText(label);
  }
  await page.goto('/');await page.locator('.v-actions').getByRole('link',{name:'무료로 시작하기'}).click();await expect(page).toHaveURL(/\/signup$/);
  await expect(page.locator('body')).not.toContainText('authentication_required');
});
test('email signup and recovery call Auth and display the returned outcome',async({page})=>{
  await publicAuth(page);const requests:{path:string;redirect:string|null;body:Record<string,unknown>}[]=[];
  await page.route('https://test-project.supabase.co/auth/v1/**',async route=>{
    const url=new URL(route.request().url());requests.push({path:url.pathname,redirect:url.searchParams.get('redirect_to'),body:route.request().postDataJSON()});
    await route.fulfill({json:url.pathname.endsWith('/signup')?{id:'00000001-0000-4000-8000-000000000001',email:'fixture@example.com'}:{},headers:{'Access-Control-Allow-Origin':'*'}});
  });
  await page.goto('/signup');await page.getByLabel('이메일',{exact:true}).fill('fixture@example.com');await page.getByLabel('비밀번호',{exact:true}).fill('fixture-password-123');
  await page.getByLabel('비밀번호 확인',{exact:true}).fill('fixture-password-123');await page.getByRole('checkbox').check();await page.getByRole('button',{name:'무료로 시작하기',exact:true}).click();await expect(page.getByRole('status')).toContainText('가입 요청을 접수');
  expect(requests.find(r=>r.path.endsWith('/signup'))?.redirect).toBe(new URL(page.url()).origin+'/auth/callback');
  await page.locator('.auth-links').getByRole('link',{name:'로그인',exact:true}).click();await page.getByRole('link',{name:'비밀번호 찾기'}).click();await expect(page).toHaveURL(/\/forgot-password$/);await page.getByLabel('이메일',{exact:true}).fill('fixture@example.com');
  await page.getByRole('button',{name:'재설정 링크 보내기'}).click();await expect(page.getByRole('status')).toContainText('복구 가능한 계정');
  expect(requests.find(r=>r.path.endsWith('/recover'))?.redirect).toBe(new URL(page.url()).origin+'/auth/callback?next=reset-password');
});
test('slow auth keeps a content skeleton and redirects anonymous visitors without a checking page',async({page})=>{
  await publicAuth(page);let release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;});
  await page.route('**/v1/config',async r=>{await held;await r.fulfill({json:{auth_mode:'supabase',demo_mode:false,demo_admin_enabled:false}});});
  await page.goto('/today');await expect(page.locator('.referenceLoadingShell')).toBeVisible();
  await expect(page.locator('body')).not.toContainText('계정을 확인하고 있습니다');release();
  await expectExpiredWorkspaceLogin(page);await expect(page.getByRole('button',{name:'로그인',exact:true})).toBeVisible();
});
test('expired sessions go to login without showing protocol error toasts',async({page})=>{
  await page.addInitScript(()=>sessionStorage.setItem('signalbrief.demo.token','isolated-synthetic-token'));
  await page.route('**/v1/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    if(path.endsWith('/config'))await route.fulfill({json:{auth_mode:'demo',demo_mode:true,demo_admin_enabled:false}});
    else if(path.endsWith('/me'))await route.fulfill({json:{id:'fixture-user',display_name:'Test',density:'advanced',onboarding_completed:true,analytics_consent:false,is_admin:false,demo_mode:true}});
    else await route.fulfill({status:401,json:{error:{code:'authentication_required'}}});
  });
  await page.goto('/today');await expectExpiredWorkspaceLogin(page);
  await expect(page.locator('body')).not.toContainText('authentication_required');
  await expect(page.locator('.referenceError')).toHaveCount(0);
});
