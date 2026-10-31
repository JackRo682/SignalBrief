import {billingConfig,billingDb,billingFailure,billingHeaders,billingRpc,billingUser,checkoutSchema,checkoutUrl,lemon,BillingError} from '@/server/billing';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function POST(req:Request){try{
 const c=billingConfig(),{db}=await billingUser(req);
 if(Number(req.headers.get('content-length')??0)>1024)throw new BillingError(413,'body_too_large');
 const order=checkoutSchema.parse(await billingRpc(db,'sb_checkout_reserve',{is_test:c.test}));
 if(!order.create){if(!order.url)throw new BillingError(409,'checkout_creation_pending');return Response.json({url:checkoutUrl(order.url),test:c.test},{headers:billingHeaders});}
 const variant=await lemon(`variants/${c.variant}`);
 if(variant?.data?.type!=='variants'||String(variant.data.id)!==c.variant||variant.data.attributes?.is_subscription!==false||variant.data.attributes?.price!==c.amount||variant.data.attributes?.pay_what_you_want!==false)throw new BillingError(503,'pass_product_configuration_invalid');
 // Reserve once in PostgreSQL before calling the provider. A timeout stays pending
 // until expiry, so retries never create another checkout for the same reservation.
 const result=await lemon('checkouts',{method:'POST',body:JSON.stringify({data:{type:'checkouts',attributes:{test_mode:c.test,expires_at:new Date(Date.now()+15*60000).toISOString(),product_options:{enabled_variants:[Number(c.variant)],redirect_url:'https://signalbrief.online/billing?returned=1'},checkout_options:{embed:false,discount:false},checkout_data:{custom:{order_id:order.id},variant_quantities:[{variant_id:Number(c.variant),quantity:1}]}},relationships:{store:{data:{type:'stores',id:c.store}},variant:{data:{type:'variants',id:c.variant}}}}})});
 if(result?.data?.type!=='checkouts'||result.data.attributes?.test_mode!==c.test||String(result.data.attributes?.store_id)!==c.store||String(result.data.attributes?.variant_id)!==c.variant)throw new BillingError(502,'checkout_identity_mismatch');
 const url=checkoutUrl(result?.data?.attributes?.url??'');await billingRpc(billingDb(),'sb_checkout_publish',{oid:order.id,checkout_url:url});return Response.json({url,test:c.test},{headers:billingHeaders});
 }catch(error){return billingFailure(error);}}
