import {test,expect,type Page} from '@playwright/test';
import {mobileFixture} from './mobile-fixture';
const id='10000000-0000-4000-8000-000000000321';
async function fixture(page:Page,admin=true){
 const base=await mobileFixture(page);base.state.profile.is_admin=admin;
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
 });return {base,calls,get withdrawn(){return withdrawn;}};
}
test('nine admin pages render real empty states and responsive navigation',async({page})=>{
 const f=await fixture(page);
 for(const [path,title] of [['analytics','사용자 행동 분석'],['experiments','A/B 실험 관리'],[`experiments/${id}`,'합성 연구 검증'],['evaluations','AI 금융정보 평가'],[`evaluations/datasets/${id}`,'합성 SEC 테스트'],[`evaluations/runs/${id}`,`평가 실행 ${id.slice(0,8)}`],['quality','금융정보 품질 검수'],['reliability','장애·안전성 관리'],['reports','실험·평가 보고서']]){
  await page.goto(`/ops/${path}`);await expect(page.getByRole('heading',{name:title,exact:true})).toBeVisible();await expect(page.getByRole('navigation',{name:'관리자 메뉴'})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2)).toBe(true);
  if(path==='evaluations')await page.screenshot({path:test.info().outputPath('evaluations.png'),fullPage:true});
 }
 expect(f.base.state.runtimeErrors).toEqual([]);
});
test('non-admin cannot open the console or fetch admin data',async({page})=>{const f=await fixture(page,false);await page.goto('/ops/evaluations');await expect(page.getByText('관리자만 접근할 수 있습니다.',{exact:false})).toBeVisible();expect(f.calls).toEqual([]);});
test('study consent, exposure, answer, and withdrawal flow',async({page})=>{const f=await fixture(page,false);await page.goto(`/study/${id}`);await expect(page.getByRole('heading',{name:'연구 참여 동의'})).toBeVisible();expect(f.calls).not.toContain('expose');await page.getByRole('checkbox').check();await page.getByRole('button',{name:'동의하고 참여하기'}).click();await page.getByLabel('매출 숫자는 무엇인가요?').fill('123');await page.getByRole('button',{name:'답변 제출'}).click();await expect(page.getByRole('heading',{name:'참여해 주셔서 감사합니다'})).toBeVisible();expect(f.calls.indexOf('expose')).toBeLessThan(f.calls.indexOf('submit'));await page.getByRole('button',{name:'참여 철회 및 응답 삭제'}).click();await expect(page.getByRole('heading',{name:'참여를 철회했습니다'})).toBeVisible();expect(f.withdrawn).toBe(true);expect(f.base.state.runtimeErrors).toEqual([]);});
test('reports download current consent-checked JSON',async({page})=>{const f=await fixture(page);await page.goto('/ops/reports');await expect(page.getByRole('heading',{name:'실험·평가 보고서'})).toBeVisible();const downloaded=page.waitForEvent('download');await page.getByRole('button',{name:'JSON 내보내기'}).click();expect((await downloaded).suggestedFilename()).toContain('.json');expect(f.calls.filter(c=>c==='reports').length).toBeGreaterThanOrEqual(2);});
