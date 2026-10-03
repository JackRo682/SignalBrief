// @vitest-environment node
import {describe,it,expect,vi} from 'vitest';
import {providerFetch,fmpQuote,fmpHistory,frankfurter,secSubmissions,validateFilingURL,normalizeFiling,validateAnalysis,websitePermission,gnewsSearch,sendVerifiedEmail,ProviderError,openaiSmoke} from '../../../supabase/functions/signalbrief-api/us-core';
const response=(v:unknown,status=200)=>vi.fn().mockResolvedValue(new Response(JSON.stringify(v),{status}));
describe('server provider boundaries',()=>{
 it.each(['http://data.sec.gov/a','https://untrusted.example/a','https://secret@data.sec.gov/a','https://data.sec.gov:8443/a'])('rejects %s before networking',async url=>{const f=vi.fn();await expect(providerFetch(new URL(url),'sec',{},f)).rejects.toThrow('invalid_endpoint');expect(f).not.toHaveBeenCalled();});
 it('does not reflect provider errors or secret URLs',async()=>{const f=vi.fn().mockRejectedValue(new Error('key=SUPERSECRET'));await expect(providerFetch(new URL('https://financialmodelingprep.com/stable/quote?apikey=SUPERSECRET'),'fmp',{},f)).rejects.toThrow('fmp:network_or_timeout');});
 it('bounds chunked response bytes',async()=>{const f=vi.fn().mockResolvedValue(new Response('x'.repeat(201)));await expect(providerFetch(new URL('https://data.sec.gov/a'),'sec',{},f,200)).rejects.toThrow('response_too_large');});
 it('does not follow redirects',async()=>{const f=response({});await providerFetch(new URL('https://data.sec.gov/a'),'sec',{},f);expect(f.mock.calls[0][1].redirect).toBe('error');});
 it('redacts 401 response body',async()=>{try{await providerFetch(new URL('https://api.openai.com/v1/models'),'openai',{},response({error:'secret_key_echo'},401));throw new Error('expected');}catch(e){expect(e).toBeInstanceOf(ProviderError);expect(String(e)).toBe('Error: openai:invalid_key');}});
});
describe('entitlements',()=>{
 it.each([{}, {fmp_display_enabled:true}, {fmp_display_enabled:true,fmp_license_reference:'agreement',fmp_license_until:'2000-01-01'}])('requires more than a working key',config=>expect(websitePermission(config,'fmp')).toBe(false));
 it('accepts explicit unexpired rights',()=>expect(websitePermission({fmp_display_enabled:true,fmp_license_reference:'signed agreement',fmp_license_until:'2099-01-01'},'fmp')).toBe(true));
 it('never calls GNews with unverified deployed rights',async()=>{const f=vi.fn();await expect(gnewsSearch('Apple','private-key',{},f)).rejects.toThrow('deployed_plan_unverified');expect(f).not.toHaveBeenCalled();});
});
describe('financial observations',()=>{
 it('preserves a timestamped price rather than inventing history',async()=>{const time=Math.floor(Date.now()/1000);const q=await fmpQuote('AAPL','private',response([{symbol:'AAPL',price:123.45,timestamp:time,changePercentage:1.5}]));expect(q).toMatchObject({symbol:'AAPL',currency:'USD',history:[],price:123.45});expect(q.as_of).toBe(new Date(time*1000).toISOString());});
 it.each([{symbol:'AAPL',price:10},{symbol:'FAKE',price:10,timestamp:1},{symbol:'AAPL',price:-1,timestamp:1}])('rejects invalid quote %o',async value=>{await expect(fmpQuote('AAPL','private',response([value]))).rejects.toThrow();});
 it('does not reinterpret Korean symbols as US quotes',async()=>{const f=vi.fn();await expect(fmpQuote('005930','private',f)).rejects.toThrow('unsupported_us_symbol');expect(f).not.toHaveBeenCalled();});
 it('uses dated daily FX with provider attribution',async()=>{expect(await frankfurter('USD','KRW',response({base:'USD',quote:'KRW',rate:1300,date:'2026-01-01'}))).toMatchObject({kind:'daily_reference',not_live_trading:true,source:'Frankfurter'});});
 it('rejects mismatched FX currencies',async()=>{await expect(frankfurter('USD','KRW',response({base:'EUR',quote:'KRW',rate:1300,date:'2026-01-01'}))).rejects.toThrow('invalid_rate');});
 it('builds SEC archive URLs only from validated identifiers',async()=>{const f=response({cik:320193,name:'Apple',tickers:['AAPL'],filings:{recent:{accessionNumber:['0000320193-26-000001'],form:['10-Q'],filingDate:['2026-01-01'],reportDate:['2025-12-31'],primaryDocument:['aapl.htm']}}});const r=await secSubmissions('0000320193','contact@unit.test',f);expect(r.filings[0].document_url).toBe('https://www.sec.gov/Archives/edgar/data/320193/000032019326000001/aapl.htm');expect(f.mock.calls[0][1].headers['User-Agent']).toContain('contact@unit.test');});
 it('requires a contact before SEC collection',async()=>{const f=vi.fn();await expect(secSubmissions('0000320193','',f)).rejects.toThrow('contact_email_required');expect(f).not.toHaveBeenCalled();});
 it.each(['https://evil.test/a','https://www.sec.gov/Archives/edgar/data/1/../../private','https://www.sec.gov/Archives/edgar/data/1/000032019326000001/x.htm?redirect=evil'])('rejects filing URL %s',u=>expect(()=>validateFilingURL(u)).toThrow());
});
describe('evidence and outbound email',()=>{
 const source='Revenue was $100 million for the year ended December 31, 2025. The figure is in USD.';
 it('accepts exact cited evidence but still requires human review',()=>{expect(validateAnalysis({claims:[{text:'Revenue was $100 million.',quote:source}],uncertainty:'Excerpt only'},source)).toMatchObject({requires_human_review:true});});
 it('blocks invented figures',()=>expect(()=>validateAnalysis({claims:[{text:'Revenue was $999 million.',quote:source}]},source)).toThrow('numeric_citation_mismatch'));
 it('blocks unsupported quotes',()=>expect(()=>validateAnalysis({claims:[{text:'Revenue rose',quote:'This is not an original quote.'}]},source)).toThrow('citation_mismatch'));
 it('blocks investment advice',()=>expect(()=>validateAnalysis({claims:[{text:'Buy this stock',quote:source}]},source)).toThrow('investment_advice_blocked'));
 it('strips scripts and hidden XBRL headers from normalized excerpts',()=>expect(normalizeFiling('<script>STEAL KEY</script><ix:header>HIDDEN</ix:header><p>A &amp; B &#36;100</p>')).toBe('A & B $100'));
 it('does not send until sender domain is verified',async()=>{const f=vi.fn();await expect(sendVerifiedEmail('private','ops@example.com','test@example.com','Test','Test',[],f)).rejects.toThrow('verified_sender_required');expect(f).not.toHaveBeenCalled();});
 it('rejects header injection',async()=>{const f=vi.fn();await expect(sendVerifiedEmail('private','ops@example.com','test@example.com','Test\nBcc: attacker','Test',[{name:'example.com',status:'verified'}],f)).rejects.toThrow();expect(f).not.toHaveBeenCalled();});
 it('passes OpenAI keys only as server Authorization headers',async()=>{const f=response({model:'gpt-4.1-mini',choices:[{message:{content:'OK'}}],usage:{prompt_tokens:8,completion_tokens:1}});const r=await openaiSmoke('private',f);expect(JSON.stringify(r)).not.toContain('private');expect(f.mock.calls[0][1].headers.Authorization).toBe('Bearer private');expect(JSON.parse(f.mock.calls[0][1].body).store).toBe(false);});
 it('history never substitutes unsupported market data',async()=>{await expect(fmpHistory('AAPL','private',response({error:'Upgrade'}))).rejects.toThrow('invalid_history');});
});
