import {z} from 'zod';
const id=z.string().uuid(), short=z.string().trim().min(1).max(120);
const source=z.string().url().max(2000).refine(v=>{const u=new URL(v);return u.protocol==='https:'&&['sec.gov','www.sec.gov'].includes(u.hostname)&&u.pathname.startsWith('/Archives/')&&!u.username&&!u.password&&!u.port;});
const variant=z.object({content:z.string().min(20).max(12000),question:z.string().min(3).max(1000),answer:z.string().trim().min(1).max(500),source_url:source}).strict();
const req=<T extends z.ZodRawShape>(action:string,p:T)=>z.object({action:z.literal(action),p:z.object(p).strict()}).strict();
export const researchRequest=z.union([
 req('experiments',{}),req('experiment',{id}),req('experiment_create',{name:short.min(3),hypothesis:z.string().min(10).max(2000),screen:z.enum(['today','event','document']),design:z.enum(['between','crossover']),ratio:z.number().int().min(1).max(99),metric:z.enum(['accuracy','completion','active_time','evidence']),consent_text:z.string().min(20).max(4000),config:z.object({A:variant,B:variant}).strict()}),
 req('experiment_status',{id,status:z.enum(['running','paused','completed'])}),
 req('study',{id}),req('join',{id,consent:z.literal(true),consent_version:short}),req('withdraw',{id}),req('expose',{id,phase:z.number().int().min(0).max(1)}),
 req('study_event',{id,phase:z.number().int().min(0).max(1),active_ms:z.number().int().min(0).max(3600000),evidence_opened:z.boolean()}),req('submit',{id,phase:z.number().int().min(0).max(1),answer:z.string().trim().min(1).max(500),confidence:z.number().int().min(1).max(5)}),
 req('track',{id,session_id:id,page_id:id,screen:z.enum(['today','explore','search','watchlist','portfolio','timeline','questions','calendar','alerts','saved','settings','onboarding','company','event','document','help']),device:z.enum(['mobile','desktop']),kind:z.enum(['view','heartbeat','click','conversion']),active_ms:z.number().int().min(0).max(15000)}),
 req('analytics',{from:z.string().date(),to:z.string().date(),screen:z.string().max(30),device:z.enum(['','mobile','desktop'])}),req('analytics_delete',{}),
 req('datasets',{}),req('dataset',{id}),req('dataset_create',{name:short.min(3),split:z.enum(['review','holdout'])}),
 req('case_create',{dataset_id:id,filing_id:id,previous_filing_id:id,field:short,period:short,previous_period:short,unit:short,expected:z.string().max(80).regex(/^-?\d+(\.\d+)?$|^$/),previous_expected:z.string().max(80).regex(/^-?\d+(\.\d+)?$|^$/),answerable:z.boolean(),quote:z.string().min(5).max(8000),previous_quote:z.string().min(5).max(8000)}),
 req('case_review',{id,status:z.enum(['approved','rejected','held']),reason:z.string().min(5).max(2000)}),
 req('evaluations',{}),req('evaluation',{id}),req('evaluation_create',{dataset_id:id,method:z.enum(['A','B','C']),idempotency_key:id}),req('evaluation_execute',{id}),req('evaluation_budget',{usd:z.number().min(0).max(10)}),
 req('quality',{}),req('reliability',{}),req('reports',{}),req('check_record',{name:short,status:z.enum(['passed','failed','blocked']),environment:z.enum(['local','preview','production']),evidence:z.string().min(10).max(4000)})
]);
export type Row=Record<string,unknown>;
export const responseSchema=z.record(z.unknown());
export const rows=(v:unknown):Row[]=>z.array(responseSchema).parse(v??[]);
export const row=(v:unknown):Row=>responseSchema.parse(v??{});
export const str=(v:unknown)=>v==null?'':String(v);
export const measure=(v:unknown,suffix='')=>v==null?'미측정':`${Number(v).toLocaleString('ko-KR',{maximumFractionDigits:2})}${suffix}`;
export const pct=(v:unknown)=>v==null?'—':`${(Number(v)*100).toFixed(1)}%`;
