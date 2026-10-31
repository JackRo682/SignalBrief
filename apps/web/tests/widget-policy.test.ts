// @vitest-environment node
import {it,expect} from 'vitest';
import config from '../next.config';
it('explicitly permits the four supported widget scripts without a wildcard vendor grant',async()=>{
 const rules=await config.headers!(),policy=rules[0].headers.find(header=>header.key==='Content-Security-Policy')!.value;
 for(const name of ['timeline','symbol-overview','symbol-profile','financials'])expect(policy).toContain(`https://s3.tradingview.com/external-embedding/embed-widget-${name}.js`);
 expect(policy).not.toContain('https://s3.tradingview.com *');expect(policy).toContain("frame-ancestors 'none'");expect(policy).toContain("object-src 'none'");
});
