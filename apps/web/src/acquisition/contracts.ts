import {z} from 'zod';
export const pages=['home','about','features','sources','pricing','customers','privacy','terms','disclaimer','signup','login','onboarding'] as const;
export const sources=['direct','google','naver','disquiet','geeknews','youtube','x','other'] as const;
export const kinds=['page_view','signup_start','signup_requested','signup_complete','onboarding_complete'] as const;
const identity={visitor_id:z.uuid(),secret:z.string().regex(/^[a-f0-9]{64}$/)};
export const trafficRequest=z.discriminatedUnion('action',[
 z.object({action:z.literal('record'),...identity,id:z.uuid(),kind:z.enum(kinds),page:z.enum(pages),source:z.enum(sources)}).strict(),
 z.object({action:z.literal('erase'),...identity}).strict(),
 z.object({action:z.literal('summary'),from:z.iso.date(),to:z.iso.date()}).strict(),
]);
const counts={visitors:z.number().int().nonnegative(),pageviews:z.number().int().nonnegative(),starts:z.number().int().nonnegative(),requests:z.number().int().nonnegative(),signups:z.number().int().nonnegative(),onboarded:z.number().int().nonnegative()};
export const trafficSummary=z.object({generated_at:z.iso.datetime({offset:true}),totals:z.object(counts),daily:z.array(z.object({day:z.iso.date(),...counts})),sources:z.array(z.object({source:z.enum(sources),...counts}))});
export type TrafficSummary=z.infer<typeof trafficSummary>;
export type TrafficKind=typeof kinds[number];
export type TrafficPage=typeof pages[number];
export function trafficPage(path:string):TrafficPage|null{const name=path==='/'?'home':path.slice(1);return (pages as readonly string[]).includes(name)&&name!=='onboarding'?name as TrafficPage:null;}
export function trafficSource(href:string,referrer:string):typeof sources[number]{
 try{
  const current=new URL(href),utm=current.searchParams.get('utm_source')?.toLowerCase();
  const explicit:Record<string,typeof sources[number]>={google:'google',naver:'naver',disquiet:'disquiet',geeknews:'geeknews',youtube:'youtube',twitter:'x',x:'x'};
  if(utm)return explicit[utm]??'other';
  if(!referrer)return 'direct';const ref=new URL(referrer);if(ref.origin===current.origin)return 'direct';
  const host=ref.hostname.toLowerCase();
  if(['google.com','google.co.kr','google.co.uk','google.de','google.co.jp','google.fr','google.ca','google.com.au'].some(domain=>host===domain||host.endsWith('.'+domain)))return 'google';
  for(const [domain,source] of [['naver.com','naver'],['disquiet.io','disquiet'],['news.hada.io','geeknews'],['youtube.com','youtube'],['youtu.be','youtube'],['x.com','x'],['twitter.com','x']] as const)if(host===domain||host.endsWith('.'+domain))return source;
  return 'other';
 }catch{return 'direct';}
}
