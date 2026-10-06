import {test,expect,type Page} from '@playwright/test';
import {defaults,documentDetailSchema,type Preferences,type Resource} from '../src/workspace/contracts';
// Synthetic fixtures are confined to this isolated browser suite; never imported by the app.
const userId='10000000-0000-4000-8000-000000000071',companyId='20000000-0000-4000-8000-000000000001',filingId='30000000-0000-4000-8000-000000000001';
const company:Resource={id:companyId,kind:'company',title:'Synthetic Company',summary:'',company_id:companyId,company_name:'Synthetic Company',ticker:'TEST',market:'NASDAQ',source_url:null,published_at:null,publication_precision:'timestamp',category:'company',is_saved:false};
const filing:Resource={...company,id:filingId,kind:'filing',title:'Synthetic Company · 10-K',summary:'Synthetic source fixture',source_url:'https://www.sec.gov/Archives/edgar/data/1/fixture.htm',published_at:'2026-10-01T00:00:00Z',publication_precision:'date',category:'10-K'};
async function fixture(page:Page,stepUp=false){
 const calls:{action:string;p:Record<string,unknown>}[]=[];let preferences:Preferences={...defaults},version=0,saved=false,failSave=false,failSearch=false,history=false;const searches:{query:string;searched_at:string}[]=[];
 const tickets:Record<string,unknown>[]=[];let factors:Record<string,unknown>[]=stepUp?[{id:'60000000-0000-4000-8000-000000000001',status:'verified',factor_type:'totp',friendly_name:'Synthetic authenticator'}]:[];let assured=!stepUp;
 const user={id:userId,aud:'authenticated',role:'authenticated',email:'synthetic@example.invalid',email_confirmed_at:'2026-10-01T00:00:00Z',created_at:'2026-10-01T00:00:00Z',user_metadata:{},app_metadata:{provider:'email',providers:['email']},identities:[{id:userId,identity_id:userId,user_id:userId,provider:'email',identity_data:{email:'synthetic@example.invalid'}}],factors};
 const token=[{alg:'HS256',typ:'JWT'},{sub:userId,role:'authenticated',aud:'authenticated',aal:'aal1',exp:Math.floor(Date.now()/1000)+3600,iat:Math.floor(Date.now()/1000),session_id:'50000000-0000-4000-8000-000000000001'},'test-signature'].map(x=>typeof x==='string'?x:Buffer.from(JSON.stringify(x)).toString('base64url')).join('.');
 const strongToken=token.split('.').map((part,i)=>i===1?Buffer.from(JSON.stringify({...JSON.parse(Buffer.from(part,'base64url').toString()),aal:'aal2'})).toString('base64url'):part).join('.');
 await page.addInitScript(({token,user})=>{if(!localStorage.getItem('sb-test-project-auth-token'))localStorage.setItem('sb-test-project-auth-token',JSON.stringify({access_token:token,refresh_token:'isolated-refresh',expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,token_type:'bearer',user}));},{token,user});
 await page.route('**/api/auth-config',r=>r.fulfill({json:{url:'https://test-project.supabase.co',publishableKey:'sb_publishable_isolated_fixture'}}));
 await page.route('https://test-project.supabase.co/auth/v1/**',async r=>{const u=new URL(r.request().url()),method=r.request().method();let data:unknown={...user,factors};if(u.pathname.endsWith('/factors')&&method==='POST'){factors=[{id:'60000000-0000-4000-8000-000000000001',status:'unverified',factor_type:'totp',friendly_name:'Synthetic authenticator'}];data={...factors[0],totp:{qr_code:'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160"><rect width="160" height="160" fill="gray"/></svg>',secret:'SYNTHETIC-NOT-A-SECRET',uri:'otpauth://totp/Synthetic'}};}else if(u.pathname.endsWith('/challenge'))data={id:'70000000-0000-4000-8000-000000000001',expires_at:Math.floor(Date.now()/1000)+300};else if(u.pathname.endsWith('/verify')){if(r.request().postDataJSON().code!=='123456'){await r.fulfill({status:400,json:{msg:'Invalid synthetic code'},headers:{'Access-Control-Allow-Origin':'*'}});return;}assured=true;factors=factors.map(f=>({...f,status:'verified'}));data={access_token:assured?strongToken:token,refresh_token:'isolated-refresh',expires_in:3600,token_type:'bearer',user:{...user,factors}};}else if(method==='DELETE'){factors=[];data={};}else if(u.pathname.endsWith('/token'))data={access_token:assured?strongToken:token,refresh_token:'isolated-refresh',expires_in:3600,token_type:'bearer',user:{...user,factors}};else if(u.pathname.endsWith('/logout'))data={};await r.fulfill({json:data,headers:{'Access-Control-Allow-Origin':'*'}});});
 await page.route('**/v1/**',async r=>{if(new URL(r.request().url()).hostname.endsWith('.supabase.co')){await r.fallback();return;}const path=new URL(r.request().url()).pathname;if(path.endsWith('/me')&&!assured){await r.fulfill({status:403,json:{error:{code:'mfa_required'}}});return;}let data:unknown=[];if(path.endsWith('/config'))data={demo_mode:false,demo_admin_enabled:false,auth_mode:'supabase'};else if(path.endsWith('/me'))data={id:userId,display_name:'Synthetic User',density:'advanced',onboarding_completed:true,analytics_consent:false,is_admin:false,demo_mode:false};else if(path.endsWith('/watchlist'))data={id:'watch',name:'Watch',items:[]};else if(path.endsWith('/portfolio'))data={id:'portfolio',name:'Portfolio',positions:[]};await r.fulfill({json:data});});
 await page.route('**/api/market?**',r=>r.fulfill({json:{quotes:[],available:false,reason:'provider_not_configured'}}));
 await page.route('**/api/workspace',async r=>{const {action,p}=r.request().postDataJSON();calls.push({action,p});let data:unknown={};const resource={...filing,is_saved:saved};
 switch(action){case 'preferences':data={value:preferences,version};break;
 case 'preferences_save':if(failSave){await r.fulfill({status:409,json:{error:{code:'version_conflict'}}});return;}preferences={...preferences,...p.value};version++;data={value:preferences,version};break;
 case 'catalog':{if(failSearch){await r.fulfill({status:503,json:{error:{code:'provider_unavailable'}}});return;}const all=[company,resource].filter(x=>(!p.q||`${x.title} ${x.ticker} ${x.category}`.toLowerCase().includes(p.q.toLowerCase()))&&(!p.market||x.market===p.market));const filtered=all.filter(x=>!p.kind||x.kind===p.kind||p.kind==='document'&&x.kind==='filing');data={items:filtered.slice(p.offset??0,(p.offset??0)+(p.limit??20)),total:filtered.length,counts:all.reduce((a,x)=>({...a,[x.kind]:(a[x.kind]??0)+1}),{} as Record<string,number>),markets:['NASDAQ'],next_offset:null};break;}
 case 'company':data={company,events:[],documents:[resource],facts:[],watching:false,holding:false};break;
 case 'resource':data=resource;break;
 case 'document_detail':data=documentDetailSchema.parse({document:resource,metadata:{mime_type:null,size_bytes:null,page_count:null,provider:'sec',publication_timezone:'America/New_York',ingested_at:'2026-10-01T01:00:00Z',raw_sha256:null},summaries:[],facts:[],sections:[],sections_total:0,next_section_offset:null,events:[],related:[],counts:{summaries:0,facts:0,events:0,related:0}});break;
 case 'saved_list':data={items:p.kind==='history'?(history?[company]:[]):saved&&p.kind!=='event'?[{...resource,saved_at:'2026-10-05T01:00:00Z'}]:[],counts:{event:0,document:saved?1:0,history:history?1:0}};break;
 case 'save':saved=p.saved;data={saved};break;case 'visit':history=preferences.history_enabled;data={recorded:history};break;
 case 'searches':data=searches;break;case 'search_record':if(preferences.history_enabled)searches.push({query:p.query,searched_at:new Date().toISOString()});data={recorded:preferences.history_enabled};break;
 case 'history_clear':searches.splice(0);history=false;data={cleared:true};break;
 case 'searches_clear':searches.splice(0);data={cleared:true};break;
 case 'search_delete':{const index=searches.findIndex(item=>item.query===p.query);if(index>=0)searches.splice(index,1);data={deleted:true};break;}
 case 'account':data={created_at:user.created_at,bio:'',tickets};break;
 case 'security':data={sessions:[{id:'50000000-0000-4000-8000-000000000001',created_at:user.created_at,last_seen:user.created_at,user_agent:'Synthetic Chromium',aal:'aal1',current:true}],history:[]};break;
 case 'notifications':data={realtime_enabled:true,notify_min_score:.75};break;case 'notification_save':data={realtime_enabled:true,notify_min_score:.75,...p};break;
 case 'tickets':data=tickets;break;case 'ticket_create':{const ticket={id:'80000000-0000-4000-8000-000000000001',title:p.title,message:p.message,category:p.category,state:'open',created_at:new Date().toISOString(),attachments:[]};tickets.push(ticket);data=ticket;break;}
 case 'export':data={profile:{id:userId},preferences,saved:saved?[resource]:[]};break;
 default:await r.fulfill({status:404,json:{error:{code:'unexpected_fixture_action'}}});return;}
 await r.fulfill({json:data});});
 return {calls,failSave:()=>{failSave=true;},failSearch:()=>{failSearch=true;},recover:()=>{failSave=false;failSearch=false;}};
}

function workspaceMain(page:Page){return page.locator('main.ws-main,main#mobile-main');}
function mobileViewport(page:Page){return (page.viewportSize()?.width??1280)<768;}

test('all nine pages render real-DOM controls with mobile-safe layout',async({page},info)=>{
 await fixture(page);
 const screens=[['/explore','검색 / 탐색'],['/search','검색 결과'],[`/companies/${companyId}`,'기업 개요'],['/saved','저장 / 기록'],['/settings/account','계정 정보'],['/settings/security','보안 및 로그인'],['/settings/notifications','알림 설정'],['/settings/appearance','화면 및 언어 설정'],['/help','도움말 및 지원']];
 for(const [path,title] of screens){
  await page.goto(path);
  const main=workspaceMain(page);
  await expect(main).toBeVisible();
  if(mobileViewport(page)&&path===`/companies/${companyId}`){
   await expect(page.locator('.m-detail-header>strong')).toHaveText(title);
   await expect(main.locator('.m-company-profile h1')).toHaveText(company.title);
   await expect(main.locator('.m-company-market')).toContainText(company.ticker);
  }else await expect(main.getByRole('heading',{level:1})).toHaveText(title);
  await expect(page.locator('.ws-skeleton')).toHaveCount(0);
  await expect(main.locator('.m-loading,.ws-loading')).toHaveCount(0);
  await expect(main.getByRole('alert')).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);
  await page.screenshot({path:info.outputPath(path.replaceAll('/','_')+'.png'),fullPage:true});
  await expect(page.locator('body')).not.toContainText('$ 146.76');
 }
});

test('search links exact sources and persists save/un-save across navigation',async({page})=>{
 const f=await fixture(page),mobile=mobileViewport(page);
 await page.goto('/explore');
 await page.getByLabel(mobile?'기업명 또는 키워드 검색':'검색어',{exact:true}).fill('10-K');
 await page.locator(mobile?'.m-search-input':'.ws-search-form').getByRole('button',{name:'검색',exact:true}).click();
 await expect(page).toHaveURL(/q=10-K/);
 const source=mobile?page.locator('.m-search-result-resource').filter({hasText:filing.title}):page.locator('.ws-resource').getByRole('link',{name:filing.title,exact:true});
 await expect(source).toHaveAttribute('href',`/documents/${filingId}?kind=filing`);
 await source.click();
 await expect(page).toHaveURL(new RegExp(`/documents/${filingId}`));
 await page.getByRole('button',{name:mobile?'문서 저장':/10-K 저장$/,exact:true}).click();
 await expect(page.getByRole('button',{name:mobile?'문서 저장 취소':/10-K 저장 취소$/,exact:true})).toBeVisible();
 await page.goto('/saved');
 await page.getByRole('navigation',{name:'저장 유형'}).getByRole('button',{name:mobile?'북마크한 문서':'북마크한 자료',exact:true}).click();
 const cards=page.locator(mobile?'.m-saved-card':'.ws-resource');
 await expect(cards).toHaveCount(1);
 await expect(cards).toContainText('Synthetic Company');
 await page.getByRole('button',{name:/10-K 저장 취소$/,exact:true}).click();
 await expect(cards).toHaveCount(0);
 expect(f.calls.filter(x=>x.action==='save').map(x=>x.p.saved)).toEqual([true,false]);
});

test('appearance applies durable settings, language, and honest save errors',async({page})=>{
 const f=await fixture(page),mobile=mobileViewport(page);await page.goto('/settings/appearance');
 await page.getByRole('radio',{name:mobile?'다크':/다크 모드/,exact:mobile}).click();
 await expect(page.locator('html')).toHaveAttribute('data-sb-theme','dark');
 await page.reload();await expect(page.locator('html')).toHaveAttribute('data-sb-theme','dark');
 await page.getByRole('radio',{name:mobile?'영어':'English 영어',exact:true}).click();
 await expect(workspaceMain(page).getByRole('heading',{level:1})).toHaveText('Appearance & language');
 f.failSave();await page.getByRole('radio',{name:mobile?'Light':/Light A clear/,exact:mobile}).click();
 await expect(workspaceMain(page).getByRole('alert').first()).toBeVisible();
 await expect(page.locator('html')).toHaveAttribute('data-sb-theme','dark');
});

test('notifications persist controls but never fake email delivery',async({page})=>{const f=await fixture(page);await page.goto('/settings/notifications');await expect(page.getByRole('switch',{name:'이메일 알림 — 미제공'})).toBeDisabled();await page.getByRole('switch',{name:'방해 금지 시간',exact:true}).click();await expect.poll(()=>f.calls.filter(x=>x.action==='preferences_save').at(-1)?.p).toMatchObject({value:{quiet_enabled:true}});await page.getByRole('slider',{name:'일일 최대 알림 수'}).press('Home');for(let i=0;i<4;i++)await page.getByRole('slider',{name:'일일 최대 알림 수'}).press('ArrowRight');await page.getByRole('button',{name:'최대 수 적용'}).click();await expect.poll(()=>f.calls.filter(x=>x.action==='preferences_save').at(-1)?.p).toMatchObject({value:{daily_cap:5}});});

test('help search, FAQs and support submission use actual form and returned ticket',async({page})=>{
 const f=await fixture(page),mobile=mobileViewport(page);await page.goto('/help');
 const submitSearch=mobile?page.getByRole('button',{name:'도움말 검색 실행',exact:true}):page.locator('.ws-help-hero .ws-search-form').getByRole('button',{name:'검색'});
 const faqs=page.locator(mobile?'.m-help-faq':'details.ws-faq');
 await page.getByLabel('도움말 검색',{exact:true}).fill('zzzz-nomatch');await submitSearch.click();
 await expect(faqs).toHaveCount(0);
 await page.getByLabel('도움말 검색',{exact:true}).fill('');await submitSearch.click();
 if(mobile){await faqs.first().getByRole('button').click();await expect(faqs.first().getByRole('button')).toHaveAttribute('aria-expanded','true');await page.getByRole('button',{name:'문의하기',exact:true}).click();await expect(page.getByRole('dialog',{name:'문의하기',exact:true})).toBeVisible();}
 else{await page.locator('.ws-faq summary').first().click();await expect(faqs.first()).toHaveAttribute('open','');}
 await page.getByLabel('제목',{exact:true}).fill('Synthetic browser request');
 await page.getByLabel('문의 내용',{exact:true}).fill('Synthetic message, not sent to production.');
 await page.getByRole('button',{name:'문의 내용 제출하기',exact:true}).click();
 await expect.poll(()=>f.calls.filter(x=>x.action==='ticket_create').length).toBe(1);
 if(mobile)await expect(page.getByRole('dialog',{name:'내 문의 내역',exact:true})).toContainText('Synthetic browser request');
 else await expect(workspaceMain(page)).toContainText('Synthetic browser request');
});

test('MFA never reports enabled before Auth verification',async({page})=>{
 await fixture(page);const mobile=mobileViewport(page);await page.goto('/settings/security');
 const mfa=page.getByRole('switch',{name:'2단계 인증',exact:true});
 if(mobile){await expect(mfa).toHaveAttribute('aria-checked','false');await mfa.click();}
 else await page.getByRole('button',{name:'2단계 인증 설정',exact:true}).click();
 await expect(page.getByRole('dialog')).toBeVisible();
 if(mobile)await expect(mfa).toHaveAttribute('aria-checked','false');
 await page.getByRole('dialog').click({position:{x:8,y:8}});await expect(page.getByRole('dialog')).toBeVisible();
 await page.getByLabel('인증 코드',{exact:true}).fill('123456');await page.getByRole('button',{name:'인증 후 활성화',exact:true}).click();
 await expect(page.getByRole('dialog')).toHaveCount(0);
 if(mobile)await expect(mfa).toHaveAttribute('aria-checked','true');
 else await expect(page.getByRole('button',{name:'관리',exact:true})).toBeVisible();
});

test('data outages show retry rather than fabricated empty success',async({page})=>{
 const f=await fixture(page),mobile=mobileViewport(page);
 f.failSearch();await page.goto('/search');
 const alerts=workspaceMain(page).getByRole('alert'),expectedRequests=mobile?4:1;
 await expect(alerts).toHaveCount(expectedRequests);
 for(const alert of await alerts.all())await expect(alert).toBeVisible();
 const resources=page.locator(mobile?'.m-search-result-company,.m-search-result-resource':'.ws-resource');
 await expect(resources).toHaveCount(0);
 f.recover();
 for(let remaining=expectedRequests;remaining>0;remaining--){
  await alerts.first().getByRole('button',{name:'다시 시도',exact:true}).click();
  await expect(alerts).toHaveCount(remaining-1);
 }
 await expect(resources).toHaveCount(2);
});


test('MFA step-up blocks the workspace until the Auth code is verified',async({page})=>{
 const f=await fixture(page,true);
 await page.goto('/settings/account');
 await expect(page.getByRole('heading',{level:1,name:'2단계 인증',exact:true})).toBeVisible();
 await expect(workspaceMain(page)).toHaveCount(0);
 expect(f.calls).toHaveLength(0);
 await page.getByLabel('인증 앱 코드',{exact:true}).fill('000000');
 await page.getByRole('button',{name:'인증하고 계속하기'}).click();
 await expect(page.locator('.mfa-screen [role="alert"]')).toBeVisible();
 await expect(workspaceMain(page)).toHaveCount(0);
 await page.getByLabel('인증 앱 코드',{exact:true}).fill('123456');
 await page.getByRole('button',{name:'인증하고 계속하기'}).click();
 await expect(workspaceMain(page).getByRole('heading',{level:1})).toHaveText('계정 정보');
});
