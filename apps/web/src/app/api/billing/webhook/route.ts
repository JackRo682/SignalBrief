import {billingConfig,billingDb,billingFailure,billingHeaders,billingRpc,boundedBody,eventHash,lemon,validSignature,verifyOrder,orderSchema,webhookSchema,BillingError} from '@/server/billing';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function POST(req:Request){try{
 const c=billingConfig(),raw=await boundedBody(req);if(!validSignature(raw,req.headers.get('x-signature')??'',c.secret))throw new BillingError(401,'invalid_webhook_signature');
 let body:unknown;try{body=JSON.parse(raw.toString('utf8'));}catch{throw new BillingError(422,'invalid_json');}
 const parsed=webhookSchema.safeParse(body);if(!parsed.success)throw new BillingError(422,'invalid_webhook');const event=parsed.data;
 if(!['order_created','order_refunded'].includes(event.meta.event_name))return Response.json({ignored:true},{headers:billingHeaders});
 const source=orderSchema.safeParse(await lemon(`orders/${event.data.id}`));if(!source.success)throw new BillingError(422,'invalid_provider_order');
 const order=verifyOrder(source.data,c,event.data.id,await lemon(`order-items/${source.data.data.attributes.first_order_item.id}`));
 if(event.meta.event_name==='order_refunded'&&!order.refunded)throw new BillingError(409,'refund_not_confirmed');
 // Refund retries may omit custom data: a previously bound provider ID resolves it.
 await billingRpc(billingDb(),'sb_payment_record',{oid:event.meta.custom_data?.order_id??null,event_hash:eventHash(raw),...order});
 return Response.json({received:true},{headers:billingHeaders});
 }catch(error){return billingFailure(error);}}
