// Exercise the real API handler and Supabase query builder against an isolated transport.
const assert=(value:unknown)=>{if(!value)throw new Error('assertion failed');};
Deno.test('calendar API preserves IR sources, bounds queries, scopes membership and rejects invalid dates',async()=>{
 const originalServe=Deno.serve,originalFetch=globalThis.fetch;
 const previousUrl=Deno.env.get('SUPABASE_URL'),previousKey=Deno.env.get('SUPABASE_ANON_KEY');
 let handle:((req:Request)=>Promise<Response>)|undefined,watched=true,calendarUrl:URL|undefined;
 Deno.env.set('SUPABASE_URL','https://isolated-calendar.example.invalid');Deno.env.set('SUPABASE_ANON_KEY','isolated-test-publishable-key');
 Deno.serve=((handler:typeof handle)=>{handle=handler;return {} as Deno.HttpServer;}) as typeof Deno.serve;
 const company='10000000-0000-4000-8000-000000000001';
 const json=(data:unknown)=>new Response(JSON.stringify(data),{headers:{'content-type':'application/json'}});
 globalThis.fetch=(async(input:RequestInfo|URL)=>{
  const url=new URL(input instanceof Request?input.url:input.toString());
  assert(url.hostname==='isolated-calendar.example.invalid');
  if(url.pathname==='/auth/v1/user')return json({id:'10000000-0000-4000-8000-000000000071',aud:'authenticated',role:'authenticated',email:'test@example.invalid'});
  if(url.pathname.endsWith('/rpc/sb_rate_limit'))return json(null);
  if(url.pathname.endsWith('/rpc/sb_watchlist'))return json({items:watched?[{id:company}]:[]});
  if(url.pathname.endsWith('/rpc/sb_portfolio'))return json({positions:[]});
  if(url.pathname.endsWith('/calendar_items')){calendarUrl=url;return json([{id:'calendar-1',company_id:company,event_id:null,chunk_id:null,title:'Official earnings call',occurs_on:'2026-10-28',origin:'official',quote:'Source quote',source_url:'https://www.microsoft.com/en-us/investor/default'}]);}
  throw new Error('unexpected transport '+url.pathname);
 }) as typeof fetch;
 try{
  await import('./index.ts?calendar-regression');Deno.serve=originalServe;
  const call=(query:string,auth=true)=>handle!(new Request('https://signalbrief.test/v1/calendar'+query,{headers:auth?{Authorization:'Bearer isolated-test-bearer-token'}:{}}));
  const response=await call('?from_date=2026-10-01&until_date=2026-10-31');
  assert(response.status===200);const items=await response.json();assert(items[0].source_url==='https://www.microsoft.com/en-us/investor/default');
  assert(calendarUrl?.searchParams.getAll('occurs_on').join(',')==='gte.2026-10-01,lte.2026-10-31');
  assert(calendarUrl?.searchParams.get('calendar_status')==='eq.confirmed');
  assert(calendarUrl?.searchParams.get('or')?.includes(company));assert(calendarUrl?.searchParams.get('limit')==='500');
  for(const query of ['?from_date=2026-02-30','?from_date=2026-11-01&until_date=2026-10-01'])assert((await call(query)).status===422);
  assert((await call('',false)).status===401);
  watched=false;assert((await call('')).status===200);assert(calendarUrl?.searchParams.get('origin')==='eq.user');
 }finally{
  Deno.serve=originalServe;globalThis.fetch=originalFetch;
  if(previousUrl===undefined)Deno.env.delete('SUPABASE_URL');else Deno.env.set('SUPABASE_URL',previousUrl);
  if(previousKey===undefined)Deno.env.delete('SUPABASE_ANON_KEY');else Deno.env.set('SUPABASE_ANON_KEY',previousKey);
 }
});
