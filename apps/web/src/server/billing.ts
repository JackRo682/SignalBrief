import {createHmac,timingSafeEqual,createHash} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import {z} from 'zod';

export class BillingError extends Error {constructor(public status:number,public code:string){super(code);}}
export const billingHeaders={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
export function billingFailure(error:unknown){const e=error instanceof BillingError?error:new BillingError(502,'billing_unavailable');return Response.json({error:{code:e.code}},{status:e.status,headers:billingHeaders});}
export function billingConfig(){
 const mode=process.env.LEMONSQUEEZY_MODE??'disabled';
 if(!['test','live'].includes(mode))throw new BillingError(503,'payments_not_configured');
 if(mode==='live'&&process.env.LEMONSQUEEZY_LIVE_APPROVED!=='true')throw new BillingError(503,'merchant_approval_required');
 const key=process.env.LEMONSQUEEZY_API_KEY,secret=process.env.LEMONSQUEEZY_WEBHOOK_SECRET,store=process.env.LEMONSQUEEZY_STORE_ID,variant=process.env.LEMONSQUEEZY_VARIANT_ID;
 const amount=Number(process.env.LEMONSQUEEZY_PASS_AMOUNT),currency=process.env.LEMONSQUEEZY_PASS_CURRENCY;
 if(!key||!secret||secret.length<16||!store||!/^\d+$/.test(store)||!variant||!/^\d+$/.test(variant)||!Number.isSafeInteger(amount)||amount<=0||!currency||!/^[A-Z]{3}$/.test(currency)||!process.env.SUPABASE_SERVICE_ROLE_KEY)throw new BillingError(503,'payments_not_configured');
 return {key,secret,store,variant,amount,currency,test:mode==='test'};
}
export function billingDb(auth?:string){
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=auth?process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY:process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!url||!key)throw new BillingError(503,'billing_configuration_missing');
 const parsed=new URL(url);if(parsed.protocol!=='https:'||!parsed.hostname.endsWith('.supabase.co')||parsed.username||parsed.password||parsed.port)throw new BillingError(503,'billing_configuration_invalid');
 return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false},global:{headers:auth?{Authorization:auth}:{},fetch:(input,init)=>fetch(input,{...init,cache:'no-store',signal:AbortSignal.timeout(20000)})}});
}
export async function billingUser(req:Request){
 const auth=req.headers.get('authorization')??'';if(!/^Bearer [A-Za-z0-9._-]{20,8192}$/.test(auth))throw new BillingError(401,'authentication_required');
 const origin=req.headers.get('origin');if(origin&&origin!==new URL(req.url).origin)throw new BillingError(403,'origin_not_allowed');
 const db=billingDb(auth),{data,error}=await db.auth.getUser();if(error||!data.user)throw new BillingError(401,'invalid_session');
 // SQL checks MFA and auth.uid() on every operation, including paid access.
 return {db,user:data.user};
}
export async function billingRpc(db:ReturnType<typeof billingDb>,name:string,args:Record<string,unknown>={}){
 const {data,error}=await db.rpc(name,args);if(error){const status=/^PT\d{3}$/.test(error.code)?Number(error.code.slice(2)):503;throw new BillingError(status,/^[a-z0-9_]{1,80}$/.test(error.message)?error.message:'billing_database_unavailable');}return data;
}
export async function lemon(path:string,init:RequestInit={}){
 const {key}=billingConfig();const response=await fetch(`https://api.lemonsqueezy.com/v1/${path}`,{...init,headers:{Accept:'application/vnd.api+json','Content-Type':'application/vnd.api+json',Authorization:`Bearer ${key}`},cache:'no-store',signal:AbortSignal.timeout(20000)});
 if(!response.ok)throw new BillingError(502,'payment_provider_unavailable');return response.json();
}
export async function boundedBody(req:Request,max=131072){
 const reader=req.body?.getReader(),parts:Uint8Array[]=[];let size=0;if(reader)while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>max){await reader.cancel();throw new BillingError(413,'body_too_large');}parts.push(value);}return Buffer.concat(parts);
}
export function validSignature(raw:Uint8Array,signature:string,secret:string){return /^[a-f0-9]{64}$/i.test(signature)&&timingSafeEqual(createHmac('sha256',secret).update(raw).digest(),Buffer.from(signature,'hex'));}
export function checkoutUrl(value:string){const u=new URL(value);if(u.protocol!=='https:'||!u.hostname.endsWith('.lemonsqueezy.com')||u.username||u.password||u.port||!u.pathname.startsWith('/checkout/'))throw new BillingError(502,'invalid_checkout_url');return u.toString();}
export const statusSchema=z.object({active:z.boolean(),expires_at:z.string().nullable(),test_active:z.boolean(),test_expires_at:z.string().nullable()});
export const checkoutSchema=z.object({id:z.string().uuid(),url:z.string().nullable(),create:z.boolean()});
export const orderSchema=z.object({data:z.object({type:z.literal('orders'),id:z.string().regex(/^\d+$/),attributes:z.object({store_id:z.number().int(),currency:z.string(),subtotal:z.number().int(),discount_total:z.number().int(),status:z.enum(['pending','failed','paid','refunded','partial_refund','fraudulent']),refunded:z.boolean(),test_mode:z.boolean(),created_at:z.string().datetime({offset:true}),first_order_item:z.object({id:z.number().int().positive(),variant_id:z.number().int(),price:z.number().int()})})})});
export function verifyOrder(raw:unknown,c:ReturnType<typeof billingConfig>,expectedId:string,itemRaw:unknown){
 const parsed=orderSchema.safeParse(raw);if(!parsed.success)throw new BillingError(422,'invalid_provider_order');const o=parsed.data.data,a=o.attributes;
 const item=z.object({data:z.object({type:z.literal('order-items'),id:z.string(),attributes:z.object({order_id:z.number().int(),variant_id:z.number().int(),price:z.number().int(),quantity:z.literal(1)})})}).safeParse(itemRaw);if(!item.success||item.data.data.id!==String(a.first_order_item.id)||String(item.data.data.attributes.order_id)!==expectedId||String(item.data.data.attributes.variant_id)!==c.variant||item.data.data.attributes.price!==c.amount)throw new BillingError(422,'payment_item_mismatch');
 if(o.id!==expectedId||String(a.store_id)!==c.store||String(a.first_order_item.variant_id)!==c.variant||a.test_mode!==c.test||a.currency!==c.currency||a.subtotal!==c.amount||a.discount_total!==0||a.first_order_item.price!==c.amount)throw new BillingError(422,'payment_order_mismatch');
 if(!['paid','refunded','partial_refund'].includes(a.status))throw new BillingError(409,'payment_not_settled');
 return {provider_id:o.id,test:a.test_mode,paid_at:a.created_at,refunded:a.refunded||a.status==='refunded'||a.status==='partial_refund'};
}
export const webhookSchema=z.object({meta:z.object({event_name:z.string(),custom_data:z.object({order_id:z.string().uuid()}).optional()}),data:z.object({type:z.literal('orders'),id:z.string().regex(/^\d+$/)})});
export const eventHash=(raw:Uint8Array)=>createHash('sha256').update(raw).digest('hex');
