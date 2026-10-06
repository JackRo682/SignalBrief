import {z} from 'zod';
const uuid=z.string().uuid();
export const resourceKind=z.enum(['company','event','document','filing']);
export const resourceSchema=z.object({id:z.string(),kind:resourceKind,title:z.string(),summary:z.string(),company_id:z.string(),company_name:z.string(),ticker:z.string(),market:z.string(),source_url:z.string().nullable(),published_at:z.string().nullable(),publication_precision:z.string(),category:z.string(),is_saved:z.boolean(),saved_at:z.string().optional()});
export type Resource=z.infer<typeof resourceSchema>;
export const preferenceValue=z.object({timezone:z.string().min(1).max(100),locale:z.enum(['ko','en']),theme:z.enum(['light','dark','system']),ui_density:z.enum(['comfortable','compact']),font_scale:z.number().int().min(0).max(3),reduced_motion:z.boolean(),chart_animation:z.boolean(),history_enabled:z.boolean(),quiet_enabled:z.boolean(),quiet_start:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),quiet_end:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),daily_cap:z.number().int().min(1).max(100),muted_companies:z.array(uuid).max(50),bio:z.string().max(160)}).strict();
export type Preferences=z.infer<typeof preferenceValue>;
export const preferenceSchema=z.object({value:preferenceValue,version:z.number().int().nonnegative()});
export const defaults:Preferences={timezone:'Asia/Seoul',locale:'ko',theme:'light',ui_density:'comfortable',font_scale:1,reduced_motion:false,chart_animation:true,history_enabled:false,quiet_enabled:false,quiet_start:'22:00',quiet_end:'07:00',daily_cap:3,muted_companies:[],bio:''};
export const catalogSchema=z.object({items:z.array(resourceSchema),total:z.number(),counts:z.record(z.number()),markets:z.array(z.string()),next_offset:z.number().nullable()});
export const savedSchema=z.object({items:z.array(resourceSchema),counts:z.object({event:z.number(),document:z.number(),history:z.number()})});
export const companyDetailSchema=z.object({company:resourceSchema,events:z.array(resourceSchema),documents:z.array(resourceSchema),facts:z.array(z.object({id:z.string(),field:z.string(),value_raw:z.string().nullable(),unit:z.string().nullable(),period:z.string().nullable(),basis:z.string(),quote:z.string(),event_id:z.string()})),watching:z.boolean(),holding:z.boolean()});
export const documentDetailSchema=z.object({
 document:resourceSchema,
 metadata:z.object({mime_type:z.string().nullable(),size_bytes:z.number().int().nonnegative().nullable(),page_count:z.number().int().positive().nullable(),provider:z.string(),publication_timezone:z.string().nullable(),ingested_at:z.string().nullable(),raw_sha256:z.string().nullable()}),
 summaries:z.array(z.object({event_id:z.string(),title:z.string(),text:z.string()})),
 facts:z.array(z.object({id:z.string(),field:z.string(),value_raw:z.string().nullable(),unit:z.string().nullable(),period:z.string().nullable(),basis:z.string(),quote:z.string(),event_id:z.string(),origin_event_id:z.string(),source_url:z.string(),location:z.string()})),
 sections:z.array(z.object({id:z.string(),title:z.string(),location:z.string(),content:z.string(),page_start:z.number().int().positive().nullable(),page_end:z.number().int().positive().nullable()})),
 sections_total:z.number().int().nonnegative(),next_section_offset:z.number().int().nonnegative().nullable(),
 events:z.array(resourceSchema),related:z.array(resourceSchema),counts:z.object({summaries:z.number().int().nonnegative(),facts:z.number().int().nonnegative(),events:z.number().int().nonnegative(),related:z.number().int().nonnegative()})
});
export const ticketSchema=z.object({id:uuid,title:z.string(),category:z.string(),state:z.enum(['open','in_progress','resolved']),created_at:z.string(),message:z.string().optional(),attachments:z.array(z.object({filename:z.string(),object_path:z.string(),mime_type:z.string()})).optional()});
export const accountSchema=z.object({created_at:z.string(),bio:z.string(),tickets:z.array(ticketSchema)});
export const securitySchema=z.object({sessions:z.array(z.object({id:z.string(),created_at:z.string(),last_seen:z.string(),user_agent:z.string().nullable(),aal:z.string().nullable(),current:z.boolean()})),history:z.array(z.object({created_at:z.string(),action:z.string()}))});
export const notificationsSettingsSchema=z.object({realtime_enabled:z.boolean(),notify_min_score:z.number().min(0).max(1)});
export const searchesSchema=z.array(z.object({query:z.string(),searched_at:z.string()}));
export const quoteSchema=z.object({symbol:z.string(),price:z.number().nullable(),currency:z.string(),change_pct:z.number().nullable(),as_of:z.string(),source:z.string(),history:z.array(z.object({date:z.string(),close:z.number()})).default([])}).passthrough();
export const quotesSchema=z.object({quotes:z.array(quoteSchema),available:z.boolean().optional(),reason:z.string().optional()});
const empty=z.object({}).strict();
const idPayload=z.object({id:uuid}).strict();
const decimalString=z.string().regex(/^\d{1,20}(\.\d{1,8})?$/);
const onboardingPosition=z.object({company_id:uuid,quantity:decimalString.refine(v=>/[1-9]/.test(v),'Quantity must be positive'),average_cost:decimalString.nullable(),currency:z.enum(['USD','KRW','EUR','JPY','GBP','AUD','CAD','HKD','CNY','CHF'])}).strict();
export const workspaceRequest=z.discriminatedUnion('action',[
 z.object({action:z.literal('preferences'),p:empty}),
 z.object({action:z.literal('preferences_save'),p:z.object({value:preferenceValue.partial(),version:z.number().int().nonnegative()}).strict()}),
 z.object({action:z.literal('catalog'),p:z.object({q:z.string().max(100).optional(),market:z.string().max(32).optional(),kind:resourceKind.or(z.literal('')).optional(),days:z.number().int().min(0).max(3650).optional(),offset:z.number().int().min(0).max(1000).optional(),limit:z.number().int().min(1).max(50).optional(),sort:z.enum(['relevance','newest']).optional()}).strict()}),
 z.object({action:z.literal('resource'),p:z.object({kind:resourceKind,id:uuid}).strict()}),
 z.object({action:z.literal('document_detail'),p:z.object({id:uuid,kind:z.enum(['document','filing']),section_offset:z.number().int().min(0).max(2147483600).optional()}).strict()}),
 z.object({action:z.literal('notifications'),p:empty}),
 z.object({action:z.literal('notification_save'),p:z.object({realtime_enabled:z.boolean().optional(),notify_min_score:z.number().min(0).max(1).optional()}).strict()}),
 z.object({action:z.literal('company'),p:idPayload}),
 z.object({action:z.literal('saved_list'),p:z.object({kind:z.enum(['','event','document','history']).optional(),q:z.string().max(100).optional(),company:uuid.or(z.literal('')).optional(),sort:z.enum(['oldest','newest']).optional()}).strict()}),
 z.object({action:z.literal('save'),p:z.object({kind:z.enum(['event','document','filing']),id:uuid,saved:z.boolean()}).strict()}),
 z.object({action:z.literal('visit'),p:z.object({kind:resourceKind,id:uuid}).strict()}),
 z.object({action:z.literal('searches'),p:empty}),z.object({action:z.literal('search_record'),p:z.object({query:z.string().trim().min(1).max(100)}).strict()}),
 z.object({action:z.literal('search_delete'),p:z.object({query:z.string().trim().min(1).max(100)}).strict()}),z.object({action:z.literal('searches_clear'),p:empty}),
 z.object({action:z.literal('onboarding_complete'),p:z.object({company_ids:z.array(uuid).max(10),removed_company_ids:z.array(uuid).max(50),positions:z.array(onboardingPosition).max(10),analytics_consent:z.boolean().optional()}).strict()}),
 z.object({action:z.literal('history_clear'),p:empty}),z.object({action:z.literal('account'),p:empty}),z.object({action:z.literal('security'),p:empty}),
 z.object({action:z.literal('ticket_create'),p:z.object({request_key:uuid,category:z.enum(['general','data','bug','feedback','privacy']),title:z.string().trim().min(1).max(120),message:z.string().trim().min(1).max(2000)}).strict()}),
 z.object({action:z.literal('ticket_attach'),p:z.object({ticket_id:uuid,object_path:z.string().max(200),filename:z.string().min(1).max(150),mime_type:z.enum(['image/png','image/jpeg','image/webp','application/pdf']),size_bytes:z.number().int().min(1).max(5242880)}).strict()}),
 z.object({action:z.literal('tickets'),p:z.object({admin:z.boolean().optional()}).strict()}),z.object({action:z.literal('ticket_update'),p:z.object({id:uuid,state:z.enum(['open','in_progress','resolved'])}).strict()}),
 z.object({action:z.literal('export'),p:empty})
]);
export type WorkspaceRequest=z.infer<typeof workspaceRequest>;
export function resourceHref(r:Resource){if(r.kind==='company')return `/companies/${encodeURIComponent(r.id)}`;if(r.kind==='event')return `/events/${encodeURIComponent(r.id)}`;return `/documents/${encodeURIComponent(r.id)}?kind=${r.kind}`;}
export function safeSource(url:string|null):string|undefined{try{const u=new URL(url??'');return u.protocol==='https:'&&!u.username&&!u.password&&!u.hostname.endsWith('.invalid')?u.href:undefined;}catch{return undefined;}}
export function chartPoints(values:number[]):string|null {if(values.length<2||values.some(x=>!Number.isFinite(x)))return null;const lo=Math.min(...values),range=Math.max(...values)-lo;return values.map((v,i)=>`${i*200/(values.length-1)},${range?60-(v-lo)/range*52:32}`).join(' ');}
