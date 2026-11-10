import {openPublicMenu} from './public-navigation';
import {test,expect,type Page} from '@playwright/test';
import {researchWorkspaceFixture,upcoming} from './research-workspace-fixture';
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
test('public desktop content aligns with its header and keeps explanatory text readable',async({page},testInfo)=>{
 test.skip(testInfo.project.name!=='desktop','Desktop layout regression; mobile coverage remains in the responsive suite.');
 await anonymous(page);
 const screens=[
  {path:'/',label:null,containers:['.v-hero-grid','.v-home-features>.v-container','.v-home-sources>.v-container','.v-home-plans>.v-container'],copy:[['.v-home-features .v-card>div>p',15]]},
  {path:'/features',label:'주요 기능',containers:['.v-feature-title','.v-feature-cards'],copy:[['.v-feature-card>header p',16]]},
  {path:'/sources',label:'데이터 출처',containers:['.v-hero-grid','.v-sources-list>.v-container','.v-sources-process>.v-container','.v-source-bottom'],copy:[['.v-source-seven .v-card>div>p',14]]},
  {path:'/pricing',label:'요금제',containers:['.v-pricing-title','.v-pricing-cards','.v-comparison>.v-container'],copy:[['.v-plan-intro>p,.v-plan-benefits li,.v-plan-benefits>small',14]]},
 ] as const;
 for(const width of [1280,1440,1920]){
  await page.setViewportSize({width,height:1080});await page.goto('/');
  await page.evaluate(()=>{(window as Window&{__publicLayoutMarker?:string}).__publicLayoutMarker='retained';});
  for(const screen of screens)await test.step(`${screen.path} at ${width}px`,async()=>{
   if(screen.label){
    await page.locator('.public-info-nav').getByRole('link',{name:screen.label,exact:true}).click();
    await expect(page).toHaveURL(new RegExp(screen.path+'$'));
   }
   await expect(page.locator('.public-info-page.v-public-design')).toBeVisible();
   await expect(page.getByRole('heading',{level:1})).toBeVisible();
   await page.evaluate(async()=>{await document.fonts.ready;});
   const layout=await page.evaluate(selectors=>{
    const bounds=(selector:string)=>{
     const element=document.querySelector(selector);if(!element)throw new Error(`Missing public layout element: ${selector}`);
     const box=element.getBoundingClientRect();return {left:box.left,right:box.right,top:box.top,bottom:box.bottom,height:box.height};
    };
    return {header:bounds('.public-info-header'),inner:bounds('.public-info-header>.public-info-container'),brand:bounds('.public-info-header .public-info-mark'),
     content:selectors.map(selector=>({selector,...bounds(selector)})),
     navigation:Array.from(document.querySelectorAll('.public-info-nav a'),element=>parseFloat(getComputedStyle(element).fontSize)),
     overflow:document.documentElement.scrollWidth-innerWidth};
   },[...screen.containers,'.v-footer>.v-container']);
   expect(layout.inner.height,'Header content fits inside its visible background').toBeLessThanOrEqual(layout.header.height+1);
   expect(layout.inner.top).toBeGreaterThanOrEqual(layout.header.top-1);
   expect(layout.inner.bottom).toBeLessThanOrEqual(layout.header.bottom+1);
   expect(Math.abs(layout.brand.left-layout.inner.left),'Public logo aligns with the content edge').toBeLessThanOrEqual(1);
   for(const content of layout.content){
    expect(Math.abs(content.left-layout.inner.left),`${content.selector} left edge`).toBeLessThanOrEqual(1);
    expect(Math.abs(content.right-layout.inner.right),`${content.selector} right edge`).toBeLessThanOrEqual(1);
   }
   expect(layout.navigation).toHaveLength(navPages.length);
   for(const size of layout.navigation)expect(size,'Public navigation text').toBeGreaterThanOrEqual(15);
   for(const [selector,minimum] of screen.copy){
    const sizes=await page.locator(selector).evaluateAll(elements=>elements.map(element=>parseFloat(getComputedStyle(element).fontSize)));
    expect(sizes.length,`${selector} is present`).toBeGreaterThan(0);
    for(const size of sizes)expect(size,`${selector} remains readable`).toBeGreaterThanOrEqual(minimum);
   }
   if(screen.path==='/features'){
    const cards=await page.locator('.v-feature-card').evaluateAll(elements=>elements.map(element=>{
     const box=element.getBoundingClientRect(),widget=element.querySelector('.v-widget');
     if(!widget)throw new Error('Missing feature preview');
     return {left:box.left,right:box.right,top:box.top,bottom:box.bottom,
      overflow:element.scrollWidth-element.clientWidth,widgetOverflow:widget.scrollWidth-widget.clientWidth};
    }));
    expect(cards,'All eight features remain present').toHaveLength(8);
    const rows=[cards.slice(0,4),cards.slice(4)];
    for(const [rowIndex,row] of rows.entries()){
     for(const [column,card] of row.entries()){
      expect(Math.abs(card.top-row[0].top),`Feature row ${rowIndex+1} has four cards at ${width}px`).toBeLessThanOrEqual(1);
      expect(card.overflow,`Feature ${rowIndex*4+column+1} has no horizontal overflow`).toBeLessThanOrEqual(1);
      expect(card.widgetOverflow,`Feature preview ${rowIndex*4+column+1} has no horizontal overflow`).toBeLessThanOrEqual(1);
      if(column>0){
       const gap=card.left-row[column-1].right;
       expect(gap,'Adjacent feature cards do not overlap').toBeGreaterThan(0);
       expect(gap,'Feature cards use compact horizontal spacing').toBeLessThanOrEqual(16);
      }
     }
    }
    for(let column=0;column<4;column++){
     const gap=rows[1][column].top-rows[0][column].bottom;
     expect(gap,'Feature cards form two separate rows').toBeGreaterThan(0);
     expect(gap,'Feature cards use compact vertical spacing').toBeLessThanOrEqual(16);
     expect(Math.abs(rows[1][column].left-rows[0][column].left),'Feature columns align across both rows').toBeLessThanOrEqual(1);
    }
   }
   expect(layout.overflow,'No horizontal document overflow').toBeLessThanOrEqual(1);
   expect(await page.evaluate(()=>(window as Window&{__publicLayoutMarker?:string}).__publicLayoutMarker)).toBe('retained');
  });
 }
});
test('desktop customer card headers align and privacy artwork stays inside the content',async({page},testInfo)=>{
 test.skip(testInfo.project.name!=='desktop','Desktop card and artwork regression.');
 await anonymous(page);
 for(const width of [1024,1280,1440,1920]){
  await page.setViewportSize({width,height:1080});await page.goto('/customers');
  await expect(page.locator('.v-case')).toHaveCount(4);await page.evaluate(async()=>{await document.fonts.ready;});
  const cards=await page.locator('.v-case').evaluateAll(elements=>elements.map(element=>{
   const card=element.getBoundingClientRect(),header=element.querySelector('header')!.getBoundingClientRect(),body=element.querySelector('.v-case-body')!.getBoundingClientRect();
   return {top:card.top,bottom:card.bottom,headerBottom:header.bottom,bodyTop:body.top};
  }));
  for(const card of cards){
   const peers=cards.filter(other=>Math.abs(other.top-card.top)<=1);
   expect(peers).toHaveLength(width<=1250?2:4);
   for(const peer of peers){
    expect(Math.abs(peer.headerBottom-card.headerBottom),`Customer header bottoms align at ${width}px`).toBeLessThanOrEqual(1);
    expect(Math.abs(peer.bodyTop-card.bodyTop),`Customer body starts align at ${width}px`).toBeLessThanOrEqual(1);
    expect(Math.abs(peer.bottom-card.bottom),`Customer cards have equal height at ${width}px`).toBeLessThanOrEqual(1);
   }
  }
  await page.goto('/privacy');await expect(page.locator('.v-privacy-hero')).toBeVisible();
  await page.evaluate(async()=>{await document.fonts.ready;});
  const artwork=await page.evaluate(()=>{
   const hero=document.querySelector('.v-privacy-hero')!.getBoundingClientRect(),note=document.querySelector('.v-privacy-hero>.v-handnote')!,shield=document.querySelector('.v-privacy-hero>.v-security-picture')!.getBoundingClientRect();
   const box=note.getBoundingClientRect();return {visible:getComputedStyle(note).display!=='none',left:box.left,right:box.right,heroLeft:hero.left,heroRight:hero.right,shieldRight:shield.right};
  });
  if(artwork.visible){
   expect(artwork.left,'Privacy note clears the shield').toBeGreaterThanOrEqual(artwork.shieldRight);
   expect(artwork.left).toBeGreaterThanOrEqual(artwork.heroLeft);
   expect(artwork.right,'Privacy note is not clipped at the right edge').toBeLessThanOrEqual(artwork.heroRight+1);
  }
 }
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
 await expect(page.locator('#availability').getByRole('link',{name:'30일 자료 이용권 준비 상태 →',exact:true})).toHaveAttribute('href','/billing');
 await page.locator('#availability').getByRole('link',{name:'문의 안내 →',exact:true}).click();await expect(page).toHaveURL(/\/privacy#contact$/);await expect(page.locator('#contact')).toBeVisible();
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
 const fixture=await researchWorkspaceFixture(page);
 const workspaceAppearance=async(target:Page)=>{
  await expect(target.locator('html')).toHaveAttribute('lang','en');
  await target.evaluate(async()=>{await document.fonts.ready;});
  return target.evaluate(()=>['.sb-redesign','.rd-header','.rd-main','.rd-header nav a','[data-screen="redesign-calendar"] h1'].map(selector=>{
   const element=document.querySelector(selector);if(!element)throw new Error(`Missing workspace element: ${selector}`);
   const style=getComputedStyle(element),box=element.getBoundingClientRect();
   return {selector,left:box.left,right:box.right,top:box.top+scrollY,
    appearance:{fontFamily:style.fontFamily,fontSize:style.fontSize,lineHeight:style.lineHeight,color:style.color,backgroundColor:style.backgroundColor,
     padding:style.padding,gap:style.gap,display:style.display,maxWidth:style.maxWidth},
    headerHeight:selector==='.rd-header'?box.height:null};
  }));
 };
 let original:Awaited<ReturnType<typeof workspaceAppearance>>|undefined;
 if(test.info().project.name==='desktop'){
  // A fresh document establishes the existing private layout before public CSS is loaded.
  const control=await page.context().newPage();
  try{
   const controlFixture=await researchWorkspaceFixture(control);await control.goto('/calendar');
   await expect(control.getByRole('link').filter({hasText:upcoming.title}).first()).toBeVisible();
   original=await workspaceAppearance(control);
   expect(controlFixture.blockedRequests).toEqual([]);expect(controlFixture.state.unexpected).toEqual([]);expect(controlFixture.state.runtimeErrors).toEqual([]);
  }finally{await control.close();}
 }
 await page.goto('/features');const calendar=page.locator('.v-widget-calendar').getByRole('link',{name:'알림 설정'});await expect(calendar).toHaveAttribute('href','/calendar');
 await page.evaluate(()=>{(window as Window&{__workspaceNavigationMarker?:string}).__workspaceNavigationMarker='retained';});
 await calendar.click();await expect(page).toHaveURL(/\/calendar$/);
 await expect(page.locator('[data-screen="redesign-calendar"]')).toBeVisible();
 await expect(page.getByRole('heading',{name:'캘린더',exact:true})).toBeVisible();
 const event=page.getByRole('link').filter({hasText:upcoming.title}).first();
 await expect(event).toBeVisible();
 await expect(event).toHaveAttribute('href',`/events/${upcoming.id}?kind=calendar`);
 expect(await page.evaluate(()=>(window as Window&{__workspaceNavigationMarker?:string}).__workspaceNavigationMarker)).toBe('retained');
 if(original){
  await expect(page.locator('.v-public-design,.reference-auth.v-account')).toHaveCount(0);
  const afterPublic=await workspaceAppearance(page);
  for(const [index,before] of original.entries()){
   const after=afterPublic[index];expect(after.appearance,`${before.selector} styles are unchanged after public navigation`).toEqual(before.appearance);
   for(const edge of ['left','right','top'] as const)expect(Math.abs(after[edge]-before[edge]),`${before.selector} ${edge} is unchanged`).toBeLessThanOrEqual(1);
   expect(after.headerHeight).toEqual(before.headerHeight);
  }
 }
 expect(fixture.blockedRequests).toEqual([]);expect(fixture.state.unexpected).toEqual([]);expect(fixture.state.runtimeErrors).toEqual([]);
});
