// @vitest-environment node
import {createHmac} from 'node:crypto';
import {afterEach,describe,it,expect,vi} from 'vitest';
import {validSignature,verifyOrder,checkoutUrl,boundedBody,billingConfig} from '../src/server/billing';
import {POST as webhook} from '../src/app/api/billing/webhook/route';
import {GET as exportData,csvCell} from '../src/app/api/billing/export/route';
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
const c={key:'test',secret:'a-long-test-secret',store:'1',variant:'2',amount:1900,currency:'USD',test:true};
const item={data:{type:'order-items',id:'9',attributes:{order_id:8,variant_id:2,price:1900,quantity:1}}};
const order=()=>({data:{type:'orders',id:'8',attributes:{store_id:1,currency:'USD',subtotal:1900,discount_total:0,status:'paid',refunded:false,test_mode:true,created_at:'2026-10-30T00:00:00Z',first_order_item:{id:9,variant_id:2,price:1900}}}});
describe('payment trust boundaries',()=>{
 it('authenticates exact raw bytes and rejects altered, malformed and wrong-key signatures',()=>{const raw=Buffer.from('{"ok":true}'),signature=createHmac('sha256',c.secret).update(raw).digest('hex');expect(validSignature(raw,signature,c.secret)).toBe(true);expect(validSignature(Buffer.from('{"ok":false}'),signature,c.secret)).toBe(false);expect(validSignature(raw,'bad',c.secret)).toBe(false);expect(validSignature(raw,signature,'other')).toBe(false);});
 it('verifies provider identity, mode, price, quantity and settled state',()=>{expect(verifyOrder(order(),c,'8',item).refunded).toBe(false);for(const change of [{store_id:9},{currency:'KRW'},{subtotal:1},{discount_total:1},{test_mode:false},{status:'pending'},{first_order_item:{id:9,variant_id:3,price:1900}},{first_order_item:{id:9,variant_id:2,price:1}}]){const o=order();Object.assign(o.data.attributes,change);expect(()=>verifyOrder(o,c,'8',item)).toThrow();}expect(()=>verifyOrder(order(),c,'9',item)).toThrow();const refund=order();refund.data.attributes.status='partial_refund';expect(verifyOrder(refund,c,'8',item).refunded).toBe(true);});
 it('accepts only hosted checkout URLs',()=>{expect(checkoutUrl('https://example.lemonsqueezy.com/checkout/custom/id')).toContain('/checkout/');for(const url of ['https://evil.com/checkout/x','https://lemonsqueezy.com.evil.com/checkout/x','javascript:alert(1)','https://user:pass@example.lemonsqueezy.com/checkout/x'])expect(()=>checkoutUrl(url)).toThrow();});
 it('fails closed with no merchant config and blocks unsigned webhooks before transport',async()=>{vi.stubEnv('LEMONSQUEEZY_MODE','disabled');expect(()=>billingConfig()).toThrow();expect((await webhook(new Request('https://signalbrief.online/api/billing/webhook',{method:'POST',body:'{}'}))).status).toBe(503);vi.stubEnv('LEMONSQUEEZY_MODE','live');vi.stubEnv('LEMONSQUEEZY_LIVE_APPROVED','false');expect(()=>billingConfig()).toThrow('merchant_approval_required');});
 it('never grants access to export without authentication',async()=>{const spy=vi.fn();vi.stubGlobal('fetch',spy);expect((await exportData(new Request('https://signalbrief.online/api/billing/export'))).status).toBe(401);expect(spy).not.toHaveBeenCalled();});
 it('bounds webhook payloads and neutralizes spreadsheet formulas',async()=>{await expect(boundedBody(new Request('https://example.com',{method:'POST',body:'0123456789'}),5)).rejects.toThrow('body_too_large');expect(csvCell('=HYPERLINK("x")')).toBe('"\'=HYPERLINK(""x"")"');expect(csvCell('normal')).toBe('"normal"');});
});
