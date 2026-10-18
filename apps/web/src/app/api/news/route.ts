import {newsTopic} from '@/lib/news-contract';
import {loadNaverNews, NewsError} from '@/lib/naver-news';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = {'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff', 'Referrer-Policy':'no-referrer'};
// Best-effort instance burst guard; provider's daily/monthly quota remains authoritative.
let windowStart = 0, requests = 0;
export async function GET(request:Request) {
  const url = new URL(request.url);
  const fail = (status:number, code:string) => Response.json({error:{code}}, {status, headers});
  if (request.headers.get('sec-fetch-site') === 'cross-site' ||
    (request.headers.get('origin') && request.headers.get('origin') !== url.origin)) return fail(403,'origin_not_allowed');
  const query = newsTopic.safeParse(url.searchParams.get('q'));
  if (!query.success || [...url.searchParams.keys()].some(key=>key !== 'q') || url.searchParams.getAll('q').length !== 1) return fail(400,'invalid_news_query');
  if (Date.now()-windowStart >= 60000) {windowStart=Date.now(); requests=0;}
  if (++requests > 30) return fail(429,'news_rate_limited');
  try {return Response.json(await loadNaverNews(query.data), {headers});}
  catch(error) {return error instanceof NewsError ? fail(error.status,error.code) : fail(502,'news_provider_unavailable');}
}
