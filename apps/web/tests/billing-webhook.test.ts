// @vitest-environment node
import {createHmac} from 'node:crypto';
import {afterEach,it,expect,vi} from 'vitest';
const mocks=vi.hoisted(()=>({rpc:vi.fn(),lemon:vi.fn(),db:vi.fn(()=>({}))}));
vi.mock('../src/server/billing',async()=>{const actual=await vi.importActual<typeof import('../src/server/billing')>('../src/server/billing');return {...actual,billingDb:mocks.db,billingRpc:mocks.rpc,lemon:mocks.lemon};});
import {POST} from '../src/app/api/billing/webhook/route';
const secret='test-webhook-secret-long-enough',id='10000000-0000-4000-8000-000000000001';
const item={data:{type:'order-items',id:'9',attributes:{order_id:8,variant_id:2,price:1900,quantity:1}}};
function setup(){for(const [key,value] of Object.entries({LEMONSQUEEZY_MODE:'test',LEMONSQUEEZY_API_KEY:'synthetic-key',LEMONSQUEEZY_WEBHOOK_SECRET:secret,LEMONSQUEEZY_STORE_ID:'1',LEMONSQUEEZY_VARIANT_ID:'2',LEMONSQUEEZY_PASS_AMOUNT:'1900',LEMONSQUEEZY_PASS_CURRENCY:'USD',SUPABASE_SERVICE_ROLE_KEY:'synthetic-key'}))vi.stubEnv(key,value);}
function payload(event='order_created'){return JSON.stringify({meta:{event_name:event,custom_data:{order_id:id}},data:{type:'orders',id:'8'}});}
function req(body:string,signature=createHmac('sha256',secret).update(body).digest('hex')){return new Request('https://signalbrief.online/api/billing/webhook',{method:'POST',body,headers:{'x-signature':signature}});}
const provider=()=>({data:{type:'orders',id:'8',attributes:{store_id:1,currency:'USD',subtotal:1900,discount_total:0,status:'paid',refunded:false,test_mode:true,created_at:'2026-10-30T00:00:00Z',first_order_item:{id:9,variant_id:2,price:1900}}}});
afterEach(()=>{vi.unstubAllEnvs();vi.clearAllMocks();});
it('does not call the provider or DB for unsigned events',async()=>{setup();expect((await POST(req(payload(),'bad'))).status).toBe(401);expect(mocks.lemon).not.toHaveBeenCalled();expect(mocks.rpc).not.toHaveBeenCalled();});
it('re-fetches the provider order before atomically recording a signed event',async()=>{setup();mocks.lemon.mockImplementation(async(path:string)=>path.startsWith('order-items/')?item:provider());mocks.rpc.mockResolvedValue(null);expect((await POST(req(payload()))).status).toBe(200);expect(mocks.lemon).toHaveBeenCalledWith('orders/8');expect(mocks.rpc).toHaveBeenCalledWith({},'sb_payment_record',expect.objectContaining({oid:id,provider_id:'8',test:true,refunded:false}));});
it('rejects a signed event when provider status or mode disagrees',async()=>{setup();const order=provider();order.data.attributes.test_mode=false;mocks.lemon.mockImplementation(async(path:string)=>path.startsWith('order-items/')?item:order);expect((await POST(req(payload()))).status).toBe(422);expect(mocks.rpc).not.toHaveBeenCalled();});
it('does not accept a refund until the provider confirms it',async()=>{setup();mocks.lemon.mockImplementation(async(path:string)=>path.startsWith('order-items/')?item:provider());expect((await POST(req(payload('order_refunded')))).status).toBe(409);expect(mocks.rpc).not.toHaveBeenCalled();const order=provider();order.data.attributes.status='refunded';order.data.attributes.refunded=true;mocks.lemon.mockImplementation(async(path:string)=>path.startsWith('order-items/')?item:order);expect((await POST(req(payload('order_refunded')))).status).toBe(200);expect(mocks.rpc).toHaveBeenCalledWith({},'sb_payment_record',expect.objectContaining({refunded:true}));});
