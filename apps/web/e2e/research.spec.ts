import {test,expect,type Page} from '@playwright/test';
import {fixtureNow,mobileFixture} from './mobile-fixture';
import {emptyActivityFixture,overviewFixture} from './admin-overview-fixture';
import type {AdminOverviewRequest} from '../src/admin-logs/overview-contracts';
import type {UserLogsRequest} from '../src/admin-logs/contracts';
const id='10000000-0000-4000-8000-000000000321';
async function fixture(page:Page,admin=true){
 const base=await mobileFixture(page);base.state.profile.is_admin=admin;
 const overviewCalls:AdminOverviewRequest[]=[],activityCalls:UserLogsRequest[]=[];
 await page.route('**/api/admin/overview',async route=>{
  const p=route.request().postDataJSON();overviewCalls.push(p);
  await route.fulfill({json:overviewFixture(p,false,fixtureNow)});
 });
 await page.route('**/api/admin/user-logs',async route=>{
  activityCalls.push(route.request().postDataJSON());
  await route.fulfill({json:emptyActivityFixture(fixtureNow)});
 });
 let joined=false,submitted=false,withdrawn=false;const calls:string[]=[];
 const experiment={id,name:'합성 연구 검증',hypothesis:'테스트 전용 가설과 데이터',status:'running',design:'between',metric:'accuracy',version:1,ratio:50};
 const groups=['A','B'].map(variant=>({variant,assigned:0,exposed:0,completed:0,accuracy:null,completion_rate:null,median_active_ms:null,evidence_rate:null}));
 await page.route('**/api/research',async route=>{const {action,p}=route.request().postDataJSON();calls.push(action);let result:unknown={};
  switch(action){
   case 'analytics':result={dau:0,wau:0,views:0,active_ms:0,bounce_rate:null,days:[],pages:[],retention:[],paths:[]};break;
   case 'experiments':result={items:[experiment]};break;
   case 'experiment':result={experiment,groups,participants:[]};break;
   case 'datasets':result={items:[{id,name:'합성 SEC 테스트',split:'review',cases:0,approved:0,version:1}],filings:[]};break;
   case 'dataset':result={dataset:{id,name:'합성 SEC 테스트',split:'review'},cases:[]};break;
   case 'evaluations':result={runs:[]};break;
   case 'evaluation':result={id,dataset_id:id,method:'A',model:'synthetic-only',prompt_version:'test',status:'queued',cases:[],results:[]};break;
   case 'quality':result={analyses:[],reports:[]};break;
   case 'reliability':result={jobs:[],runs:[],checks:[],provider_checks:[],api_error_rate:null,worker_heartbeat:null};break;
   case 'reports':result={generated_at:'2026-10-10T00:00:00Z',method_version:'research-v1',experiments:[],evaluations:[],checks:[],limitations:['Synthetic UI test only']};break;
   case 'join':joined=true;result={saved:true};break;
   case 'submit':submitted=true;result={saved:true};break;
   case 'withdraw':withdrawn=true;result={withdrawn:true};break;
   case 'study':result={id,name:'합성 연구 검증',status:'running',consent_text:'테스트용 동의문입니다. 실제 참가자 성과로 사용하지 않습니다.',consent_version:'research-v1',joined,complete:submitted,phase:submitted?1:0,total:1,step:joined?{content:'테스트 전용 금융정보입니다. 합성 매출은 123 USD입니다.',question:'매출 숫자는 무엇인가요?',source_url:'https://www.sec.gov/Archives/edgar/data/1/test.htm'}:null};break;
   case 'expose':case 'study_event':result={saved:true};break;
   case 'experiment_create':expect(p.config.A.answer).toBeTruthy();result={id};break;
   default:throw new Error(`Unexpected research action ${action}`);
  }await route.fulfill({json:result});
 });return {base,calls,overviewCalls,activityCalls,get withdrawn(){return withdrawn;}};
}
test('nine admin pages render real empty states and responsive navigation',async({page})=>{
 const f=await fixture(page);
 for(const [path,title] of [['analytics','운영 현황 · 사용자 로그'],['experiments','A/B 실험 관리'],[`experiments/${id}`,'합성 연구 검증'],['evaluations','AI 금융정보 평가'],[`evaluations/datasets/${id}`,'합성 SEC 테스트'],[`evaluations/runs/${id}`,`평가 실행 ${id.slice(0,8)}`],['quality','금융정보 품질 검수'],['reliability','장애·안전성 관리'],['reports','실험·평가 보고서']]){
  await page.goto(`/ops/${path}`);await expect(page.getByRole('heading',{name:title,exact:true})).toBeVisible();await expect(page.getByRole('navigation',{name:'관리자 메뉴'})).toBeVisible();
  if(path==='analytics'){await expect(page).toHaveURL(/\/ops\/user-logs$/);await expect(page.locator('a[href="/ops/analytics"]')).toHaveCount(0);}
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2)).toBe(true);
  if(path==='evaluations')await page.screenshot({path:test.info().outputPath('evaluations.png'),fullPage:true});
 }
 expect(f.base.state.runtimeErrors).toEqual([]);
});
test('non-admin cannot open the console or fetch admin data',async({page})=>{const f=await fixture(page,false);await page.goto('/ops/evaluations');await expect(page.getByText('관리자만 접근할 수 있습니다.',{exact:false})).toBeVisible();expect(f.calls).toEqual([]);});
test('study consent, exposure, answer, and withdrawal flow',async({page})=>{const f=await fixture(page,false);await page.goto(`/study/${id}`);await expect(page.getByRole('heading',{name:'연구 참여 동의'})).toBeVisible();expect(f.calls).not.toContain('expose');await page.getByRole('checkbox').check();await page.getByRole('button',{name:'동의하고 참여하기'}).click();await page.getByLabel('매출 숫자는 무엇인가요?').fill('123');await page.getByRole('button',{name:'답변 제출'}).click();await expect(page.getByRole('heading',{name:'참여해 주셔서 감사합니다'})).toBeVisible();expect(f.calls.indexOf('expose')).toBeLessThan(f.calls.indexOf('submit'));await page.getByRole('button',{name:'참여 철회 및 응답 삭제'}).click();await expect(page.getByRole('heading',{name:'참여를 철회했습니다'})).toBeVisible();expect(f.withdrawn).toBe(true);expect(f.base.state.runtimeErrors).toEqual([]);});
test('reports download current consent-checked JSON',async({page})=>{const f=await fixture(page);await page.goto('/ops/reports');await expect(page.getByRole('heading',{name:'실험·평가 보고서'})).toBeVisible();const downloaded=page.waitForEvent('download');await page.getByRole('button',{name:'JSON 내보내기'}).click();expect((await downloaded).suggestedFilename()).toContain('.json');expect(f.calls.filter(c=>c==='reports').length).toBeGreaterThanOrEqual(2);});

test('private user logs show filtered records and safe details on desktop and mobile',async({page})=>{
 const f=await fixture(page);
 const user='10000000-0000-4000-8000-000000000777';
 const queries:Record<string,unknown>[]=[];
 await page.route('**/api/admin/user-logs',async route=>{
  const p=route.request().postDataJSON();queries.push(p);
  await route.fulfill({json:{items:[{id:'usage:20000000-0000-4000-8000-000000000777',created_at:fixtureNow,user_id:user,event:'view',screen:'today',device:'desktop',session_id:'30000000-0000-4000-8000-000000000777',page_id:'40000000-0000-4000-8000-000000000777',active_ms:0,source:'usage',is_admin:false}],next_cursor:null,has_more:false,summary:{events:1,users:1,sessions:1,active_ms:0},retention_days:90,timezone:'Asia/Seoul',consented_users:1,generated_at:fixtureNow}});
 });
 await page.goto('/ops/user-logs');
 await expect(page.getByRole('heading',{name:'운영 현황 · 사용자 로그',exact:true})).toBeVisible();
 await expect(page.getByRole('region',{name:'사용자 활동 로그 목록'})).toBeVisible();
 expect(queries[0].include_admin).toBe(false);
 await page.getByRole('button',{name:/화면 방문 상세/}).click();
 await expect(page.getByText('30000000-0000-4000-8000-000000000777',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:`사용자 ${user}로 필터`}).click();
 await expect.poll(()=>queries.at(-1)?.user_id).toBe(user);
 await page.getByLabel('관리자 이용 기록 포함').check();
 await page.getByRole('button',{name:'기간 적용',exact:true}).click();
 await expect.poll(()=>queries.at(-1)?.include_admin).toBe(true);
 await expect(page.getByRole('button',{name:'다음',exact:true})).toBeDisabled();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2)).toBe(true);
 expect(f.base.state.runtimeErrors).toEqual([]);
});

test('user logs deny non-admin requests and show recoverable permission errors',async({page})=>{
 const f=await fixture(page,false);let reads=0;
 await page.route('**/api/admin/user-logs',async route=>{reads++;await route.fulfill({status:403,json:{error:{code:'admin_required'}}});});
 await page.goto('/ops/user-logs');
 await expect(page.getByRole('heading',{name:'관리자 권한이 필요합니다'})).toBeVisible();
 expect(reads).toBe(0);
 expect(f.overviewCalls).toEqual([]);
 f.base.state.profile.is_admin=true;
 await page.reload();
 await expect(page.getByRole('heading',{name:'사용자 로그에 접근할 수 없습니다'})).toBeVisible();
 await expect(page.getByRole('button',{name:'다른 계정으로 로그인',exact:true})).toBeVisible();
 await expect(page.getByRole('region',{name:'사용자 활동 로그 목록'})).toHaveCount(0);
 await expect(page.getByRole('region',{name:'핵심 지표',exact:true})).toHaveCount(0);
 expect(reads).toBe(1);
});

test('temporary overview failure leaves activity available and retries in place',async({page})=>{
 const f=await fixture(page);
 let failing=true;
 await page.route('**/api/admin/overview',async route=>{
  await route.fulfill(failing
   ? {status:503,json:{error:{code:'overview_unavailable'}}}
   : {json:overviewFixture(route.request().postDataJSON(),false,fixtureNow)});
 });
 await page.goto('/ops/user-logs');
 await expect(page.getByRole('heading',{name:'핵심 지표를 불러오지 못했습니다',exact:true})).toBeVisible();
 await expect(page.getByRole('heading',{name:'활동 기록',exact:true})).toBeVisible();
 await expect(page.getByRole('heading',{name:'조회할 기록이 없습니다',exact:true})).toBeVisible();
 failing=false;
 await page.getByRole('button',{name:'다시 시도',exact:true}).click();
 await expect(page.getByRole('region',{name:'핵심 지표',exact:true}).locator('.overview-metrics > article')).toHaveCount(8);
 await expect(page.getByRole('heading',{name:'핵심 지표를 불러오지 못했습니다',exact:true})).toHaveCount(0);
 await expect(page).toHaveURL(/\/ops\/user-logs$/);
 expect(f.base.state.runtimeErrors).toEqual([]);
});

test('one admin page keeps eight metrics, shared dates, errors, and activity together',async({page})=>{
 test.setTimeout(60_000);
 const f=await fixture(page);
 const overviewQueries:AdminOverviewRequest[]=[];
 await page.route('**/api/admin/overview',async route=>{
  const p=route.request().postDataJSON();overviewQueries.push(p);
  await route.fulfill({json:overviewFixture(p,true,fixtureNow)});
 });
 await page.goto('/ops/analytics');
 await expect(page).toHaveURL(/\/ops\/user-logs$/);
 await expect(page.getByRole('heading',{name:'운영 현황 · 사용자 로그',exact:true})).toBeVisible();
 const metrics=page.getByRole('region',{name:'핵심 지표',exact:true});
 await expect(metrics.locator('.overview-metrics > article')).toHaveCount(8);
 for(const label of ['방문자 수','회원가입 전환율','활성화율','D1 · D7 리텐션','핵심 기능 이용률','활성 체류시간','주요 이탈 화면','오류 발생률']){
  await expect(metrics.getByRole('article',{name:label,exact:true})).toBeVisible();
 }
 await expect(metrics.getByRole('article',{name:'회원가입 전환율',exact:true})).toContainText('미측정');
 await expect(metrics.getByRole('article',{name:'오류 발생률',exact:true})).toContainText('5%');
 await expect(page.locator('a[href="/ops/analytics"]')).toHaveCount(0);
 await expect(page.getByRole('navigation',{name:'관리자 메뉴'}).getByRole('link',{name:/운영 현황 · 사용자 로그/})).toHaveCount(1);
 for(const title of ['날짜별 방문자','가입·활성화','핵심 기능 이용','화면별 이용·이탈','오류·안정성','활동 기록']){
  await expect(page.getByRole('heading',{name:title,exact:true})).toBeAttached();
 }
 await expect(page.getByRole('region',{name:'최근 오류가 기록된 시간대',exact:true})).toBeAttached();
 await expect(page.getByLabel('시작일',{exact:true})).toHaveCount(1);
 await expect(page.getByLabel('종료일',{exact:true})).toHaveCount(1);
 const nextFrom=await page.getByLabel('종료일',{exact:true}).inputValue();
 await page.getByLabel('시작일',{exact:true}).fill(nextFrom);
 await page.getByRole('button',{name:'기간 적용',exact:true}).click();
 await expect.poll(()=>overviewQueries.at(-1)?.from).toBe(nextFrom);
 await expect.poll(()=>f.activityCalls.at(-1)?.from).toBe(nextFrom);
 expect(overviewQueries.at(-1)?.to).toBe(f.activityCalls.at(-1)?.to);
 const beforeFilter=overviewQueries.length;
 await page.getByRole('combobox',{name:'활동 유형',exact:true}).selectOption('view',{timeout:15_000});
 await page.getByRole('button',{name:'조회하기',exact:true}).click();
 await expect.poll(()=>f.activityCalls.at(-1)?.event).toBe('view');
 expect(overviewQueries).toHaveLength(beforeFilter);
 await expect(page).toHaveURL(/\/ops\/user-logs$/);
 const beforeRefresh=overviewQueries.length;
 await page.getByRole('button',{name:'새로고침',exact:true}).click();
 await expect.poll(()=>overviewQueries.length).toBe(beforeRefresh+1);
 await expect(metrics.locator('.overview-metrics > article')).toHaveCount(8);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2)).toBe(true);
 await page.screenshot({path:test.info().outputPath(`synthetic-admin-overview-${test.info().project.name}.png`),fullPage:true,timeout:15_000});
 expect(f.base.state.runtimeErrors).toEqual([]);
 expect(f.base.state.unexpected).toEqual([]);
});
