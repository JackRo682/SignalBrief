// @vitest-environment node
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {headlineText,loadNaverNews} from '../src/lib/naver-news';
const item={title:'<b>합성</b> &quot;뉴스&quot;',link:'https://n.news.naver.com/article/000/000',originallink:'https://example.com/synthetic',pubDate:'Sun, 18 Oct 2026 12:00:00 +0900'};
beforeEach(()=>{vi.stubEnv('NAVER_NEWS_CLIENT_ID','synthetic-id');vi.stubEnv('NAVER_NEWS_CLIENT_SECRET','synthetic-secret');});
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();vi.resetModules();});
describe('NAVER provider boundary',()=>{
  it('uses HUB server headers and no cache; preserves provider order, source and time',async()=>{
    const fn=vi.fn().mockResolvedValue(Response.json({items:[item,{...item,title:'두번째'}]}));vi.stubGlobal('fetch',fn);
    const data=await loadNaverNews('삼성전자');
    expect(data.items.map(x=>x.title)).toEqual(['합성 "뉴스"','두번째']);
    expect(data.items[0]).toMatchObject({originalLink:item.originallink,publishedAt:'2026-10-18T03:00:00.000Z'});
    const [url,options]=fn.mock.calls[0];
    expect(url.origin+url.pathname).toBe('https://naverapihub.apigw.ntruss.com/search/v1/news');
    expect(url.searchParams.get('query')).toBe('삼성전자');
    expect(options).toMatchObject({cache:'no-store',redirect:'error',headers:{'X-NCP-APIGW-API-KEY':'synthetic-secret'}});
    expect(JSON.stringify(data)).not.toContain('synthetic-secret');
  });
  it('refuses missing keys before making a request',async()=>{
    vi.stubEnv('NAVER_NEWS_CLIENT_SECRET','');const fn=vi.fn();vi.stubGlobal('fetch',fn);
    await expect(loadNaverNews('증시')).rejects.toMatchObject({status:503});expect(fn).not.toHaveBeenCalled();
  });
  it.each([['javascript:alert(1)',item.pubDate],[item.link,'invalid date']])('rejects unsafe links and invalid dates',async(link,pubDate)=>{
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json({items:[{...item,link,pubDate}]})));
    await expect(loadNaverNews('증시')).rejects.toMatchObject({status:502,code:'news_provider_unavailable'});
  });
  it.each([401,429,500])('does not disclose provider error bodies (%i)',async(status)=>{
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json({message:'synthetic-secret'},{status})));
    await expect(loadNaverNews('증시')).rejects.toMatchObject({status:status===429?429:502});
  });
  it('decodes highlighting and character references once',()=>{
    expect(headlineText('&#xD55C;&#44397; &amp;lt; &lt;img&gt;')).toBe('한국 &lt; <img>');
  });
});
describe('public search route',()=>{
  it('rejects arbitrary queries and cross-site use without calling provider',async()=>{
    const fn=vi.fn();vi.stubGlobal('fetch',fn);const {GET}=await import('../src/app/api/news/route');
    for(const query of ['q=private-input','q=증시&q=삼성전자','q=증시&url=https://example.com']) expect((await GET(new Request(`https://example.com/api/news?${query}`))).status).toBe(400);
    expect((await GET(new Request('https://example.com/api/news?q=증시',{headers:{'sec-fetch-site':'cross-site'}}))).status).toBe(403);expect(fn).not.toHaveBeenCalled();
  });
  it('never caches responses and caps instance bursts',async()=>{
    const fn=vi.fn().mockImplementation(async()=>Response.json({items:[]}));vi.stubGlobal('fetch',fn);const {GET}=await import('../src/app/api/news/route');
    for(let i=0;i<30;i++) {const r=await GET(new Request('https://example.com/api/news?q=증시'));expect(r.status).toBe(200);expect(r.headers.get('cache-control')).toBe('no-store');}
    expect((await GET(new Request('https://example.com/api/news?q=증시'))).status).toBe(429);expect(fn).toHaveBeenCalledTimes(30);
  });
});

