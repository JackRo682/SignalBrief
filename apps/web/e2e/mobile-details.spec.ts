import {expect,test,type Page,type TestInfo} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
import {answerSchema} from '../src/lib/contracts';
import {companies,companyId,documents,eventDetails,eventId,eventTitle,fixtureNow,mobileFixture,type MobileFixture} from './mobile-fixture';

// Every response is intercepted by the isolated authenticated fixture. No account,
// document provider, email service, AI model, or production database is contacted.
const main=(page:Page)=>page.locator('main#mobile-main');
const footer=(page:Page)=>page.getByRole('navigation',{name:'모바일 메뉴',exact:true});
async function healthy(page:Page,fixture:MobileFixture){
 await expect(main(page)).toBeVisible();
 await expect(page.locator('.m-loading,.ws-loading,.ws-skeleton')).toHaveCount(0);
 await expect(page.locator('.sb-mobile [role="alert"]')).toHaveCount(0);
 expect(fixture.state.unexpected,'All data requests are handled by isolated fixtures').toEqual([]);
 expect(fixture.state.runtimeErrors,'No uncaught browser, React or hydration errors').toEqual([]);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'No horizontal page overflow').toBe(true);
}
async function capture(page:Page,info:TestInfo,fixture:MobileFixture,name:string){
 await healthy(page,fixture);
 await page.evaluate(async()=>{window.scrollTo(0,0);await document.fonts.ready;await Promise.all([...document.images].filter(image=>{const box=image.getBoundingClientRect();return box.width>0&&box.height>0&&box.bottom>0&&box.top<innerHeight;}).map(async image=>{let timer:ReturnType<typeof setTimeout>|undefined;try{await Promise.race([image.decode(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error(`Image did not decode: ${image.getAttribute('src')}`)),10000);})]);if(!image.naturalWidth)throw new Error('Visible image is broken');}finally{if(timer!==undefined)clearTimeout(timer);}}));});
 const layout=await page.evaluate(()=>['.m-detail-header','.m-brand-header','.m-main','.m-question-context','.m-question-user-row','.m-question-answer','.m-question-compose','.m-document-hero','.m-document-summary-card','.m-document-metric','.m-document-toc','.m-document-related-grid','.m-timeline-company','.m-timeline-filters','.m-timeline-item','.m-timeline-insights','.m-account-profile','.m-account-row','.m-security-summary','.m-security-password','.m-appearance-preview','.m-preview-phone','.m-preview-brand','.m-preview-company','.m-preview-phone>h3','.m-appearance-control input[type=range]','.m-appearance-row','.m-help-hero','.m-help-faq','.mc-heading','.mc-month','.m-calendar-item','.mn-card','.mn-summary','.m-alert-card'].flatMap(selector=>[...document.querySelectorAll(selector)].map((node,index)=>{const rect=node.getBoundingClientRect(),style=getComputedStyle(node);return {selector,index,x:rect.x,y:rect.y,width:rect.width,height:rect.height,padding:style.padding,margin:style.margin,fontSize:style.fontSize,lineHeight:style.lineHeight};})));
 await writeFile(info.outputPath(`${name}-layout.json`),JSON.stringify(layout,null,2));
 await page.screenshot({path:info.outputPath(`${name}.png`),animations:'disabled',scale:'css'});
}
async function assertSystemDarkContrast(page:Page,info:TestInfo,name:string,selectors:string[]){
 await expect(page.locator('html')).toHaveAttribute('data-sb-theme','system');
 expect(await page.evaluate(()=>matchMedia('(prefers-color-scheme: dark)').matches)).toBe(true);
 const checks=await page.evaluate((selectors)=>{
  const rgb=(color:string)=>{const values=color.match(/[\d.]+/g)?.map(Number);if(!values||values.length<3)throw new Error(`Unsupported computed color: ${color}`);return values;};
  const luminance=(color:number[])=>{const [r,g,b]=color.map(v=>{const s=v/255;return s<=.04045?s/12.92:((s+.055)/1.055)**2.4;});return .2126*r+.7152*g+.0722*b;};
  return selectors.map(selector=>{
   const node=document.querySelector(selector);if(!node)throw new Error(`Missing contrast target: ${selector}`);
   const foreground=getComputedStyle(node).color;let parent:Element|null=node,background='';
   while(parent){const color=getComputedStyle(parent).backgroundColor,channels=rgb(color);if(channels.length<4||channels[3]===1){background=color;break;}if(channels[3]!==0)throw new Error(`Translucent contrast target: ${selector}`);parent=parent.parentElement;}
   if(!background)throw new Error(`No opaque background for ${selector}`);
   const fg=luminance(rgb(foreground)),bg=luminance(rgb(background));
   return {selector,foreground,background,backgroundLuminance:bg,contrast:(Math.max(fg,bg)+.05)/(Math.min(fg,bg)+.05)};
  });
 },selectors);
 await writeFile(info.outputPath(`${name}-contrast.json`),JSON.stringify(checks,null,2));
 for(const check of checks){expect(check.backgroundLuminance,`${check.selector} uses a dark system surface`).toBeLessThan(.15);expect(check.contrast,`${check.selector}: ${check.foreground} on ${check.background}`).toBeGreaterThanOrEqual(check.selector.includes('m-header-actions')?3:4.5);}
}
function seedConversation(fixture:MobileFixture){
 const detail=eventDetails.get(eventId)!;
 fixture.state.questions.push({id:'80000000-0000-4000-8000-000000000901',event_id:eventId,question:'매출과 수익성의 원문 근거는 무엇인가요?',answer:answerSchema.parse({status:'answered',message:'게시된 실적 자료에서 매출과 이익 수치를 확인할 수 있습니다. 아래 인용문은 검토된 원문 구간이며, 미래 실적을 보장하는 전망으로 해석하지 않습니다.',evidence:detail.evidence.slice(0,3).map(entry=>({source_id:entry.document_id,quote:entry.quote,source_url:entry.source_url,location:entry.location})),run_id:null,mode:'extractive'}),created_at:fixtureNow});
}

for(const viewport of [{width:432,height:768},{width:390,height:844}]){
 test.describe(`second mobile references ${viewport.width}x${viewport.height}`,()=>{
  test.use({viewport,deviceScaleFactor:1,isMobile:true,hasTouch:true,locale:'ko-KR',timezoneId:'Asia/Seoul',colorScheme:'light'});
  test.beforeEach(({},info)=>test.skip(info.project.name!=='mobile','These are mobile reference screens; desktop assertions remain in their existing suites.'));
  test('all ten detail references render at the reference viewport with loaded assets',async({page},info)=>{
   const fixture=await mobileFixture(page);seedConversation(fixture);
   fixture.state.preferences.bio='검토된 공시와 원문 근거를 바탕으로 기업의 변화를 확인합니다.';
   fixture.state.preferences.muted_companies=[companies[2].id,companies[1].id];
   fixture.state.reminders.add(fixture.state.calendar[0].id);
   const screens=[
    {path:`/questions?event=${eventId}`,name:'01-ai-followup',title:'AI 후속 질문',ready:'.m-question-citations>li',count:3,detail:true},
    {path:'/settings/appearance',name:'02-appearance',title:'화면 및 언어 설정',ready:'.m-appearance-row',count:6,detail:true},
    {path:'/help',name:'03-help',title:'도움말 및 지원',ready:'.m-help-hero',count:1,detail:true},
    {path:`/documents/${documents[0].id}?kind=document`,name:'04-document',title:'문서 상세',ready:'.m-document-toc>button',count:4,detail:true},
    {path:'/settings/security',name:'05-security',title:'보안 및 로그인',ready:'.m-security-summary',count:1,detail:true},
    {path:'/settings/account',name:'06-account',title:'계정 정보',ready:'.m-account-row',count:5,detail:true},
    {path:'/calendar',name:'07-calendar',title:'캘린더',ready:'.m-calendar-item',count:3,detail:false},
    {path:`/companies/${companyId}/timeline`,name:'08-timeline',title:'기업 타임라인',ready:'.m-timeline-item',count:3,detail:true},
    {path:'/settings/notifications',name:'09-notification-settings',title:'알림 설정',ready:'.mn-card',count:8,detail:true},
    {path:'/alerts',name:'10-alert-center',title:'알림 센터',ready:'.m-alert-card',count:4,detail:false},
   ];
   for(const screen of screens)await test.step(screen.name,async()=>{
    await page.goto(screen.path);await expect(main(page)).toBeVisible();
    if(screen.detail)await expect(page.locator('.m-detail-header>strong')).toHaveText(screen.title);else await expect(main(page).getByRole('heading',{level:1})).toHaveText(screen.title);
    await expect(page.locator(screen.ready)).toHaveCount(screen.count);
    if(screen.name==='01-ai-followup')await expect(footer(page)).toHaveCount(0);else await expect(footer(page)).toBeVisible();
    if(screen.name==='04-document')await expect(footer(page).getByRole('link',{name:'저장 / 기록',exact:true})).toHaveAttribute('aria-current','page');
    if(screen.name==='08-timeline')await expect(footer(page).getByRole('link',{name:'관심종목',exact:true})).toHaveAttribute('aria-current','page');
    if(screen.name==='02-appearance'){await expect(page.locator('.m-preview-company')).toHaveCount(2);for(const price of await page.locator('.m-preview-company>div>strong').all())await expect(price).toContainText(/[0-9]/);if(viewport.width===432){const preview=await page.locator('.m-appearance-preview').boundingBox();expect(preview).not.toBeNull();expect(preview!.height,'Reference appearance preview remains compact').toBeLessThanOrEqual(185);expect(preview!.y,'Reference appearance preview begins below the compact header and intro').toBeLessThanOrEqual(100);}}
    if(screen.name==='08-timeline'){await expect(page.locator('.m-timeline-company-name>strong')).toHaveText(companies[0].name);await expect(page.locator('.m-timeline-quote>strong')).toContainText(/[0-9]/);}
    if(screen.name==='05-security')await expect(page.getByRole('switch',{name:'2단계 인증',exact:true})).toHaveAttribute('aria-checked','false');
    if(screen.name==='06-account'){await expect(page.locator('.m-account-email')).toHaveText('mobile-fixture@example.invalid');await expect(page.locator('.m-account-profile h2')).toContainText(fixture.state.profile.display_name!);}
    await capture(page,info,fixture,screen.name);
   });
   expect(fixture.state.authCalls.filter(call=>call.method!=='GET'),'Gallery never mutates authentication').toEqual([]);
  });

  test('source sections, exact citations, persistent questions and timeline filters work through their routes',async({page},info)=>{
   const fixture=await mobileFixture(page);seedConversation(fixture);
   await page.goto(`/documents/${documents[0].id}?kind=document`);
   await expect(page.getByRole('link',{name:'원문 열기',exact:true})).toHaveAttribute('href',documents[0].source_url!);
   await page.getByRole('button',{name:'문서 저장 취소',exact:true}).click();
   await expect(page.getByRole('button',{name:'문서 저장',exact:true})).toBeVisible();
   expect(fixture.state.saved.has(`document:${documents[0].id}`)).toBe(false);
   await page.getByRole('button',{name:'문서 저장',exact:true}).click();
   await expect(page.getByRole('button',{name:'문서 저장 취소',exact:true})).toBeVisible();
   await page.locator('.m-document-toc>button').first().click();
   const section=page.getByRole('dialog',{name:'매출 요약',exact:true});
   await expect(section.locator('.m-document-section-content')).toHaveText(eventDetails.get(eventId)!.facts[0].quote);
   await section.getByRole('button',{name:'닫기',exact:true}).click();
   await page.locator('.m-document-metric').first().click();
   const metric=page.getByRole('dialog',{name:'매출 · 원문 근거',exact:true});
   await expect(metric.locator('.m-document-fact-value')).toHaveText('45,000 USD million');
   await expect(metric.getByRole('link',{name:'연결된 이벤트 근거',exact:true})).toHaveAttribute('href',`/events/${eventId}?panel=evidence`);
   await metric.getByRole('button',{name:'닫기',exact:true}).click();
   await page.getByRole('link',{name:'이 문서로 AI에게 질문하기',exact:true}).click();
   await expect(page).toHaveURL(new RegExp(`/questions\\?event=${eventId}$`));
   await expect(page.locator('.m-question-citations>li')).toHaveCount(3);
   await expect(page.locator('.m-question-citations a').first()).toHaveAttribute('href',documents[0].source_url!);
   await page.getByRole('button',{name:'매출 수치 근거',exact:true}).click();
   await expect(page.getByLabel('공시에 관한 질문',{exact:true})).toHaveValue('매출 수치의 근거를 보여줘');
   await page.getByRole('button',{name:'질문 보내기',exact:true}).click();
   await expect(page.locator('.m-question-answer')).toHaveCount(2);
   expect(fixture.state.questions).toHaveLength(2);
   await page.reload();await expect(page.locator('.m-question-answer')).toHaveCount(2);await healthy(page,fixture);
   await page.getByRole('button',{name:'이벤트 선택 및 질문 기록',exact:true}).click();
   await expect(page.getByRole('combobox',{name:'질문할 이벤트',exact:true})).toBeFocused();
   await expect(page.locator('.m-question-history-item')).toHaveCount(2);

   await page.goto('/timeline');await page.getByLabel('기업명 또는 종목코드 검색',{exact:true}).fill('엔비디아');
   await expect(page.getByRole('combobox',{name:'타임라인 기업 선택',exact:true})).toBeEnabled();
   await page.getByRole('combobox',{name:'타임라인 기업 선택',exact:true}).selectOption(companyId);
   await expect(page.locator('.m-timeline-item')).toHaveCount(3);
   await page.getByRole('button',{name:'실적 (1)',exact:true}).click();await expect(page.locator('.m-timeline-item')).toHaveCount(1);
   await expect(page.locator('.m-timeline-item h2')).toHaveText(eventTitle);
   await page.getByRole('button',{name:'전체 (3)',exact:true}).click();
   await page.getByLabel('기간',{exact:true}).selectOption('90');await expect(page.locator('.m-timeline-item')).toHaveCount(3);
   await expect.poll(()=>fixture.state.apiCalls.some(call=>call.path===`/v1/companies/${companyId}/timeline`)).toBe(true);
   await page.getByRole('button',{name:'분석 근거 보기',exact:true}).click();await expect(page.locator('.m-timeline-reviewed section')).toHaveCount(3);
   await page.locator('.m-timeline-item').first().getByRole('link').first().click();await expect(page).toHaveURL(new RegExp(`/events/${eventId}$`));
   await expect(page.locator('.m-detail-header>strong')).toHaveText('이벤트 상세');await healthy(page,fixture);
   await capture(page,info,fixture,'11-source-event-navigation');
  });

  test('calendar saved dates, alert read counts and notification preferences persist',async({page})=>{
   const fixture=await mobileFixture(page);await page.goto('/calendar');await expect(page.locator('.m-calendar-item')).toHaveCount(3);
   const reminder=page.getByRole('switch',{name:`${fixture.state.calendar[0].title} 관심 일정`,exact:true});
   await expect(reminder).toBeEnabled();await reminder.click();await expect(reminder).toHaveAttribute('aria-checked','true');
   expect(fixture.state.reminders.has(fixture.state.calendar[0].id)).toBe(true);
   await page.reload();await expect(reminder).toHaveAttribute('aria-checked','true');
   await page.getByRole('button',{name:'다음 달',exact:true}).click();await expect(page.locator('.m-calendar-item')).toHaveCount(0);
   await page.getByRole('button',{name:'이전 달',exact:true}).click();await expect(page.locator('.m-calendar-item')).toHaveCount(3);
   await page.getByRole('button',{name:'오늘',exact:true}).click();await expect(page.locator('.m-calendar-item')).toHaveCount(1);
   await page.getByRole('button',{name:'월 전체 보기',exact:true}).click();await expect(page.locator('.m-calendar-item')).toHaveCount(3);
   await page.getByRole('navigation',{name:'캘린더 보기',exact:true}).getByRole('button',{name:'내 일정',exact:true}).click();
   await expect(page.locator('.m-calendar-item')).toHaveCount(0);
   await page.getByRole('button',{name:'일정 추가',exact:true}).click();const add=page.getByRole('dialog',{name:'내 확인 일정 추가',exact:true});
   await add.getByLabel('제목',{exact:true}).fill('합성 검증: 다음 공시 확인');await add.getByLabel('날짜',{exact:true}).fill('2026-10-09');await add.getByRole('button',{name:'일정 저장',exact:true}).click();
   await expect(add).toHaveCount(0);await expect(page.locator('.m-calendar-item')).toHaveCount(1);expect(fixture.state.calendar.some(item=>item.origin==='user'&&item.occurs_on==='2026-10-09')).toBe(true);
   await healthy(page,fixture);

   await page.goto('/alerts');await expect(page.locator('.m-alert-card')).toHaveCount(4);await expect(page.getByLabel('2 읽지 않은 알림',{exact:true})).toBeVisible();
   await page.getByRole('button',{name:`${eventTitle} 읽음으로 표시`,exact:true}).click();await expect(page.getByLabel('1 읽지 않은 알림',{exact:true})).toBeVisible();
   expect(fixture.state.notifications.filter(item=>item.read_at===null)).toHaveLength(1);
   await page.locator('.ma-tabs').getByRole('button',{name:/^읽지 않음/}).click();await expect(page.locator('.m-alert-card')).toHaveCount(1);
   await page.getByRole('button',{name:'모두 확인하기',exact:true}).click();await expect(page.locator('.m-alert-card')).toHaveCount(0);
   expect(fixture.state.notifications.every(item=>item.read_at!==null)).toBe(true);
   await page.goto('/settings/notifications');await expect(page.getByRole('switch',{name:'이메일 알림 — 미제공',exact:true})).toBeDisabled();
   const inApp=page.getByRole('switch',{name:'앱 내 알림',exact:true});await expect(inApp).toBeEnabled();await inApp.click();await expect(inApp).toHaveAttribute('aria-checked','false');
   await page.getByRole('switch',{name:'방해 금지 시간',exact:true}).click();await expect.poll(()=>fixture.state.preferences.quiet_enabled).toBe(true);
   await page.getByRole('button',{name:'기업 추가하기',exact:true}).click();const mute=page.getByRole('dialog',{name:'알림 제외 기업 추가',exact:true});
   await mute.getByLabel('기업 검색',{exact:true}).fill('TSLA');await mute.getByRole('button',{name:'테슬라 · TSLA',exact:true}).click();await expect(mute).toHaveCount(0);
   expect(fixture.state.preferences.muted_companies).toContain(companies[2].id);
   const cap=page.getByRole('slider',{name:'일일 최대 알림 수',exact:true});await cap.press('Home');await cap.press('ArrowRight');await cap.press('ArrowRight');await cap.press('ArrowRight');await cap.press('ArrowRight');await page.getByRole('button',{name:'최대 수 적용',exact:true}).click();
   await expect.poll(()=>fixture.state.preferences.daily_cap).toBe(5);await page.reload();await expect(inApp).toHaveAttribute('aria-checked','false');await expect(cap).toHaveValue('5');await healthy(page,fixture);
  });

  test('account and security navigation, help FAQs and appearance preferences remain accessible',async({page},info)=>{
   const fixture=await mobileFixture(page);await page.goto('/settings/account');await page.getByRole('button',{name:'프로필 수정',exact:true}).click();
   const profile=page.getByRole('dialog',{name:'프로필 수정',exact:true});await expect(profile.getByLabel('이름',{exact:true})).toHaveValue('김투자');await profile.getByLabel('한 줄 소개',{exact:true}).fill('로컬 합성 화면 검증');await profile.getByRole('button',{name:'닫기',exact:true}).click();
   await page.getByRole('link',{name:/^연결된 로그인 수단 /}).click();await expect(page).toHaveURL(/\/settings\/security$/);
   await expect(page.getByRole('switch',{name:'2단계 인증',exact:true})).toHaveAttribute('aria-checked','false');
   await page.getByRole('button',{name:'전체 기기 관리',exact:true}).click();const sessions=page.getByRole('dialog',{name:'활성 세션 / 기기',exact:true});
   await sessions.locator('.m-security-record').first().click();const session=page.getByRole('dialog',{name:'로그인 세션 상세',exact:true});await expect(session).toContainText('Synthetic Chromium mobile');await session.getByRole('button',{name:'닫기',exact:true}).click();await sessions.getByRole('button',{name:'닫기',exact:true}).click();
   expect(fixture.state.authCalls.filter(call=>call.method!=='GET'),'No authentication mutation is made by navigation or inspection').toEqual([]);
   await footer(page).getByRole('link',{name:'설정',exact:true}).click();await expect(page).toHaveURL(/\/settings$/);
   await page.goto('/help');await page.getByLabel('도움말 검색',{exact:true}).fill('알림');await page.getByRole('button',{name:'도움말 검색 실행',exact:true}).click();
   await expect(page.locator('.m-help-faq')).not.toHaveCount(0);await page.locator('.m-help-faq h3 button').first().click();
   await expect(page.locator('.m-help-faq h3 button').first()).toHaveAttribute('aria-expanded','true');
   await healthy(page,fixture);

   await page.goto('/settings/appearance');await page.getByRole('radio',{name:'다크',exact:true}).click();await expect(page.locator('html')).toHaveAttribute('data-sb-theme','dark');
   await page.reload();await expect(page.getByRole('radio',{name:'다크',exact:true})).toHaveAttribute('aria-checked','true');
   await page.getByRole('radio',{name:'라이트',exact:true}).click();await expect(page.locator('html')).toHaveAttribute('data-sb-theme','light');
   await page.getByRole('switch',{name:'움직임 최소화',exact:true}).click();await expect(page.getByRole('switch',{name:'차트 애니메이션',exact:true})).toBeDisabled();
   const font=page.getByRole('slider',{name:'글자 크기',exact:true});await font.press('End');await expect.poll(()=>fixture.state.preferences.font_scale).toBe(3);
   await expect.poll(()=>page.evaluate(()=>document.documentElement.style.getPropertyValue('--sb-font-scale'))).toBe('1.16');
   for(const path of ['/settings/appearance','/settings/notifications','/calendar','/alerts',`/companies/${companyId}/timeline`,`/documents/${documents[0].id}?kind=document`]){await page.goto(path);await expect(main(page).getByRole('heading',{level:1})).toHaveCount(1);await expect.poll(()=>page.evaluate(()=>document.documentElement.style.getPropertyValue('--sb-font-scale'))).toBe('1.16');await healthy(page,fixture);}
   await capture(page,info,fixture,'12-document-large-text');
   await page.emulateMedia({colorScheme:'dark'});await page.goto('/settings/appearance');
   await page.getByRole('radio',{name:'시스템',exact:true}).click();await expect.poll(()=>fixture.state.preferences.theme).toBe('system');
   const darkPages=[
    {path:'/help',name:'13-help-system-dark',ready:'.m-help-hero',selectors:['.m-help-hero h2','.m-help-faq.open p','.m-help-chips>button','.m-detail-header .m-header-actions .m-icon-button svg'],screenshot:true},
    {path:'/settings/account',name:'14-account-system-dark',ready:'.m-account-info',selectors:['.m-account-info strong','.m-account-info p','.m-account-profile>button','.m-detail-header .m-header-actions .m-icon-button svg'],screenshot:false},
    {path:'/settings/security',name:'15-security-system-dark',ready:'.m-security-record em',selectors:['.m-security-summary h2','.m-security-record em','.m-detail-header .m-header-actions .m-icon-button svg'],screenshot:true},
   ];
   for(const screen of darkPages){await page.goto(screen.path);await expect(page.locator(screen.ready).first()).toBeVisible();await healthy(page,fixture);await assertSystemDarkContrast(page,info,screen.name,screen.selectors);if(screen.screenshot)await capture(page,info,fixture,screen.name);}

  });
 });
}
