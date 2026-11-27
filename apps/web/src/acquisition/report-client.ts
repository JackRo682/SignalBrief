import {z} from 'zod';

export class TrafficReportError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
export async function fetchTrafficReport<T>(token: string, payload: unknown, schema: z.ZodType<T>, signal: AbortSignal): Promise<T> {
  const response = await fetch('/api/traffic', {
    method: 'POST', headers: {'Content-Type': 'application/json', Authorization: `Bearer ${token}`},
    body: JSON.stringify(payload), signal: AbortSignal.any([signal, AbortSignal.timeout(12000)]), cache: 'no-store', credentials: 'omit', redirect: 'error',
  });
  if (!response.ok) throw new TrafficReportError(response.status,
    response.status === 401 ? '로그인이 만료되었습니다. 다시 로그인해 주세요.'
      : response.status === 403 ? '관리자 권한 또는 추가 인증을 확인해 주세요.'
        : response.status === 429 ? '조회가 집중되었습니다. 잠시 후 다시 시도해 주세요.' : '방문 통계를 불러오지 못했습니다. 다시 조회해 주세요.');
  const parsed = schema.safeParse(await response.json());
  if (!parsed.success) throw new TrafficReportError(502, '방문 통계 응답을 확인하지 못했습니다. 다시 조회해 주세요.');
  return parsed.data;
}
