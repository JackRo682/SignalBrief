import {createClient} from '@supabase/supabase-js';
import {z} from 'zod';
import {newsTopic,companyNewsQueries,newsQuery} from '@/lib/news-contract';
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
  const companyId=url.searchParams.get('company_id');
  let selectedQuery:z.infer<typeof newsQuery>;
  if(companyId!==null){
    if(!z.string().uuid().safeParse(companyId).success||url.searchParams.getAll('company_id').length!==1||[...url.searchParams.keys()].some(key=>key!=='company_id'))return fail(400,'invalid_company_query');
    const auth=request.headers.get('authorization')??'';
    if(!/^Bearer [A-Za-z0-9._-]{20,8192}$/.test(auth))return fail(401,'authentication_required');
    const base=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if(!base||!key)return fail(503,'company_lookup_unavailable');
    try{
      const target=new URL(base);if(target.protocol!=='https:'||!target.hostname.endsWith('.supabase.co')||target.port||target.username||target.password)return fail(503,'company_lookup_unavailable');
      const db=createClient(base,key,{auth:{persistSession:false,autoRefreshToken:false},global:{headers:{Authorization:auth},fetch:(input,init)=>fetch(input,{...init,cache:'no-store',signal:AbortSignal.timeout(10000)})}});
      const user=await db.auth.getUser();if(user.error||!user.data.user)return fail(401,'invalid_or_expired_session');
      const response=await db.rpc('sb_workspace',{action:'resource',p:{kind:'company',id:companyId}});
      if(response.error){if(response.error.code==='PT403')return fail(403,'mfa_required');return fail(response.error.code==='PT404'?404:502,'company_lookup_failed');}
      const company=z.object({id:z.string().uuid(),kind:z.literal('company'),ticker:z.string()}).safeParse(response.data);
      if(!company.success||company.data.id!==companyId)return fail(404,'company_not_found');
      const query=companyNewsQueries[company.data.ticker.toUpperCase() as keyof typeof companyNewsQueries];
      if(!query)return fail(422,'company_news_not_supported');
      selectedQuery=query;
    }catch{return fail(502,'company_lookup_unavailable');}
  }else{
    const query = newsTopic.safeParse(url.searchParams.get('q'));
    if (!query.success || [...url.searchParams.keys()].some(key=>key !== 'q') || url.searchParams.getAll('q').length !== 1) return fail(400,'invalid_news_query');
    selectedQuery=query.data;
  }
  if (Date.now()-windowStart >= 60000) {windowStart=Date.now(); requests=0;}
  if (++requests > 30) return fail(429,'news_rate_limited');
  try {return Response.json(await loadNaverNews(selectedQuery), {headers});}
  catch(error) {return error instanceof NewsError ? fail(error.status,error.code) : fail(502,'news_provider_unavailable');}
}
