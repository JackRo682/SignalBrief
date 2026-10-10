import {expect,test,type Page,type TestInfo} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
import {companies,companyId,documents,eventDetails,eventId,eventTitle,type MobileFixture} from './mobile-fixture';
import {desktopFixture,desktopQuestion,desktopQuestionId} from './desktop-fixture';

// Authentication, API, provider and workspace requests are isolated by the
// fixture. These journeys never write to a real account or contact an AI model.
const screens=[
 {path:'/today',name:'01-today',ready:'.pc-today-change',mobile:'.m-today'},
 {path:'/explore',name:'02-explore',ready:'.pc-discovery-company-grid>a',mobile:'.m-search-company-tile'},
 {path:'/search?q=%EC%97%94%EB%B9%84%EB%94%94%EC%95%84',name:'03-search',ready:'.pc-search-result-company',mobile:'.m-search-result-company'},
 {path:`/companies/${companyId}`,name:'04-company',ready:'.pc-company-hero',mobile:'.m-company-profile'},
 {path:`/companies/${companyId}/timeline`,name:'05-timeline',ready:'.pc-timeline-item',mobile:'.m-timeline-item'},
 {path:`/events/${eventId}`,name:'06-event',ready:'.pc-event-hero',mobile:'.m-event-hero'},
 {path:`/events/${eventId}?panel=evidence`,name:'07-evidence',ready:'.pc-evidence-source',mobile:'.m-event-expanded-evidence'},
 {path:`/questions?event=${eventId}`,name:'08-questions',ready:'.pc-question-citations>li',mobile:'.m-question-citations>li'},
 {path:`/documents/${documents[0].id}?kind=document`,name:'09-document',ready:'.pc-document-toc>button',mobile:'.m-document-toc>button'},
 {path:'/watchlist',name:'10-watchlist',ready:'.pc-watch-table tbody tr',mobile:'.m-watch-card'},
];
const main=(page:Page)=>page.locator('main#pc-main');
async function healthy(page:Page,fixture:MobileFixture){
 await expect(main(page)).toBeVisible();
 await expect(page.locator('.sb-mobile')).toHaveCount(0);
 await expect(page.locator('.sb-pc .pc-loading,.sb-pc .ws-loading,.sb-pc .ws-skeleton')).toHaveCount(0);
 await expect(main(page).getByRole('alert')).toHaveCount(0);
 await expect(page.locator('.sb-pc .pc-chart-empty')).toHaveCount(0);
 await expect(main(page)).not.toContainText('기준환율 확인 중…');
 expect(fixture.state.unexpected,'Every provider/data request is handled by the isolated fixture').toEqual([]);
 expect(fixture.state.runtimeErrors,'No uncaught browser or hydration errors').toEqual([]);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'No horizontal page overflow').toBe(true);
}
async function capture(page:Page,info:TestInfo,fixture:MobileFixture,name:string){
 await healthy(page,fixture);
 await page.evaluate(async()=>{window.scrollTo(0,0);await document.fonts.ready;await Promise.all([...document.images].filter(image=>{const box=image.getBoundingClientRect();return box.width>0&&box.height>0&&box.bottom>0&&box.top<innerHeight;}).map(async image=>{let timer:ReturnType<typeof setTimeout>|undefined;try{await Promise.race([image.decode(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error(`Image did not decode: ${image.getAttribute('src')}`)),10000);})]);if(!image.naturalWidth)throw new Error('Visible image is broken');}finally{if(timer!==undefined)clearTimeout(timer);}}));});
 const layout=await page.evaluate(()=>['.pc-sidebar','.pc-topbar','.pc-main','.pc-heading','.pc-today-summary','.pc-today-change','.pc-discovery-form','.pc-discovery-history-grid','.pc-search-result','.pc-company-hero','.pc-timeline-hero','.pc-timeline-item','.pc-event-hero','.pc-event-metrics','.pc-evidence-context','.pc-evidence-source','.pc-evidence-claim','.pc-question-heading','.pc-question-context','.pc-question-user','.pc-question-answer','.pc-question-sources','.pc-question-compose','.pc-document-hero','.pc-document-toc','.pc-watch-summary','.pc-watch-table'].flatMap(selector=>[...document.querySelectorAll(selector)].map((node,index)=>{const rect=node.getBoundingClientRect(),style=getComputedStyle(node);return {selector,index,x:rect.x,y:rect.y,width:rect.width,height:rect.height,padding:style.padding,margin:style.margin,fontSize:style.fontSize,lineHeight:style.lineHeight};})));
 await writeFile(info.outputPath(`${name}-layout.json`),JSON.stringify(layout,null,2));
 await page.screenshot({path:info.outputPath(`${name}.png`),animations:'disabled',scale:'css'});
}

for(const viewport of [{width:1448,height:1086},{width:1280,height:900}])test.describe(`PC references ${viewport.width}x${viewport.height}`,()=>{
 test.use({viewport,deviceScaleFactor:1,isMobile:false,hasTouch:false,locale:'ko-KR',timezoneId:'Asia/Seoul',colorScheme:'light'});
 test.beforeEach(({},info)=>test.skip(info.project.name!=='desktop','Desktop reference coverage runs in the desktop project.'));
 test('all ten references render complete API data with decoded assets',async({page},info)=>{
  const fixture=await desktopFixture(page);
  for(const screen of screens)await test.step(screen.name,async()=>{
   await page.goto(screen.path);await expect(page.locator(screen.ready).first()).toBeVisible();
   await expect(main(page).getByRole('heading',{level:1})).toHaveCount(1);
   if(screen.name==='01-today')await expect(page.locator('.pc-today-gainers>a').first()).toBeVisible();
   if(screen.name==='05-timeline')await expect(page.locator('.pc-timeline-item')).toHaveCount(3);
   if(screen.name==='07-evidence'){await expect(page.locator('.pc-evidence-source')).toHaveCount(1);await expect(page.locator('.pc-evidence-claim')).toHaveCount(4);}
   if(screen.name==='08-questions')await expect(page.locator('.pc-question-citations>li')).toHaveCount(3);
   if(screen.name==='09-document')await expect(page.locator('.pc-document-toc>button')).toHaveCount(4);
   if(screen.name==='10-watchlist')await expect(page.locator('.pc-watch-table tbody tr')).toHaveCount(4);
   await capture(page,info,fixture,screen.name);
  });
  expect(fixture.state.authCalls.filter(call=>call.method!=='GET'),'Screenshots do not mutate authentication').toEqual([]);
 });
});

test.describe('PC persistent research journey',()=>{
 test.use({viewport:{width:1448,height:1086},deviceScaleFactor:1,isMobile:false,hasTouch:false,locale:'ko-KR',timezoneId:'Asia/Seoul',colorScheme:'light'});
 test.beforeEach(({},info)=>test.skip(info.project.name!=='desktop','Desktop controls are exercised in the desktop project.'));
 test('search, watchlist, source navigation, saves and questions use persistent real contracts',async({page},info)=>{
  const fixture=await desktopFixture(page),detail=eventDetails.get(eventId)!,initialVisits=fixture.state.visits.size;
  await page.goto('/explore');
  await page.getByRole('button',{name:'테슬라 검색 기록 삭제',exact:true}).click();
  await expect(page.getByRole('button',{name:'테슬라 검색 기록 삭제',exact:true})).toHaveCount(0);
  expect(fixture.state.visits.size).toBe(initialVisits);
  await page.locator('.pc-discovery-form').getByRole('textbox',{name:'기업, 키워드 또는 산업 검색',exact:true}).fill('엔비디아');
  await page.locator('.pc-discovery-form').getByRole('button',{name:'검색',exact:true}).click();
  await expect(page.locator('.pc-search-result-company')).toHaveCount(1);
  await page.getByRole('combobox',{name:'시장 필터',exact:true}).selectOption('NASDAQ');
  await expect(page).toHaveURL(/market=NASDAQ/);
  await page.locator('.pc-search-result-company .pc-search-result-title').click();
  await expect(page).toHaveURL(new RegExp(`/companies/${companyId}$`));
  await expect(page.locator('.pc-company-hero')).toBeVisible();
  await page.getByRole('link',{name:'전체 타임라인 보기',exact:true}).click();
  await expect(page.locator('.pc-timeline-item')).toHaveCount(3);
  await page.getByRole('group',{name:'이벤트 유형',exact:true}).getByRole('button',{name:/실적/}).click();
  await expect(page.locator('.pc-timeline-item')).toHaveCount(1);
  await expect(page.locator('.pc-timeline-item h2')).toHaveText(eventTitle);
  await page.locator('.pc-timeline-event-title').click();
  await expect(page).toHaveURL(new RegExp(`/events/${eventId}$`));
  await page.getByRole('button',{name:'이벤트 저장',exact:true}).click();
  await expect(page.getByRole('button',{name:'이벤트 저장 취소',exact:true})).toBeVisible();
  expect(fixture.state.saved.has(`event:${eventId}`)).toBe(true);
  await page.reload();await expect(page.getByRole('button',{name:'이벤트 저장 취소',exact:true})).toBeVisible();
  await page.getByRole('link',{name:'근거 전체 보기',exact:true}).click();
  await expect(page.locator('.pc-evidence-source')).toHaveCount(1);
  await page.getByRole('button',{name:'인용 전문 보기',exact:true}).first().click();
  const evidence=page.getByRole('dialog',{name:'원문 근거',exact:true});
  await expect(evidence.locator('.pc-research-full-quote')).toHaveText(detail.evidence[0].quote);
  await expect(evidence.getByRole('link',{name:'공식 원문 열기',exact:true})).toHaveAttribute('href',detail.evidence[0].source_url);
  await evidence.getByRole('button',{name:'닫기',exact:true}).click();
  await page.getByRole('combobox',{name:'근거 시점 필터',exact:true}).selectOption('previous');
  await expect(page.locator('.pc-evidence-source')).toHaveCount(0);
  await page.getByRole('combobox',{name:'근거 시점 필터',exact:true}).selectOption('current');
  await page.locator('.pc-evidence-source header').getByRole('link',{name:detail.document.title,exact:true}).click();
  await expect(page).toHaveURL(new RegExp(`/documents/${documents[0].id}\\?kind=document$`));
  await page.getByRole('button',{name:'문서 저장 취소',exact:true}).click();
  await expect(page.getByRole('button',{name:'문서 저장',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'문서 저장',exact:true}).click();
  await expect(page.getByRole('button',{name:'문서 저장 취소',exact:true})).toBeVisible();
  await page.locator('.pc-document-toc>button').first().click();
  const section=page.getByRole('dialog',{name:'매출 요약',exact:true});
  await expect(section.locator('.pc-document-section-content')).toHaveText(detail.facts[0].quote);
  await section.getByRole('button',{name:'닫기',exact:true}).click();
  await page.getByRole('link',{name:'AI에게 질문하기',exact:true}).click();
  await expect(page.locator('.pc-question-answer')).toHaveCount(1);
  await page.getByRole('button',{name:'매출 수치 근거',exact:true}).click();
  await expect(page.getByRole('textbox',{name:'공시에 관한 질문',exact:true})).toHaveValue('매출 수치의 근거를 보여줘');
  await page.getByRole('button',{name:'질문 보내기',exact:true}).click();
  await expect(page.locator('.pc-question-answer')).toHaveCount(2);
  expect(fixture.state.questions).toHaveLength(2);
  await page.reload();await expect(page.locator('.pc-question-answer')).toHaveCount(2);
  await page.getByRole('button',{name:'질문 기록',exact:true}).click();
  await page.getByRole('dialog',{name:'최근 질문 기록',exact:true}).getByRole('button',{name:new RegExp(desktopQuestion)}).click();
  await expect(page).toHaveURL(new RegExp(`question=${desktopQuestionId}$`));
  await expect(page.locator(`#pc-question-${desktopQuestionId}`)).toHaveClass(/selected/);
  await healthy(page,fixture);

  await page.goto('/watchlist');await expect(page.locator('.pc-watch-table tbody tr')).toHaveCount(4);
  await page.getByRole('button',{name:'종목 추가',exact:true}).click();
  const add=page.getByRole('dialog',{name:'관심종목 추가',exact:true});
  await add.getByRole('textbox',{name:'기업명 또는 종목코드',exact:true}).fill('AVGO');
  await add.getByRole('button',{name:'브로드컴 추가',exact:true}).click();
  await expect(add.getByRole('button',{name:'브로드컴 추가됨',exact:true})).toBeDisabled();
  await add.getByRole('button',{name:'닫기',exact:true}).click();
  await page.reload();await expect(page.locator('.pc-watch-table tbody tr')).toHaveCount(5);
  const notification=page.getByRole('button',{name:'브로드컴 알림',exact:true});
  await notification.click();await expect(notification).toHaveAttribute('aria-pressed','false');
  expect(fixture.state.preferences.muted_companies).toContain(companies[4].id);
  await page.reload();await expect(notification).toHaveAttribute('aria-pressed','false');
  await page.getByLabel('브로드컴 더 보기',{exact:true}).click();
  const row=page.locator('.pc-watch-table tbody tr').filter({has:page.locator(`a[href="/companies/${companies[4].id}"]`)});
  await row.getByRole('button',{name:'관심종목 삭제',exact:true}).click();
  await expect(page.locator('.pc-watch-table tbody tr')).toHaveCount(4);
  await page.reload();await expect(page.locator('.pc-watch-table tbody tr')).toHaveCount(4);
  await capture(page,info,fixture,'11-persisted-journey');
  expect(fixture.state.apiCalls.find(call=>call.method==='POST'&&call.path===`/v1/events/${eventId}/questions`)?.body).toEqual({question:'매출 수치의 근거를 보여줘'});
  expect(fixture.state.apiCalls.filter(call=>call.path===`/v1/watchlist/${companies[4].id}`).map(call=>call.method)).toEqual(['PUT','DELETE']);
  expect(fixture.state.calls.some(call=>call.action==='search_delete'&&call.p.query==='테슬라')).toBe(true);
  expect(fixture.state.calls.filter(call=>call.action==='save').map(call=>call.p)).toEqual([{kind:'event',id:eventId,saved:true},{kind:'document',id:documents[0].id,saved:false},{kind:'document',id:documents[0].id,saved:true}]);
  expect(fixture.state.authCalls.filter(call=>call.method!=='GET')).toEqual([]);
 });
});

// Retain the full pre-existing mobile-authenticated/mobile-details suites. This
// additional route matrix proves the PC branch never replaces their mobile DOM.
for(const viewport of [{width:432,height:768},{width:390,height:844}])test.describe(`mobile branch isolation ${viewport.width}`,()=>{
 test.use({viewport,deviceScaleFactor:1,isMobile:true,hasTouch:true,locale:'ko-KR',timezoneId:'Asia/Seoul',colorScheme:'light'});
 test.beforeEach(({},info)=>test.skip(info.project.name!=='mobile','Mobile isolation runs in the mobile project.'));
 test('all PC routes retain the established mobile components',async({page},info)=>{
  const fixture=await desktopFixture(page);
  for(const screen of screens)await test.step(screen.name,async()=>{
   await page.goto(screen.path);await expect(page.locator('main#mobile-main')).toBeVisible();
   await expect(page.locator('.sb-pc')).toHaveCount(0);
   await expect(page.locator(screen.mobile).first()).toBeVisible();
   await expect(page.locator('.m-loading,.ws-loading,.ws-skeleton')).toHaveCount(0);
   await expect(page.locator('.sb-mobile [role="alert"]')).toHaveCount(0);
   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
   await page.evaluate(async()=>{window.scrollTo(0,0);await document.fonts.ready;});
   await page.screenshot({path:info.outputPath(`unchanged-${screen.name}.png`),animations:'disabled',scale:'css'});
  });
  expect(fixture.state.unexpected).toEqual([]);expect(fixture.state.runtimeErrors).toEqual([]);
  expect(fixture.state.authCalls.filter(call=>call.method!=='GET')).toEqual([]);
 });
});
