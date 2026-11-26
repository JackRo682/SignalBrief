import {z} from 'zod';
export const pages=['home','about','features','sources','pricing','customers','privacy','terms','disclaimer','signup','login','onboarding'] as const;
export const sources=['direct','google','naver','kakao','disquiet','geeknews','youtube','x','other'] as const;
export const kinds=['page_view','signup_start','signup_requested','signup_complete','onboarding_complete'] as const;
const identity={visitor_id:z.uuid(),secret:z.string().regex(/^[a-f0-9]{64}$/)};
export const productKinds=['search_used','filter_used','event_detail_click','event_detail_view'] as const;
export const productPages=['search','calendar','app_home','today','event_detail'] as const;
export const productFilterTypes=['kind','source','period','sort','market','company','category','scope','view','personal','reset'] as const;
export const PRODUCT_CONSENT_VERSION='2026-11-20';
const productBase={action:z.literal('record'),...identity,id:z.uuid(),source:z.enum(sources),product_consent_version:z.literal(PRODUCT_CONSENT_VERSION)};
const actionPage=z.enum(['search','calendar','app_home','today']);
export const productRecord=z.discriminatedUnion('kind',[
 z.object({...productBase,kind:z.literal('search_used'),page:actionPage}).strict(),
 z.object({...productBase,kind:z.literal('filter_used'),page:actionPage,filter_type:z.enum(productFilterTypes)}).strict(),
 z.object({...productBase,kind:z.literal('event_detail_click'),page:actionPage,event_kind:z.enum(['published','calendar'])}).strict(),
 z.object({...productBase,kind:z.literal('event_detail_view'),page:z.literal('event_detail'),event_kind:z.enum(['published','calendar'])}).strict(),
]);
export const surfaces=[...pages.filter(page=>page!=='onboarding'),...productPages] as const;
export const surfaceRequest=z.object({
 action:z.literal('surface'),...identity,id:z.uuid(),source:z.enum(sources),
 surface:z.enum(surfaces),release:z.string().regex(/^(?:[0-9a-f]{7,40}|unversioned)$/),
 active_ms:z.number().int().min(0).max(86400000),consent_version:z.literal('2026-11-26'),
}).strict();
export const trafficRequest=z.union([
 surfaceRequest,
 z.object({action:z.literal('record'),...identity,id:z.uuid(),kind:z.enum(kinds),page:z.enum(pages),source:z.enum(sources)}).strict(),
 productRecord,
 z.object({action:z.literal('erase'),...identity}).strict(),
 z.object({action:z.literal('summary'),from:z.iso.date(),to:z.iso.date()}).strict(),
]);
const counts={visitors:z.number().int().nonnegative(),pageviews:z.number().int().nonnegative(),starts:z.number().int().nonnegative(),requests:z.number().int().nonnegative(),signups:z.number().int().nonnegative(),onboarded:z.number().int().nonnegative()};
const productCount=z.number().int().nonnegative();
export const productSummary=z.object({landing_visitors:productCount,engaged_visitors:productCount,detail_click_visitors:productCount,detail_view_visitors:productCount,search_events:productCount,filter_events:productCount,detail_click_events:productCount,detail_view_events:productCount}).refine(value=>value.engaged_visitors<=value.landing_visitors&&value.detail_click_visitors<=value.engaged_visitors&&value.detail_view_visitors<=value.detail_click_visitors,'Funnel stages must be nested within the landing cohort');
export const trafficSummary=z.object({generated_at:z.iso.datetime({offset:true}),totals:z.object(counts),daily:z.array(z.object({day:z.iso.date(),...counts})),sources:z.array(z.object({source:z.enum(sources),...counts})),product:productSummary.optional(),
 surface_times:z.array(z.object({surface:z.enum(surfaces),release:z.string(),views:productCount,browsers:productCount,mean_ms:productCount,median_ms:productCount})).optional(),
 feature_actions:z.array(z.object({page:z.enum(productPages),kind:z.enum(productKinds),events:productCount,browsers:productCount})).optional()});
export type ProductKind=typeof productKinds[number];
export type ProductPage=typeof productPages[number];
export type ProductRecord=z.infer<typeof productRecord>;
export type ProductSummary=z.infer<typeof productSummary>;
export type TrafficSummary=z.infer<typeof trafficSummary>;
export type TrafficKind=typeof kinds[number];
export type TrafficPage=typeof pages[number];
export function trafficPage(path:string):TrafficPage|null{const name=path==='/'?'home':path.slice(1);return (pages as readonly string[]).includes(name)&&name!=='onboarding'?name as TrafficPage:null;}
export function trafficSource(href:string,referrer:string):typeof sources[number]{
 try{
  const current=new URL(href),utm=current.searchParams.get('utm_source')?.toLowerCase();
  const explicit:Record<string,typeof sources[number]>={google:'google',naver:'naver',kakao:'kakao',disquiet:'disquiet',geeknews:'geeknews',youtube:'youtube',twitter:'x',x:'x'};
  if(utm)return explicit[utm]??'other';
  if(!referrer)return 'direct';const ref=new URL(referrer);if(ref.origin===current.origin)return 'direct';
  const host=ref.hostname.toLowerCase();
  if(['google.com','google.co.kr','google.co.uk','google.de','google.co.jp','google.fr','google.ca','google.com.au'].some(domain=>host===domain||host.endsWith('.'+domain)))return 'google';
  for(const [domain,source] of [['naver.com','naver'],['disquiet.io','disquiet'],['news.hada.io','geeknews'],['youtube.com','youtube'],['youtu.be','youtube'],['x.com','x'],['twitter.com','x']] as const)if(host===domain||host.endsWith('.'+domain))return source;
  return 'other';
 }catch{return 'direct';}
}
