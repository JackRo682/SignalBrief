import { describe,it,expect } from 'vitest';
import { escapeHTML,safeURL,koreaDate,monthCells,sparkline,parsePortfolioCSV,portfolioCSV } from '../src/reference/controller';
import { templates } from '../src/reference/templates';
describe('user supplied presentation integration',()=>{
 it('contains exactly ten original presentation screens',()=>expect(Object.keys(templates).sort()).toEqual(['alerts','calendar','chat','detail','landing','onboarding','ops','setup','timeline','today']));
 it.each(Object.entries(templates))('%s contains no original executable browser/server code',(_,html)=>{expect(html).not.toMatch(/<script\b|node:http|SUPABASE_SERVICE_ROLE_KEY|sbWrite\(/);expect(html).not.toContain('김지훈님');});
 it('keeps the combined watchlist and portfolio layout',()=>{expect(templates.setup).toContain('id="holdings"');expect(templates.setup).toContain('id="selected"');expect(templates.setup).toContain('grid-template-columns:1fr 1fr');});
 it('keeps the six analysis-box target and evidence pane',()=>{expect(templates.detail).toContain('id="analysisGrid"');expect(templates.detail).toContain('id="evidenceTabs"');});
});
describe('safe dynamic rendering',()=>{
 it('escapes HTML, attributes and nested strings',()=>expect(escapeHTML('<img src=x onerror="alert(1)"> & \'')).toBe('&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; &#39;'));
 it.each(['javascript:alert(1)','data:text/html,<script>','http://example.com','https://user:pass@example.com','not-a-url','https://example.invalid'])('rejects dangerous or synthetic links: %s',x=>expect(safeURL(x)).toBeNull());
 it('allows HTTPS source links',()=>expect(safeURL('https://example.com/report?a=1')).toBe('https://example.com/report?a=1'));
 it('does not make a price graph out of missing data',()=>expect(sparkline([])).toContain('시세 데이터 미연결'));
 it('avoids division by zero on a one-point series',()=>{expect(sparkline([1])).not.toMatch(/NaN|Infinity/);expect(sparkline([1])).toContain('미연결');});
 it('renders flat supplied prices safely',()=>{expect(sparkline([2,2,2])).toContain('polyline');expect(sparkline([2,2,2])).not.toContain('NaN');});
});
describe('timezone-correct calendar',()=>{
 it('uses Korean civil date across the UTC boundary',()=>{expect(koreaDate(Date.parse('2026-10-02T15:00:00Z'))).toBe('2026-10-03');expect(koreaDate(Date.parse('2026-10-02T14:59:59Z'))).toBe('2026-10-02');});
 it('starts weeks on Sunday as in the supplied screenshot',()=>expect(monthCells(2026,9)[0].date).toBe('2026-09-27'));
 it('supports leap days and 42 unique cells',()=>{const cells=monthCells(2024,1);expect(cells).toHaveLength(42);expect(cells.filter(c=>c.current)).toHaveLength(29);expect(new Set(cells.map(c=>c.date)).size).toBe(42);});
});
describe('CSV holds decimal input as strings',()=>{
 it('round trips precision and zero-prefixed tickers',()=>{const p={ticker:'005930',quantity:'12.12345678',average_cost:'99.50000001',currency:'KRW'};expect(parsePortfolioCSV(portfolioCSV([p]))[0]).toEqual(p);});
 it('accepts the source bundle symbol/avg_price headings',()=>{expect(parsePortfolioCSV('symbol,quantity,avg_price,currency\nAAPL,10.25,,USD')[0]).toEqual({ticker:'AAPL',quantity:'10.25',average_cost:null,currency:'USD'});});
 it.each(['NaN','-1','0','1e3','Infinity','1.000000001'])('rejects invalid quantity %s',v=>expect(()=>parsePortfolioCSV(`ticker,quantity,average_cost,currency\nAAPL,${v},,USD`)).toThrow());
 it('rejects duplicate companies before network mutation',()=>expect(()=>parsePortfolioCSV('ticker,quantity,average_cost,currency\nAAPL,1,,USD\nAAPL,2,,USD')).toThrow());
 it('handles quoted fields',()=>expect(parsePortfolioCSV('ticker,quantity,average_cost,currency\r\n"AAPL","1.1","10.50","USD"')[0].quantity).toBe('1.1'));
 it('rejects invalid quote closure',()=>expect(()=>parsePortfolioCSV('ticker,quantity,average_cost\n"AAPL,1,2')).toThrow());
 it('bounds UTF-8 upload size',()=>expect(()=>parsePortfolioCSV('가'.repeat(50000))).toThrow());
 it('enforces maximum position count',()=>expect(()=>parsePortfolioCSV('ticker,quantity,average_cost\n'+Array.from({length:201},(_,i)=>`T${i},1,2`).join('\n'))).toThrow());
 it('neutralizes formula-like CSV cells',()=>expect(portfolioCSV([{ticker:'=1+1',quantity:'1',average_cost:'',currency:'USD'}])).toContain('"\'=1+1"'));
});
