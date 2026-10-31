import {z} from 'zod';
import {newsResponse, newsQuery, type NewsResponse} from './news-contract';

const providerResponse = z.object({items: z.array(z.object({
  title: z.string().min(1).max(5000), link: z.string().url(),
  originallink: z.string(), pubDate: z.string(),
})).max(10)});

// Render the provider's highlighting/character references as plain text; never execute HTML.
export function headlineText(value: string) {
  const entities: Record<string,string> = {quot:'"', apos:"'", amp:'&', lt:'<', gt:'>', nbsp:' '};
  return value.replace(/<\/?b>/gi, '').replace(/&(#x[\da-f]+|#\d+|quot|apos|amp|lt|gt|nbsp);/gi, (match, key:string) => {
    if (!key.startsWith('#')) return entities[key.toLowerCase()] ?? match;
    const code = key[1].toLowerCase() === 'x' ? parseInt(key.slice(2),16) : Number(key.slice(1));
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : match;
  });
}

export class NewsError extends Error {
  constructor(public status:number, public code:string) {super(code);}
}

export async function loadNaverNews(query: z.infer<typeof newsQuery>): Promise<NewsResponse> {
  if(!newsQuery.safeParse(query).success)throw new NewsError(400,'invalid_news_query');
  const id = process.env.NAVER_NEWS_CLIENT_ID, secret = process.env.NAVER_NEWS_CLIENT_SECRET;
  if (!id || !secret) throw new NewsError(503,'news_not_configured');
  const url = new URL('https://naverapihub.apigw.ntruss.com/search/v1/news');
  url.search = new URLSearchParams({query, display:'10', start:'1', sort:'date'}).toString();
  try {
    const response = await fetch(url, {headers:{'X-NCP-APIGW-API-KEY-ID':id,'X-NCP-APIGW-API-KEY':secret},
      cache:'no-store', redirect:'error', signal:AbortSignal.timeout(10000)});
    if (response.status === 429) throw new NewsError(429,'news_quota_reached');
    if (!response.ok) throw new NewsError(502,'news_provider_unavailable');
    const raw = providerResponse.parse(await response.json());
    // Keep provider order and links. No database, persistent cache, AI ingestion, or article fetching.
    return newsResponse.parse({provider:'NAVER', query, retrievedAt:new Date().toISOString(),
      items:raw.items.map(item=>({title:headlineText(item.title),link:item.link,
        originalLink:item.originallink || null, publishedAt:new Date(item.pubDate).toISOString()}))});
  } catch(error) {
    if (error instanceof NewsError) throw error;
    throw new NewsError(502,'news_provider_unavailable');
  }
}
