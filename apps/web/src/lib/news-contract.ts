import {z} from 'zod';

export const newsTopics = ['증시', '삼성전자', 'SK하이닉스', '현대자동차', '네이버', '카카오', 'LG에너지솔루션'] as const;
export const newsTopic = z.enum(newsTopics);
const sourceUrl = z.string().url().refine(value => {
  const url = new URL(value);
  return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
});
export const newsResponse = z.object({
  provider: z.literal('NAVER'), query: newsTopic, retrievedAt: z.string().datetime(),
  items: z.array(z.object({title: z.string(), link: sourceUrl, originalLink: sourceUrl.nullable(),
    publishedAt: z.string().datetime()})).max(10),
});
export type NewsResponse = z.infer<typeof newsResponse>;
