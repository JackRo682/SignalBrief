import {z} from 'zod';

export const newsTopics = ['증시', '삼성전자', 'SK하이닉스', '현대자동차', '네이버', '카카오', 'LG에너지솔루션'] as const;
export const newsTopic = z.enum(newsTopics);
export const companyNewsQueries = {AAPL:'애플 아이폰',MSFT:'마이크로소프트',NVDA:'엔비디아',TSLA:'테슬라',V:'비자 결제','005930':'삼성전자','000660':'SK하이닉스','005380':'현대자동차','035420':'네이버','035720':'카카오','006260':'LS 그룹',MU:'마이크론'} as const;
// Public q requests still use newsTopic. A company query is resolved on the server
// from an authenticated, identity-checked company record, never client search text.
export const newsQuery=z.string().min(1).max(160).regex(/^[\p{L}\p{N} &'’.()\/-]+$/u);
export function companyNewsQuery(ticker:string,name:string|null|undefined):string|null {
  const reviewed=companyNewsQueries[ticker.toUpperCase() as keyof typeof companyNewsQueries];
  if(reviewed)return reviewed;
  if(!name||name.length>240||/[\u0000-\u001f\u007f<>:]/.test(name))return null;
  const normalized=name.normalize('NFKC').replace(/[^\p{L}\p{N} &'’.()\/-]/gu,' ').replace(/\s+/g,' ').trim();
  const query=normalized.replace(/(?:,?\s+(?:incorporated|inc\.?|corporation|corp\.?|limited|ltd\.?|plc))$/i,'').trim();
  const parsed=newsQuery.safeParse(query);
  return parsed.success?parsed.data:null;
}
const sourceUrl = z.string().url().refine(value => {
  const url = new URL(value);
  return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
});
export const newsResponse = z.object({
  provider: z.literal('NAVER'), query: newsQuery, retrievedAt: z.string().datetime(),
  items: z.array(z.object({title: z.string(), link: sourceUrl, originalLink: sourceUrl.nullable(),
    publishedAt: z.string().datetime()})).max(10),
});
export type NewsResponse = z.infer<typeof newsResponse>;
