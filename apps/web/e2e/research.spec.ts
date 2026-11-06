import {test,expect,type Page} from '@playwright/test';
import {fixtureNow,mobileFixture} from './mobile-fixture';
import {emptyActivityFixture,overviewFixture} from './admin-overview-fixture';
import type {AdminOverviewRequest} from '../src/admin-logs/overview-contracts';
import type {UserLogsRequest} from '../src/admin-logs/contracts';
const id='10000000-0000-4000-8000-000000000321';
const opsIds={
 review:'10000000-0000-4000-8000-000000000901',document:'10000000-0000-4000-8000-000000000902',
 failure:'10000000-0000-4000-8000-000000000903',citation:'10000000-0000-4000-8000-000000000904',
 duplicate:'10000000-0000-4000-8000-000000000905',report:'10000000-0000-4000-8000-000000000906',
};
const syntheticOpsSource='https://www.sec.gov/Archives/edgar/data/1/synthetic-ops-source.htm';
type OperationsPeriod={range:string;start:string;end:string};
function operationsSnapshot(period:OperationsPeriod,populated:boolean,reviewed:boolean){
 const metric=(value:number|null,note='Synthetic operation measurement')=>({value,delta:null,spark:[],note});
 return {
  schema_version:2,generated_at:fixtureNow,review_total:populated?(reviewed?2:3):0,failure_total:populated?5:0,list_limit:100,
  since:new Date(`${period.start}T00:00:00+09:00`).toISOString(),until:new Date(`${period.end}T23:59:59+09:00`).toISOString(),
  metrics:{documents:metric(populated?12:0),events:metric(populated?4:0),ai_runs:metric(populated?6:0),ai_failures:metric(populated?1:0),
   low_confidence:metric(populated?2:0),citation_failures:metric(populated?1:0),number_mismatch:metric(0),duplicates:metric(populated?1:0),
   pipeline_latency:metric(populated?250:null),ai_cost:{...metric(null,'Cost not measured in this synthetic fixture'),recorded_value:populated?0.25:null},
   collector_runs:metric(populated?8:0),collector_errors:metric(populated?2:0),dart_filings:metric(populated?4:0),sec_filings:metric(populated?5:0),
   dart_documents:metric(populated?3:0),provider_analyses:metric(populated?4:0),review_pending:metric(populated?3:0),
   delivery_queued:metric(populated?2:0),delivery_submitted:metric(populated?5:0),delivery_delivered:metric(populated?4:0),delivery_failed:metric(populated?1:0),
   collector_latency:metric(populated?48:null),published_events:metric(populated?2:0),published_briefs:metric(populated?2:0)},
  review:populated?[
   ...(reviewed?[]:[{id:opsIds.review,kind:'event',document_id:opsIds.document,title:'Synthetic review needed',symbol:'SYN',state:'needs_review',created_at:fixtureNow}]),
   ...(['dart_analysis','sec_analysis'] as const).map(kind=>({id:`${kind}:${opsIds.document}`,kind,document_id:null,title:`Synthetic ${kind} review`,symbol:'SYN',state:'needs_review',created_at:fixtureNow,source_url:syntheticOpsSource})),
  ]:[],
  failures:populated?[
   {id:opsIds.failure,kind:'run',title:'Synthetic failed run',error_code:'synthetic_timeout',status:'failed',created_at:fixtureNow},
   ...(['collector','stage','analysis_attempt','document_attempt'] as const).map(kind=>({id:`${kind}:${opsIds.failure}`,kind,title:`Synthetic ${kind} failure`,error_code:'synthetic_timeout',status:'failed',created_at:fixtureNow,source_url:syntheticOpsSource})),
  ]:[],
  citations:populated?[{id:opsIds.citation,document_id:opsIds.document,title:'Synthetic citation issue',symbol:'missing_source',state:'needs_review',created_at:fixtureNow}]:[],
  duplicates:populated?[{id:opsIds.duplicate,document_id:opsIds.document,title:'Synthetic duplicate candidate',symbol:'SYN',state:'duplicate',created_at:fixtureNow}]:[],
  reports:populated?[{id:opsIds.report,comment:'Synthetic user feedback',rating:'incorrect',state:'open',created_at:fixtureNow}]:[],
  activity:populated?[
   {kind:'collector',id:opsIds.failure,title:'Synthetic collector activity',symbol:'SYN',status:'failed',error_code:'synthetic_timeout',created_at:fixtureNow,source_url:syntheticOpsSource,duration_ms:48},
   {kind:'stage',id:`${opsIds.failure}:normalize`,title:'Synthetic processing stage',symbol:'SYN',status:'completed',error_code:null,created_at:fixtureNow,source_url:null,duration_ms:12},
   {kind:'email',id:opsIds.report,title:'Synthetic email queue',symbol:null,status:'submitted',error_code:null,created_at:fixtureNow,source_url:null,duration_ms:null},
   {kind:'email_event',id:'provider-message:synthetic-delivery',title:'Synthetic delivery receipt',symbol:null,status:'delivered',error_code:null,created_at:fixtureNow,source_url:null,duration_ms:null},
  ]:[],
 };
}
async function fixture(page:Page,admin=true){
 const base=await mobileFixture(page);base.state.profile.is_admin=admin;
 const overviewCalls:AdminOverviewRequest[]=[],activityCalls:UserLogsRequest[]=[];
 const operations={populated:false,auditStatus:200,reviewed:false,calls:[] as string[],periods:[] as OperationsPeriod[],actions:[] as {path:string;body:unknown}[]};
 await page.route('**/api/admin/overview',async route=>{
  const p=route.request().postDataJSON();overviewCalls.push(p);
  await route.fulfill({json:overviewFixture(p,false,fixtureNow)});
 });
 await page.route('**/api/admin/user-logs',async route=>{
  activityCalls.push(route.request().postDataJSON());
  await route.fulfill({json:emptyActivityFixture(fixtureNow)});
 });
 await page.route('https://test-project.supabase.co/rest/v1/rpc/sb_reference_*',async route=>{
  const request=route.request(),name=new URL(request.url()).pathname.split('/').at(-1)!;
  if(!['sb_reference_ops','sb_reference_users'].includes(name)){await route.fallback();return;}
  const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':request.headers()['access-control-request-headers']??'authorization,apikey,content-type,x-client-info'};
  if(request.method()==='OPTIONS'){await route.fulfill({status:204,headers});return;}
  expect(request.method()).toBe('POST');expect(request.headers().authorization).toMatch(/^Bearer /);
  operations.calls.push(name);
  if(name==='sb_reference_ops'){
   const {p}=request.postDataJSON();operations.periods.push(p);
   expect(p.range).toBe('custom');expect(Object.keys(p).sort()).toEqual(['end','range','start']);
   await route.fulfill({headers,json:operationsSnapshot(p,operations.populated,operations.reviewed)});
  }else await route.fulfill({headers,json:operations.populated?[{display_name:'Synthetic test user',created_at:fixtureNow,onboarding_completed:true}]:[]});
 });
 await page.route('**/v1/ops/**',async route=>{
  const request=route.request(),url=new URL(request.url()),path=url.pathname.slice(url.pathname.indexOf('/v1/'));
  expect(request.headers().authorization).toMatch(/^Bearer /);
  operations.calls.push(path);
  if(request.method()==='POST'&&path===`/v1/ops/events/${opsIds.review}/action`){
   operations.actions.push({path,body:request.postDataJSON()});operations.reviewed=true;
   await route.fulfill({json:{updated:true}});return;
  }
  expect(request.method()).toBe('GET');
  if(path==='/v1/ops/documents')await route.fulfill({json:operations.populated?[{id:opsIds.document,title:'Synthetic source document',provider:'sec',state:'ready',ingested_at:fixtureNow,publication_date:'2026-10-06'}]:[]});
  else if(path==='/v1/ops/queues')await route.fulfill({json:{failed_runs:operations.populated?[{id:opsIds.failure,model:'synthetic-model-only',status:'failed',prompt_version:'fixture-v1',error_code:'synthetic_timeout'}]:[]}});
  else if(path==='/v1/ops/audit')await route.fulfill(operations.auditStatus===200
   ?{json:operations.populated?[{id:'synthetic-audit-1',action:'review_event',target_id:opsIds.review,created_at:fixtureNow,details:{reason:'Synthetic source review reason'}}]:[]}
   :{status:operations.auditStatus,json:{error:{code:operations.auditStatus===403?'admin_required':'audit_unavailable'}}});
  else throw new Error(`Unexpected operation request ${request.method()} ${path}`);
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
 });return {base,calls,overviewCalls,activityCalls,operations,get withdrawn(){return withdrawn;}};
}
test('nine admin pages render real empty states and responsive navigation',async({page})=>{
 const f=await fixture(page);
 for(const [path,title] of [['analytics','운영 현황'],['experiments','A/B 실험 관리'],[`experiments/${id}`,'합성 연구 검증'],['evaluations','AI 금융정보 평가'],[`evaluations/datasets/${id}`,'합성 SEC 테스트'],[`evaluations/runs/${id}`,`평가 실행 ${id.slice(0,8)}`],['quality','금융정보 품질 검수'],['reliability','장애·안전성 관리'],['reports','실험·평가 보고서']]){
  await page.goto(`/ops/${path}`);await expect(page.getByRole('heading',{name:title,exact:true})).toBeVisible();await expect(page.getByRole('navigation',{name:'관리자 메뉴'})).toBeVisible();
  if(path==='analytics'){await expect(page).toHaveURL(/\/ops$/);await expect(page.locator('a[href="/ops/analytics"],a[href="/ops/user-logs"]')).toHaveCount(0);}
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
 await expect(page).toHaveURL(/\/ops$/);
 await expect(page.getByRole('heading',{name:'운영 현황',exact:true})).toBeVisible();
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
 expect(f.operations.calls).toEqual([]);
 f.base.state.profile.is_admin=true;
 await page.reload();
 await expect(page.getByRole('heading',{name:'사용자 로그에 접근할 수 없습니다'})).toBeVisible();
 await expect(page.getByRole('button',{name:'다른 계정으로 로그인',exact:true})).toBeVisible();
 await expect(page.getByRole('region',{name:'사용자 활동 로그 목록'})).toHaveCount(0);
 await expect(page.getByRole('region',{name:'핵심 지표',exact:true})).toHaveCount(0);
 await expect(page.getByRole('region',{name:'수집·AI 처리 현황',exact:true})).toHaveCount(0);
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
 await expect(page).toHaveURL(/\/ops$/);
 expect(f.base.state.runtimeErrors).toEqual([]);
});

test('one admin page keeps usage and operations, shared dates, errors, and activity together',async({page})=>{
 test.setTimeout(60_000);
 const f=await fixture(page);
 const overviewQueries:AdminOverviewRequest[]=[];
 await page.route('**/api/admin/overview',async route=>{
  const p=route.request().postDataJSON();overviewQueries.push(p);
  await route.fulfill({json:overviewFixture(p,true,fixtureNow)});
 });
 await page.goto('/ops/analytics');
 await expect(page).toHaveURL(/\/ops$/);
 await expect(page.getByRole('heading',{name:'운영 현황',exact:true})).toBeVisible();
 const metrics=page.getByRole('region',{name:'핵심 지표',exact:true});
 await expect(metrics.locator('.overview-metrics > article')).toHaveCount(8);
 for(const label of ['방문자 수','회원가입 전환율','활성화율','D1 · D7 리텐션','핵심 기능 이용률','활성 체류시간','주요 이탈 화면','오류 발생률']){
  await expect(metrics.getByRole('article',{name:label,exact:true})).toBeVisible();
 }
 await expect(metrics.getByRole('article',{name:'회원가입 전환율',exact:true})).toContainText('미측정');
 await expect(metrics.getByRole('article',{name:'오류 발생률',exact:true})).toContainText('5%');
 await expect(page.locator('a[href="/ops/analytics"]')).toHaveCount(0);
 await expect(page.locator('a[href="/ops/user-logs"]')).toHaveCount(0);
 await expect(page.getByRole('navigation',{name:'관리자 메뉴'}).locator('a[href="/ops"]')).toHaveCount(1);
 for(const title of ['날짜별 방문자','가입·활성화','핵심 기능 이용','화면별 이용·이탈','오류·안정성','활동 기록']){
  await expect(page.getByRole('heading',{name:title,exact:true})).toBeAttached();
 }
 await expect(page.locator('.ops-overview-metric')).toHaveCount(24);
 for(const section of ['수집·AI 처리 현황','검토·실패 기록','원문·모델 실행','가입 사용자','운영 감사 로그','수집·발송 활동 기록']){
  await expect(page.getByRole('region',{name:section,exact:true})).toBeVisible();
 }
 await expect(page.getByRole('region',{name:'최근 오류가 기록된 시간대',exact:true})).toBeAttached();
 await expect(page.getByLabel('시작일',{exact:true})).toHaveCount(1);
 await expect(page.getByLabel('종료일',{exact:true})).toHaveCount(1);
 const nextFrom=await page.getByLabel('종료일',{exact:true}).inputValue();
 await page.getByLabel('시작일',{exact:true}).fill(nextFrom);
 await page.getByRole('button',{name:'기간 적용',exact:true}).click();
 await expect.poll(()=>overviewQueries.at(-1)?.from).toBe(nextFrom);
 await expect.poll(()=>f.activityCalls.at(-1)?.from).toBe(nextFrom);
 await expect.poll(()=>f.operations.periods.at(-1)?.start).toBe(nextFrom);
 expect(overviewQueries.at(-1)?.to).toBe(f.activityCalls.at(-1)?.to);
 expect(f.operations.periods.at(-1)?.end).toBe(f.activityCalls.at(-1)?.to);
 const beforeFilter=overviewQueries.length;
 const operationsBeforeFilter=f.operations.periods.length;
 await page.getByRole('combobox',{name:'활동 유형',exact:true}).selectOption('view',{timeout:15_000});
 await page.getByRole('button',{name:'조회하기',exact:true}).click();
 await expect.poll(()=>f.activityCalls.at(-1)?.event).toBe('view');
 expect(overviewQueries).toHaveLength(beforeFilter);
 expect(f.operations.periods).toHaveLength(operationsBeforeFilter);
 await expect(page).toHaveURL(/\/ops$/);
 const beforeRefresh=overviewQueries.length;
 const operationsBeforeRefresh=f.operations.calls.length;
 await page.getByRole('button',{name:'새로고침',exact:true}).click();
 await expect.poll(()=>overviewQueries.length).toBe(beforeRefresh+1);
 await expect.poll(()=>f.operations.calls.length).toBe(operationsBeforeRefresh+5);
 await expect(metrics.locator('.overview-metrics > article')).toHaveCount(8);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2)).toBe(true);
 await page.screenshot({path:test.info().outputPath(`synthetic-admin-overview-${test.info().project.name}.png`),fullPage:true,timeout:15_000});
 expect(f.base.state.runtimeErrors).toEqual([]);
 expect(f.base.state.unexpected).toEqual([]);
});

test('unified operations preserve live v2 rows and allow only valid in-page review actions',async({page},info)=>{
 const f=await fixture(page);f.operations.populated=true;
 await page.goto('/ops/user-logs');
 await expect(page).toHaveURL(/\/ops$/);
 await expect(page.getByRole('heading',{level:1,name:'운영 현황',exact:true})).toBeVisible();
 await expect(page.locator('h1')).toHaveCount(1);
 await expect(page.locator('.ops-overview-metric')).toHaveCount(24);
 await expect(page.getByRole('article',{name:'수집 문서',exact:true})).toContainText('12');
 await expect(page.getByRole('article',{name:'기록된 AI 비용',exact:true})).toContainText('—');
 await expect(page.getByRole('button',{name:'새로고침',exact:true})).toBeEnabled();
 await page.screenshot({path:info.outputPath(`synthetic-ops-overview-${info.project.name}.png`),fullPage:false,animations:'disabled',timeout:15_000});
 await page.getByRole('heading',{level:3,name:'공식 자료 수집',exact:true}).evaluate(heading=>heading.scrollIntoView({block:'start'}));
 await page.screenshot({path:info.outputPath(`synthetic-ops-collection-${info.project.name}.png`),fullPage:false,animations:'disabled',timeout:15_000});

 for(const title of ['검토 대기 이벤트·분석','수집·처리·AI 실패','인용·수치 검증 문제','중복 이벤트 후보','사용자 의견','최근 원본 문서','모델·분석 실행 기록','가입 사용자','운영 감사 로그']){
  await expect(page.getByRole('heading',{level:2,name:title,exact:true})).toBeVisible();
 }
 const operationSections=page.locator('.ops-consolidated-sections');
 for(const text of ['Synthetic review needed','Synthetic failed run','Synthetic citation issue','Synthetic duplicate candidate','Synthetic user feedback','Synthetic source document','Synthetic test user','Synthetic source review reason','Synthetic collector activity','Synthetic processing stage','Synthetic email queue','Synthetic delivery receipt']){
  await expect(operationSections.getByText(text)).toBeVisible();
 }
 await expect(page.getByRole('link',{name:/^Synthetic source document/})).toHaveAttribute('href',`/ops/documents/${opsIds.document}`);
 await expect(page.getByRole('link',{name:/^synthetic-model-only/})).toHaveAttribute('href',`/ops/runs/${opsIds.failure}`);

 // Live provider rows are not event IDs or AI-run IDs. They retain evidence
 // links without manufacturing a mutation or a broken internal detail route.
 for(const title of ['Synthetic dart_analysis review','Synthetic sec_analysis review','Synthetic collector failure','Synthetic stage failure','Synthetic analysis_attempt failure','Synthetic document_attempt failure']){
  const row=operationSections.getByRole('row').filter({hasText:title});
  await expect(row).toBeVisible();
  await expect(row.getByRole('button')).toHaveCount(0);
  await expect(row.locator('a[href^="/ops/events/"],a[href^="/ops/runs/"]')).toHaveCount(0);
  await expect(row.locator(`a[href="${syntheticOpsSource}"]`)).toHaveCount(1);
 }

 await page.getByLabel('검토 대기 이벤트·분석 검색',{exact:true}).fill('no-such-synthetic-row');
 await expect(page.getByText('검색 조건에 맞는 항목이 없습니다.',{exact:true})).toBeVisible();
 await page.getByLabel('검토 대기 이벤트·분석 검색',{exact:true}).fill('');
 await page.getByRole('button',{name:'Synthetic review needed 검토하기',exact:true}).click();
 const editor=page.getByRole('region',{name:'운영 항목 검토',exact:true});
 await expect(editor.getByRole('button',{name:'승인',exact:true})).toBeDisabled();
 await editor.getByLabel('검토 사유 (5자 이상)',{exact:true}).fill('Synthetic reviewed-source reason');
 await editor.getByRole('button',{name:'거절',exact:true}).click();
 await expect.poll(()=>f.operations.actions.length).toBe(1);
 expect(f.operations.actions[0]).toEqual({path:`/v1/ops/events/${opsIds.review}/action`,body:{action:'reject',reason:'Synthetic reviewed-source reason'}});
 await expect(editor).toHaveCount(0);
 await expect(page.getByText('Synthetic review needed',{exact:true})).toHaveCount(0);
 await expect(page).toHaveURL(/\/ops$/);
 await expect(page.locator('.ops-overview-metric')).toHaveCount(24);
 await expect(page.getByRole('region',{name:'사용자 활동 로그 목록',exact:true})).toHaveCount(0);
 await expect(page.getByRole('heading',{name:'활동 기록',exact:true})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2)).toBe(true);
 expect(f.base.state.unexpected).toEqual([]);
 expect(f.base.state.runtimeErrors).toEqual([]);
});

test('an operations permission denial suppresses all consolidated private data',async({page})=>{
 const f=await fixture(page);f.operations.populated=true;
 await page.goto('/ops');
 await expect(page.getByText('Synthetic source document',{exact:true})).toBeVisible();
 await expect(page.getByRole('region',{name:'핵심 지표',exact:true})).toBeVisible();
 f.operations.auditStatus=403;
 await page.getByRole('button',{name:'새로고침',exact:true}).click();
 await expect(page.getByRole('button',{name:'다른 계정으로 로그인',exact:true})).toBeVisible();
 for(const section of ['핵심 지표','상세 활동 로그','수집·AI 처리 현황','원문·모델 실행','가입 사용자','운영 감사 로그']){
  await expect(page.getByRole('region',{name:section,exact:true})).toHaveCount(0);
 }
 await expect(page.getByText('Synthetic source document',{exact:true})).toHaveCount(0);
 await expect(page.getByText('Synthetic test user',{exact:true})).toHaveCount(0);
 expect(f.base.state.unexpected).toEqual([]);
 expect(f.base.state.runtimeErrors).toEqual([]);
});

test('a temporary operations source failure keeps other authorized sections available',async({page})=>{
 const f=await fixture(page);f.operations.populated=true;f.operations.auditStatus=503;
 await page.goto('/ops');
 const audit=page.getByRole('region',{name:'운영 감사 로그',exact:true});
 await expect(audit.getByRole('alert')).toBeVisible();
 await expect(page.getByText('Synthetic source document',{exact:true})).toBeVisible();
 await expect(page.getByText('Synthetic test user',{exact:true})).toBeVisible();
 await expect(page.getByRole('heading',{name:'활동 기록',exact:true})).toBeVisible();
 await expect(page.locator('.ops-overview-metric')).toHaveCount(24);
 f.operations.auditStatus=200;
 await audit.getByRole('button',{name:'운영 기록 다시 조회',exact:true}).click();
 await expect(page.getByText('Synthetic source review reason',{exact:true})).toBeVisible();
 await expect(audit.getByRole('alert')).toHaveCount(0);
 await expect(page).toHaveURL(/\/ops$/);
 expect(f.base.state.unexpected).toEqual([]);
 expect(f.base.state.runtimeErrors).toEqual([]);
});

test('a legacy audit view scrolls to its unified section after delayed authentication',async({page})=>{
 const f=await fixture(page);f.operations.populated=true;
 let releaseAuth=()=>{},authRequested=()=>{};
 const ready=new Promise<void>(resolve=>{releaseAuth=resolve;});
 const requested=new Promise<void>(resolve=>{authRequested=resolve;});
 await page.route('**/v1/me',async route=>{
  authRequested();await ready;await route.fallback();
 });
 try{
  await page.goto('/ops?view=audit',{waitUntil:'domcontentloaded'});
  await requested;
  // The authenticated shell must reveal the streamed redirect before it can run.
  releaseAuth();
  await expect(page).toHaveURL(/\/ops#operations-audit$/);
  await expect(page.getByRole('heading',{level:1,name:'운영 현황',exact:true})).toBeVisible();
  await expect(page.locator('.ops-overview-metric')).toHaveCount(24);
  const audit=page.getByRole('region',{name:'운영 감사 로그',exact:true});
  await expect(audit.getByText('Synthetic source review reason',{exact:true})).toBeVisible();
  await expect(audit.getByRole('heading',{name:'운영 감사 로그',exact:true})).toBeInViewport();
  await expect(page.getByRole('heading',{name:'활동 기록',exact:true})).toBeVisible();
  expect(f.base.state.unexpected).toEqual([]);
  expect(f.base.state.runtimeErrors).toEqual([]);
 }finally{releaseAuth();}
});
