import {dateOnly,parseSource,fetchSource,type Source} from './core.ts';
const assert=(value:unknown)=>{if(!value)throw new Error('assertion failed');};
const rejects=(fn:()=>unknown)=>{let rejected=false;try{fn();}catch{rejected=true;}assert(rejected);};
const samsung:Source={key:'samsung-ir',ticker:'005930',market:'KOSPI',url:'https://www.samsung.com/global/ir/ir-events-presentations/events/',adapter:'samsung'};
const microsoft:Source={key:'microsoft-ir',ticker:'MSFT',market:'NASDAQ',url:'https://www.microsoft.com/en-us/investor/default',adapter:'microsoft'};
const pair=(date:string,title='3Q26 Earnings Conference Call')=>`<dl class="ir-event-list__detail"><dt>${title}</dt><dd>${date}</dd></dl>`;
const history=(year:string,body:string)=>`<strong class="ir-expand__title">${year}</strong>${body}`;
const page=(upcoming='',past=history('2026',''))=>`<section><h2>Upcoming Events</h2>${upcoming}</section><section class="ir-event-wrap__past"><h2>Past Events</h2>${past}</section>`;
const sam=(date:string,title='3Q26 Earnings Conference Call')=>page(pair(date,title));
const ms=(events:unknown[])=>`<cascade eventsData="${JSON.stringify({Events:events}).replaceAll('"','&#34;')}">`;
const event={EventID:'123',EventName:'Quarterly Earnings Call',DateTime:{Local:'2026-10-28T14:30:00',UTC:'2026-10-28T21:30:00',TimeZone:'PT'}};
Deno.test('real calendar dates reject rollover and malformed dates',()=>{assert(dateOnly('2028-02-29')==='2028-02-29');for(const date of ['2026-02-29','2026-13-01','26-01-01','2026-04-31'])rejects(()=>dateOnly(date));});
Deno.test('Samsung accepts explicit date and timezone with exact quote',()=>{const r=parseSource(samsung,sam('October 29, 2026, 10:00 a.m. KST'),'2026-10-19');assert(r.entries[0].occurs_on==='2026-10-29');assert(r.entries[0].timezone==='Asia/Seoul');assert(r.text.includes(r.entries[0].quote));});
Deno.test('Samsung rejects missing or ambiguous range years and dates',()=>{for(const date of ['October 29','TBD','October 28 ~ 29','December 30 ~ January 2, 2026','December 30, 2026 ~ January 2','October 29 ~ 28, 2026','February 28 ~ 30, 2026','October 28 ~ 28, 2026','October 29, 2026, 10:00 a.m. UTC'])rejects(()=>parseSource(samsung,sam(date),'2026-10-19'));});
Deno.test('Samsung accepts an empty current month and retains confirmed historical dates',()=>{
 const r=parseSource(samsung,page('',history('2026',pair('October 29, 2026, 10:00 a.m. KST')+pair('October 8, 2026','3Q26 Guidance Announcement'))),'2026-11-02');
 assert(r.entries.length===2);assert(r.entries[0].occurs_on==='2026-10-29');assert(r.entries[0].key==='date:2026-10-29:3q26 earnings conference call');
 assert(r.entries[0].location.startsWith('Past Events/2026/'));assert(r.text.includes(r.entries[0].quote));
});
Deno.test('Samsung ranges produce exactly one explicitly labelled source start with full evidence',()=>{
 for(const [published,start,end] of [['September 21 ~ 22, 2026','2026-09-21','2026-09-22'],['August 31 ~ September 4, 2026','2026-08-31','2026-09-04'],['October 28-29, 2026','2026-10-28','2026-10-29'],['December 30, 2026 ~ January 2, 2027','2026-12-30','2027-01-02']]){
  const r=parseSource(samsung,sam(published,'Official conference'),'2026-11-02');assert(r.entries.length===1);
  const e=r.entries[0];assert(e.occurs_on===start);assert(e.ends_on===end);assert(e.title.includes(`기간 시작 (${published})`));assert(e.quote===`Official conference ${published}`);assert(r.text.includes(e.quote));
 }
});
Deno.test('Samsung ignores malformed old year groups and comments, but rejects malformed relevant years',()=>{
 const old=history('2015',pair('Venue instead of date'));
 const recent=history('2026',pair('October 29, 2026')+'<!--'+pair('TBD')+'--><script>'+pair('TBD')+'</script>');
 assert(parseSource(samsung,page('',recent+old),'2026-11-02').entries.length===1);
 rejects(()=>parseSource(samsung,page('',history('2026',pair('TBD'))),'2026-11-02'));
 rejects(()=>parseSource(samsung,page('',history('2026',pair('October 29, 2025'))),'2026-11-02'));
});
Deno.test('Samsung recurring titles retain distinct dates and the same event deduplicates across sections',()=>{
 const r=parseSource(samsung,page(pair('October 29, 2026','Investor conference'),history('2026',pair('October 29, 2026','Investor conference')+pair('August 20, 2026','Investor conference'))),'2026-11-02');
 assert(r.entries.length===2);assert(new Set(r.entries.map(e=>e.key)).size===2);
 rejects(()=>parseSource(samsung,page('',history('2026',pair('September 21 ~ 22, 2026','Investor conference')+pair('September 21 ~ 23, 2026','Investor conference'))),'2026-11-02'));
});
Deno.test('Samsung empty bounded sections are valid but missing sections or unassigned rows fail closed',()=>{
 assert(parseSource(samsung,page(),'2026-11-02').entries.length===0);
 for(const html of [page().replace('Past Events','Archive').replace('ir-event-wrap__past','other'),page('',pair('October 29, 2026')+history('2026','')),page('',history('2026',pair('October 29, 2026').replace('</dd>',''))),page('',history('2026','')+history('2026',''))])rejects(()=>parseSource(samsung,html,'2026-11-02'));
});
Deno.test('Microsoft uses source local day, no UTC day shift',()=>{const r=parseSource(microsoft,ms([{...event,DateTime:{...event.DateTime,Local:'2026-10-28T23:30:00',UTC:'2026-10-29T06:30:00'}}]),'2026-10-19');assert(r.entries[0].occurs_on==='2026-10-28');assert(r.text.includes(r.entries[0].quote));});
Deno.test('duplicates collapse and contradictory source identities fail closed',()=>{assert(parseSource(microsoft,ms([event,event]),'2026-10-19').entries.length===1);rejects(()=>parseSource(microsoft,ms([event,{...event,DateTime:{...event.DateTime,Local:'2026-10-29T14:30:00'}}]),'2026-10-19'));});
Deno.test('format changes and unknown timezones fail closed',()=>{rejects(()=>parseSource(microsoft,'no schedule','2026-10-19'));rejects(()=>parseSource(microsoft,ms([{...event,DateTime:{...event.DateTime,TimeZone:'unknown'}}]),'2026-10-19'));});
Deno.test('old events do not crowd out upcoming dates',()=>{assert(parseSource(microsoft,ms([{...event,DateTime:{...event.DateTime,Local:'2020-01-01T00:00:00'}}, {...event,EventID:'456'}]),'2026-10-19').entries.length===1);});
Deno.test('fetch refuses unapproved URLs before networking',async()=>{let called=false,rejected=false;try{await fetchSource({...samsung,url:'https://attacker.test/'},(()=>{called=true;throw new Error();}) as typeof fetch);}catch{rejected=true;}assert(rejected&&!called);});
Deno.test('fetch rejects upstream errors, content and oversized responses',async()=>{for(const response of [new Response('',{status:403}),new Response('{}',{headers:{'content-type':'application/json'}}),new Response('a'.repeat(2000001),{headers:{'content-type':'text/html'}})]){let rejected=false;try{await fetchSource(samsung,(()=>Promise.resolve(response)) as typeof fetch);}catch{rejected=true;}assert(rejected);}});
