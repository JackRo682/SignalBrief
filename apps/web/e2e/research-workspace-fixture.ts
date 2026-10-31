import {type Page} from '@playwright/test';
import {mobileFixture,companies,companyId,companyResources,eventDetails,events,fixtureNow} from './mobile-fixture';
import {catalogSchema,companyDetailSchema,contentNotificationsSchema,documentDetailSchema,resourceSchema,savedSchema,sourceOverviewSchema,workspaceRequest,type Resource} from '../src/workspace/contracts';
import {newsResponse} from '../src/lib/news-contract';

// Synthetic browser data only. This fixture never contacts a financial provider or a real account.
export const sourceId='40000000-0000-4000-8000-000000000101';
export const sourceUrl='https://www.sec.gov/Archives/edgar/data/1/synthetic-research-workspace.htm';
export const sourceQuote='Synthetic fixture: The company reported revenue of USD 45,000 million for the quarter.';
export const filing=resourceSchema.parse({...companyResources[0],id:sourceId,kind:'filing',title:'Synthetic NVIDIA source filing',summary:'Synthetic official-source record used only for browser verification.',source_url:sourceUrl,published_at:'2025-12-15T12:00:00.000Z',category:'10-Q',provider:'sec'});
export const approved=resourceSchema.parse({...filing,kind:'us_analysis',title:'Synthetic reviewed NVIDIA excerpt',summary:'A reviewed excerpt with a linked source quotation.',reviewed_at:fixtureNow,coverage:'excerpt',filing_id:sourceId});
export const upcoming={id:'80000000-0000-4000-8000-000000000701',company_id:companyId,title:'Synthetic verified future company event',occurs_on:'2026-11-14',source_url:sourceUrl,source_timezone:'America/New_York',verified_at:fixtureNow};
export const historical={...upcoming,id:'80000000-0000-4000-8000-000000000702',title:'Synthetic historical official event',occurs_on:'2025-10-05'};

export async function researchWorkspaceFixture(page:Page,options:{emptyContent?:boolean;following?:boolean;overviewError?:boolean;newsError?:boolean}={}){
 const fixture=await mobileFixture(page,{empty:true,watchIds:options.following?[companyId]:[],holdingIds:[]});
 const {state}=fixture;state.preferences.locale='en';state.digestPreferences.available=false;
 const control={emptyContent:!!options.emptyContent,overviewError:!!options.overviewError,newsError:!!options.newsError,newsEmpty:false};
 const blockedRequests:string[]=[],newsCompanyIds:string[]=[];
 const notifications=options.following?[{id:'80000000-0000-4000-8000-000000000703',created_at:fixtureNow,read_at:null as string|null,resource:approved}]:[];
 page.on('request',request=>{const url=new URL(request.url());if(/\/(?:api\/market|api\/us\/(?:indices|reference-rate)|v1\/portfolio)(?:[/?]|$)/.test(url.pathname)||/tradingview/i.test(url.hostname)||/embed-widget/i.test(url.pathname))blockedRequests.push(request.url());});
 const saved=(resource:Resource)=>({...resource,is_saved:state.saved.has(`${resource.kind}:${resource.id}`)});
 const resources=()=>[...companyResources,...(control.emptyContent?[]:[filing,approved])];
 const unread=()=>notifications.filter(item=>!item.read_at).length;
 await page.route('**/api/news?**',async route=>{
  const id=new URL(route.request().url()).searchParams.get('company_id');
  if(!id||!companies.some(company=>company.id===id)||!route.request().headers().authorization){state.unexpected.push('invalid company news request');await route.fulfill({status:400,json:{error:'invalid_company'}});return;}
  newsCompanyIds.push(id);
  if(control.newsError){await route.fulfill({status:502,json:{error:'provider_unavailable'}});return;}
  const query=id===companyId?'엔비디아':'애플 아이폰';
  await route.fulfill({json:newsResponse.parse({provider:'NAVER',query,retrievedAt:fixtureNow,items:control.newsEmpty?[]:[{title:'Synthetic company news article',link:'https://news.naver.com/synthetic',originalLink:'https://www.nvidia.com/en-us/about-nvidia/',publishedAt:fixtureNow}]})});
 });
 await page.route('**/api/workspace',async route=>{
  const parsed=workspaceRequest.safeParse(route.request().postDataJSON());
  if(!parsed.success){await route.fallback();return;}
  const {action,p}=parsed.data;
  const overridden=['source_overview','catalog','company','resource','document_detail','saved_list','content_notifications','content_notification_read'];
  if(!overridden.includes(action)){await route.fallback();return;}
  state.calls.push(parsed.data);
  switch(action){
   case 'source_overview':{
    if(control.overviewError){await route.fulfill({status:503,json:{error:{code:'service_unavailable'}}});return;}
    const fallback=p.scope!=='all'&&state.watched.size===0,scope=p.scope==='all'||fallback?'all':'following';
    const ids=p.company_id?[p.company_id]:scope==='all'?companies.map(c=>c.id):[...state.watched];
    const hasContent=!control.emptyContent&&ids.includes(companyId),inDateRange=!p.days||Date.parse(filing.published_at!)>=Date.parse(fixtureNow)-p.days*86400000;
    const filings=hasContent&&inDateRange?[saved(filing)]:[],analyses=hasContent&&inDateRange?[saved(approved)]:[];
    await route.fulfill({json:sourceOverviewSchema.parse({companies:ids.length,filing_count:filings.length,published_count:analyses.length,filings,analyses,historical_events:[],calendar:hasContent?[upcoming]:[],historical_calendar:hasContent?[historical]:[],scope,following_count:state.watched.size,fallback_to_all:fallback,saved_count:state.saved.size,unread_count:unread(),monitoring:ids.map(id=>({company_id:id,latest_filing:id===companyId&&hasContent?saved(filing):null,latest_analysis:id===companyId&&hasContent?saved(approved):null,next_event:id===companyId&&hasContent?upcoming:null,last_collected_at:id===companyId&&hasContent?fixtureNow:null,filing_count:id===companyId&&hasContent?1:0,analysis_count:id===companyId&&hasContent?1:0}))})});return;
   }
   case 'catalog':{
    const q=(p.q??'').toLowerCase(),all=resources().map(saved).filter(item=>(!q||`${item.title} ${item.ticker} ${item.company_name} ${item.summary}`.toLowerCase().includes(q))&&(!p.company_id||item.company_id===p.company_id)&&(!p.source||item.provider===p.source)&&(!p.category||item.category===p.category)&&(!p.market||item.market===p.market)&&(!p.days||!item.published_at||Date.parse(item.published_at)>=Date.parse(fixtureNow)-p.days*86400000));
    const selected=all.filter(item=>!p.kind||item.kind===p.kind||p.kind==='document'&&item.kind==='filing'||p.kind==='analysis'&&['us_analysis','dart_analysis'].includes(item.kind));
    if(p.sort==='newest')selected.sort((a,b)=>(b.published_at??'').localeCompare(a.published_at??''));
    const offset=p.offset??0,limit=p.limit??20,counts:Record<string,number>={company:0,event:0,document:0,filing:0,us_analysis:0,dart_analysis:0};
    for(const item of all)counts[item.kind]++;
    await route.fulfill({json:catalogSchema.parse({items:selected.slice(offset,offset+limit),total:selected.length,counts,markets:['NASDAQ'],categories:['10-Q'],next_offset:offset+limit<selected.length?offset+limit:null})});return;
   }
   case 'company':{
    const company=companyResources.find(item=>item.id===p.id);
    if(!company){await route.fulfill({status:404,json:{error:{code:'not_found'}}});return;}
    const hasContent=p.id===companyId&&!control.emptyContent,detail=eventDetails.get(events[0].id)!;
    await route.fulfill({json:companyDetailSchema.parse({company,events:[],documents:hasContent?[saved(filing)]:[],analyses:hasContent?[saved(approved)]:[],facts:hasContent?[{...detail.facts[0],event_id:events[0].id}]:[],watching:state.watched.has(p.id),holding:false})});return;
   }
   case 'resource':{
    const item=resources().find(item=>item.kind===p.kind&&item.id===p.id);
    if(!item){await route.fulfill({status:404,json:{error:{code:'not_found'}}});return;}
    await route.fulfill({json:saved(item)});return;
   }
   case 'document_detail':{
    if(p.kind!=='filing'||p.id!==sourceId||control.emptyContent){await route.fallback();return;}
    await route.fulfill({json:documentDetailSchema.parse({document:saved(filing),metadata:{mime_type:'text/html',size_bytes:null,page_count:null,provider:'sec',publication_timezone:'America/New_York',ingested_at:fixtureNow,raw_sha256:'a'.repeat(64)},approved_analyses:[{resource:saved(approved),analysis:{filing_id:sourceId,status:'approved',created_at:fixtureNow,reviewed_at:fixtureNow,result:{claims:[{text:'The source excerpt reports quarterly revenue of USD 45,000 million.',quote:sourceQuote}],source_url:sourceUrl,uncertainty:'This synthetic summary covers only the cited excerpt.',validation:'supported',coverage:'excerpt'}}}],summaries:[],facts:[],sections:[{id:'60000000-0000-4000-8000-000000000101',title:'Synthetic source excerpt',location:'Item 2 · paragraph 1',content:sourceQuote,page_start:null,page_end:null}],sections_total:1,next_section_offset:null,events:[],related:[],counts:{summaries:0,facts:0,events:0,related:0}})});return;
   }
   case 'saved_list':{
    const all=resources(),bookmarks=all.filter(item=>state.saved.has(`${item.kind}:${item.id}`)).map(item=>({...saved(item),saved_at:fixtureNow})),history=all.filter(item=>state.visits.has(`${item.kind}:${item.id}`)).map(item=>({...saved(item),saved_at:state.visits.get(`${item.kind}:${item.id}`)!}));
    const selected=(p.kind==='history'?history:bookmarks).filter(item=>(!p.kind||p.kind==='history'||item.kind===p.kind||p.kind==='document'&&item.kind==='filing'||p.kind==='analysis'&&['us_analysis','dart_analysis'].includes(item.kind))&&(!p.company||item.company_id===p.company)&&(!p.q||`${item.title} ${item.ticker}`.toLowerCase().includes(p.q.toLowerCase())));
    await route.fulfill({json:savedSchema.parse({items:selected,counts:{event:bookmarks.filter(item=>item.kind==='event').length,document:bookmarks.filter(item=>['document','filing'].includes(item.kind)).length,analysis:bookmarks.filter(item=>['us_analysis','dart_analysis'].includes(item.kind)).length,history:history.length}})});return;
   }
   case 'content_notifications':await route.fulfill({json:contentNotificationsSchema.parse({items:notifications.map(item=>({...item,resource:saved(item.resource)})),unread_count:unread()})});return;
   case 'content_notification_read':for(const item of notifications)if(p.all||p.id===item.id)item.read_at=fixtureNow;await route.fulfill({json:{read:true}});return;
  }
 });
 return {...fixture,control,blockedRequests,newsCompanyIds};
}
export type ResearchFixture=Awaited<ReturnType<typeof researchWorkspaceFixture>>;
