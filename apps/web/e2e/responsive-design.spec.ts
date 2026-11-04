import {test,expect,type Page} from '@playwright/test';
async function anonymous(page:Page){
 await page.route('**/v1/config',route=>route.fulfill({json:{auth_mode:'supabase',demo_mode:false,demo_admin_enabled:false}}));
 await page.route('**/api/auth-config',route=>route.fulfill({json:{url:'https://test-project.supabase.co',publishableKey:'sb_publishable_isolated_fixture'}}));
}
test('all eight feature widgets are distinct and their filters, calendar and question form work',async({page})=>{
 await anonymous(page);await page.goto('/features');await expect(page.locator('.v-feature-card')).toHaveCount(8);
 const today=page.locator('.v-widget-today');await today.getByRole('button',{name:/주요 상승/}).click();await expect(today.locator('.v-issue-row')).toHaveCount(1);
 await today.getByRole('button',{name:/전체/}).click();await expect(today.locator('.v-issue-row')).toHaveCount(3);
 const calendar=page.locator('.v-widget-calendar');await calendar.getByRole('button',{name:'다음 예시 달'}).click();await expect(calendar).toContainText('2025년 5월');await expect(calendar).toContainText('등록된 예시 일정이 없습니다');
 await calendar.getByRole('button',{name:'이전 예시 달'}).click();await expect(calendar.locator('.v-calendar-row')).toHaveCount(4);
 await page.getByLabel('예시 후속 질문').fill('이전 자료와 무엇이 달라졌나요?');await page.getByRole('button',{name:'질문 기능 안내'}).click();
 await expect(page.getByRole('status')).toContainText('미리보기입니다');await page.getByRole('status').getByRole('link').click();await expect(page).toHaveURL(/\/login$/);
});
test('pricing matches three cards while paid plans cannot charge, and FAQ works with a keyboard',async({page})=>{
 await anonymous(page);await page.goto('/pricing');await expect(page.locator('.v-plan')).toHaveCount(3);
 await expect(page.locator('.v-plan').nth(1)).toContainText('19,000');await expect(page.locator('.v-plan').nth(2)).toContainText('49,000');
 await page.locator('.v-plan-featured').getByRole('link').click();await expect(page.locator('#availability')).toContainText('결제·자동 갱신되지 않습니다');
 const details=page.locator('.v-faq-column details').nth(2);const summary=details.locator('summary');await summary.focus();await summary.press('Enter');await expect(details).toHaveAttribute('open','');await expect(details).toContainText('결제 정보를 받지 않으며');
 await summary.press('Enter');await expect(details).not.toHaveAttribute('open','');
});
test('the about-page walkthrough opens and closes with Escape and its close control',async({page})=>{
 await anonymous(page);await page.goto('/about');await page.getByRole('button',{name:'사용 흐름 보기'}).click();await expect(page.getByRole('dialog')).toBeVisible();await expect(page.getByRole('dialog').locator('li')).toHaveCount(4);
 await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).not.toBeVisible();await page.getByRole('button',{name:'사용 흐름 보기'}).click();await page.getByRole('button',{name:'사용 흐름 닫기'}).click();await expect(page.getByRole('dialog')).not.toBeVisible();
});
test('legal table of contents navigates to expanded text without reloading the page',async({page})=>{
 await anonymous(page);await page.goto('/terms');await page.evaluate(()=>{(window as Window&{__designMarker?:string}).__designMarker='retained';});
 await page.getByRole('navigation',{name:'안내 목차'}).getByRole('link',{name:'개인정보 및 문의 안내'}).click();await expect(page).toHaveURL(/\/terms#privacy$/);await expect(page.locator('#privacy')).toContainText('선택적 이용 통계');
 expect(await page.evaluate(()=>(window as Window&{__designMarker?:string}).__designMarker)).toBe('retained');
 await page.locator('.v-footer').getByRole('link',{name:'개인정보처리방침'}).click();await page.getByRole('navigation',{name:'안내 목차'}).getByRole('link',{name:'이용자 권리'}).click();await expect(page).toHaveURL(/\/privacy#rights$/);await expect(page.locator('#rights')).toContainText('철회');
});
test('account screens retain real forms, and desktop illustrations stay to the left of them',async({page})=>{
 await anonymous(page);
 for(const path of ['/login','/signup','/forgot-password','/reset-password']){
  await page.goto(path);await expect(page.locator('.v-auth-form-column form')).toHaveCount(1);
  await expect(page.locator('.login-box')).toBeVisible();await expect(page.getByRole('heading',{level:1})).toHaveCount(1);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2)).toBe(false);
  if(path==='/login'||path==='/signup'){
   const story=page.locator('.reference-auth-story');if(test.info().project.name==='desktop'){
    const formBox=await page.locator('.v-auth-form-column').boundingBox(),storyBox=await story.boundingBox();expect(formBox!.x).toBeGreaterThanOrEqual(storyBox!.x+storyBox!.width-1);
   }else await expect(story).not.toBeVisible();
  }
 }
});
test('public desktop account fields and guidance remain readable and aligned',async({page},testInfo)=>{
 test.skip(testInfo.project.name!=='desktop','Desktop typography regression; existing tests cover mobile forms.');
 await anonymous(page);await page.goto('/login');
 await page.evaluate(()=>{(window as Window&{__accountLayoutMarker?:string}).__accountLayoutMarker='retained';});
 for(const path of ['/login','/signup','/forgot-password','/reset-password']){
  if(path==='/signup')await page.locator('.v-auth-header').getByRole('link',{name:'회원가입',exact:true}).click();
  if(path==='/forgot-password'){
   await page.locator('.v-auth-header').getByRole('link',{name:'로그인',exact:true}).click();
   await page.getByRole('link',{name:'비밀번호 찾기',exact:true}).click();
  }
  // The recovery-email destination is opened directly; no account requests are submitted.
  if(path==='/reset-password')await page.goto(path);
  await expect(page).toHaveURL(new RegExp(path+'$'));
  await expect(page.locator('.reference-auth.v-account .login-box')).toBeVisible();
  if(path!=='/reset-password')expect(await page.evaluate(()=>(window as Window&{__accountLayoutMarker?:string}).__accountLayoutMarker)).toBe('retained');
  for(const width of [1280,1440,1920])await test.step(`${path} at ${width}px`,async()=>{
   await page.setViewportSize({width,height:1080});await page.evaluate(async()=>{await document.fonts.ready;});
   for(const [selector,minimum] of [
    ['.field input:not([type="checkbox"]),.field>label,.field>span,.button',16],
    ['.password-requirement,.d-signup-ack>label,.d-forgot-link,.auth-links>*,.v-password-guide p,.v-password-guide small,.v-reset-note',14],
   ] as const){
    const sizes=await page.locator('.reference-auth.v-account .login-box').locator(selector).evaluateAll(elements=>elements.map(element=>parseFloat(getComputedStyle(element).fontSize)));
    expect(sizes.length,`${selector} is present`).toBeGreaterThan(0);
    for(const size of sizes)expect(size,`${path} readable form text`).toBeGreaterThanOrEqual(minimum);
   }
   const geometry=await page.locator('.reference-auth.v-account').evaluate(root=>{
    const bounds=(element:Element)=>{const box=element.getBoundingClientRect();return {left:box.left,right:box.right,top:box.top,bottom:box.bottom,height:box.height};};
    const submit=root.querySelector('.login-box .button.primary')!,header=root.querySelector('.v-auth-header,.public-info-header')!;
    const inner=header.querySelector('.v-container,.public-info-container')!,story=root.querySelector('.reference-auth-story')!;
    return {submit:bounds(submit),fields:Array.from(root.querySelectorAll('.login-box .field input:not([type="checkbox"])'),bounds),
     header:bounds(header),inner:bounds(inner),form:bounds(root.querySelector('.v-auth-form-column')!),
     story:getComputedStyle(story).display==='none'?null:bounds(story),overflow:document.documentElement.scrollWidth-innerWidth};
   });
   expect(geometry.fields.length).toBeGreaterThan(0);
   for(const field of geometry.fields){
    expect(Math.abs(field.left-geometry.submit.left),'Input and submit left edges align').toBeLessThanOrEqual(1);
    expect(Math.abs(field.right-geometry.submit.right),'Input and submit right edges align').toBeLessThanOrEqual(1);
    expect(field.height,'Input target remains usable').toBeGreaterThanOrEqual(44);
   }
   expect(geometry.submit.height).toBeGreaterThanOrEqual(44);
   expect(geometry.inner.top).toBeGreaterThanOrEqual(geometry.header.top-1);
   expect(geometry.inner.bottom).toBeLessThanOrEqual(geometry.header.bottom+1);
   if(geometry.story)expect(geometry.story.right,'Story and real form do not overlap').toBeLessThanOrEqual(geometry.form.left+1);
   expect(geometry.overflow,'No horizontal document overflow').toBeLessThanOrEqual(1);
  });
 }
});
