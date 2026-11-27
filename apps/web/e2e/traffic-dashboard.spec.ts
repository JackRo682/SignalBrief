import {readFile} from 'node:fs/promises';
import {expect,test,type Page} from '@playwright/test';
import {mobileFixture,fixtureNow} from './mobile-fixture';
import {emptyActivityFixture,overviewFixture} from './admin-overview-fixture';
import {operationMetricKeys,operationsSnapshotSchema} from '../src/admin-logs/operations-contracts';
import {trafficRequest,trafficSessions,trafficSummary} from '../src/acquisition/contracts';
import {previousRange} from '../src/acquisition/report';

// All accounts and measurements are isolated fixtures. mobileFixture blocks
// any unhandled external transport; this suite never contacts production.
async function dashboardFixture(page:Page){
 const fixture=await mobileFixture(page);fixture.state.profile.is_admin=true;
 const control={sessionStatus:200,calls:[] as Record<string,unknown>[]};
 await page.route('**/api/admin/overview',route=>route.fulfill({json:overviewFixture(route.request().postDataJSON(),false,fixtureNow)}));
 await page.route('**/api/admin/user-logs',route=>route.fulfill({json:emptyActivityFixture(fixtureNow)}));
 await page.route('**/api/traffic',async route=>{
  expect(route.request().headers().authorization).toMatch(/^Bearer /);
  const body=trafficRequest.parse(route.request().postDataJSON());control.calls.push(body);
  if(body.action==='sessions'){
   if(control.sessionStatus!==200){await route.fulfill({status:control.sessionStatus,json:{error:'synthetic-denial'}});return;}
   await route.fulfill({json:trafficSessions.parse({generated_at:fixtureNow,total:body.source==='google'?0:1,rows:body.source==='google'?[]:[{
    session_id:'10000000-1111-4111-8111-111111111111',source:'kakao',device:'unknown',started_at:fixtureNow,last_at:fixtureNow,entry_page:'home',last_page:'signup',last_step:'signup_submit',events:3,closed:false,any_auth_attempt:true,steps_truncated:false,
    steps:[{seq:1,page:'home',step:'view',at:fixtureNow},{seq:2,page:'home',step:'signup_cta',at:fixtureNow},{seq:3,page:'signup',step:'signup_submit',at:fixtureNow}],
   }]})});return;
  }
  if(body.action!=='summary')throw new Error('The administrator must not emit customer traffic');
  const counts={visitors:12,pageviews:30,starts:4,requests:2,signups:1,onboarded:1};
  const journey={source:'kakao',sessions:10,auth_cta:6,auth_arrived:5,auth_attempt:3,closed:8,closed_without_attempt:5,direct_auth_entries:0};
  await route.fulfill({json:trafficSummary.parse({generated_at:fixtureNow,totals:counts,daily:[{day:body.from,...counts}],sources:[{source:'kakao',...counts}],journeys:[journey],journey_daily:[{day:body.from,...journey}],journey_devices:[{device:'unknown',sessions:7},{device:'mobile',sessions:3}],journey_exits:[],journey_actions:[],surface_times:[],feature_actions:[],measurement:{first_acquisition_at:'2026-07-01T00:00:00Z',first_journey_at:'2026-07-01T00:00:00Z',first_surface_at:null,retained_from:'2026-07-08T00:00:00Z'}})});
 });
 await page.route('https://test-project.supabase.co/rest/v1/rpc/sb_reference_*',async route=>{
  const request=route.request(),name=new URL(request.url()).pathname.split('/').at(-1);
  if(name!=='sb_reference_ops'&&name!=='sb_reference_users'){await route.fallback();return;}
  const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':request.headers()['access-control-request-headers']??'authorization,apikey,content-type,x-client-info'};
  if(request.method()==='OPTIONS'){await route.fulfill({status:204,headers});return;}
  expect(request.headers().authorization).toMatch(/^Bearer /);
  if(name==='sb_reference_users'){await route.fulfill({headers,json:[]});return;}
  const {p}=request.postDataJSON();
  await route.fulfill({headers,json:operationsSnapshotSchema.parse({metrics:Object.fromEntries(operationMetricKeys.map(key=>[key,{value:0,delta:null,spark:[],note:'Synthetic dashboard fixture'}])),since:`${p.start}T00:00:00+09:00`,until:`${p.end}T23:59:59+09:00`,review:[],failures:[],citations:[],duplicates:[],reports:[]})});
 });
 await page.route('**/v1/ops/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  expect(route.request().headers().authorization).toMatch(/^Bearer /);
  if(path.endsWith('/queues'))await route.fulfill({json:{failed_runs:[]}});
  else if(path.endsWith('/documents')||path.endsWith('/audit'))await route.fulfill({json:[]});
  else throw new Error(`Unexpected administrator fixture endpoint: ${path}`);
 });
 return {fixture,control};
}

test('admin analytics compares periods, exports CSV and explores consented paths on desktop and mobile',async({page},info)=>{
 const {fixture,control}=await dashboardFixture(page);
 await page.goto('/ops');
 const panel=page.getByRole('region',{name:'사람들이 어디까지 이용했나요?',exact:true});
 await expect(panel).toBeVisible();
 for(const label of ['방문 브라우저','로그인 전 세션','순차 인증 시도','인증된 신규 가입'])await expect(panel.getByText(label,{exact:true}).first()).toBeVisible();
 const initialSummaries=control.calls.filter(call=>call.action==='summary');
 expect(initialSummaries.length).toBeGreaterThan(0);
 // Development Strict Mode can restart a read; no previous-period query may
 // occur until the comparison control is opened.
 for(const query of initialSummaries)expect(query).toEqual(initialSummaries[0]);
 expect(control.calls.filter(call=>call.action==='sessions')).toHaveLength(0);
 const current=control.calls[0] as {from:string;to:string};
 await panel.getByRole('button',{name:'이전 기간 비교',exact:true}).click();
 await expect(panel.getByRole('table',{name:'동일한 길이의 이전 기간과 현재 기간'})).toBeVisible();
 expect(control.calls.filter(call=>call.action==='summary').at(-1)).toEqual({action:'summary',...previousRange(current)});
 const downloadPromise=page.waitForEvent('download');
 await panel.getByRole('button',{name:'CSV 저장',exact:true}).click();
 const download=await downloadPromise,localPath=await download.path();expect(localPath).not.toBeNull();
 const csv=await readFile(localPath!);
 expect(csv.subarray(0,3).equals(Buffer.from([0xef,0xbb,0xbf]))).toBe(true);
 expect(csv.toString('utf8')).toContain('"current"');expect(csv.toString('utf8')).toContain('"previous"');
 await panel.getByRole('button',{name:'세션별 경로 보기',exact:true}).click();
 await expect(panel.getByRole('button',{name:'10000000 세션 경로 보기'})).toBeVisible();
 await panel.getByRole('button',{name:'10000000 세션 경로 보기'}).click();
 await expect(panel.getByRole('list',{name:'세션의 관측 순서'}).getByRole('listitem')).toHaveCount(3);
 await expect(panel.getByRole('region',{name:'익명 세션 경로 목록'})).toContainText('미측정');
 await panel.getByRole('combobox',{name:'세션의 최초 유입'}).selectOption('google');
 await expect(panel.getByText('선택한 기간과 유입 경로에 측정된 세션이 없습니다.')).toBeVisible();
 expect(control.calls.at(-1)).toMatchObject({action:'sessions',source:'google',offset:0,limit:20});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2)).toBe(true);
 await panel.screenshot({path:info.outputPath(`synthetic-traffic-dashboard-${info.project.name}.png`),animations:'disabled'});
 expect(fixture.state.unexpected).toEqual([]);expect(fixture.state.runtimeErrors).toEqual([]);
});

test('a denied session lookup clears every protected operations panel',async({page})=>{
 const {fixture,control}=await dashboardFixture(page);
 await page.goto('/ops');
 const panel=page.getByRole('region',{name:'사람들이 어디까지 이용했나요?',exact:true});
 await expect(panel.getByRole('button',{name:'CSV 저장',exact:true})).toBeEnabled();
 control.sessionStatus=403;
 await panel.getByRole('button',{name:'세션별 경로 보기',exact:true}).click();
 await expect(page.getByRole('alert')).toContainText('사용자 로그에 접근할 수 없습니다');
 await expect(panel).toHaveCount(0);
 await expect(page.getByRole('button',{name:'CSV 저장',exact:true})).toHaveCount(0);
 for(const name of ['핵심 지표','상세 활동 로그','수집·AI 처리 현황','검토·실패 기록','원문·모델 실행','가입 사용자','운영 감사 로그']){
  await expect(page.getByRole('region',{name,exact:true})).toHaveCount(0);
 }
 expect(fixture.state.unexpected).toEqual([]);expect(fixture.state.runtimeErrors).toEqual([]);
});
