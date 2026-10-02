import { z } from "zod";
import { SETUP_REQUIRED } from "./auth-policy";
export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? (process.env.NODE_ENV === "production" ? "" : "http://localhost:8000")).replace(/\/$/, "");
export class APIError extends Error {
  constructor(public status:number, public code:string, public requestId:string|null = null) { super(code); this.name="APIError"; }
}
export function errorMessage(error:unknown):string {
  if (error instanceof APIError) {
    if (error.status===401) return "로그인이 만료되었습니다. 다시 로그인해 주세요.";
    if (error.status===403) return "이 작업에 접근할 권한이 없습니다.";
    if (error.status===429) return "요청이 많습니다. 잠시 후 다시 시도해 주세요.";
    return `요청을 처리하지 못했습니다 (${error.code})${error.requestId ? ` · 요청 ID ${error.requestId}` : ""}`;
  }
  if (error instanceof z.ZodError) return "서버 응답 형식이 예상과 다릅니다. 운영자에게 문의해 주세요.";
  if (error instanceof Error && error.name==="AbortError") return "요청 시간이 초과되었거나 취소되었습니다.";
  return "서버에 연결하지 못했습니다. API 서버 주소와 실행 상태를 확인해 주세요.";
}
export async function request<T>(path:string, token:string|null, schema:z.ZodType<T>, init:RequestInit = {}, timeout=45000):Promise<T> {
  if (!API_URL) throw new Error(SETUP_REQUIRED);
  if (!path.startsWith("/") || path.startsWith("//")) throw new Error("relative_api_path_required");
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  const timer = setTimeout(onAbort, timeout);
  init.signal?.addEventListener("abort", onAbort, {once:true});
  if (init.signal?.aborted) controller.abort();
  try {
    const response = await fetch(API_URL+path, {...init, cache:"no-store", credentials:"omit", signal:controller.signal,
      headers: {...(init.body ? {"Content-Type":"application/json"} : {}), ...(token ? {Authorization:`Bearer ${token}`} : {}), ...init.headers}});
    const data:unknown = response.status===204 ? undefined : await response.json().catch(() => null);
    if (!response.ok) {
      const payload = data && typeof data==="object" ? data as Record<string,unknown> : {};
      const detail = payload.error && typeof payload.error==="object" ? payload.error as Record<string,unknown> : {};
      if (response.status===401 && typeof window!=="undefined") window.dispatchEvent(new Event("signalbrief:unauthorized"));
      throw new APIError(response.status, String(detail.code ?? payload.detail ?? `http_${response.status}`), response.headers.get("x-request-id"));
    }
    return schema.parse(data);
  } finally { clearTimeout(timer); init.signal?.removeEventListener("abort",onAbort); }
}
export const emptySchema = z.undefined();
export function body(method:string, value?:unknown):RequestInit { return {method,...(value!==undefined ? {body:JSON.stringify(value)} : {})}; }
export function externalUrl(value:string):string|undefined {
  try {const url = new URL(value);return url.protocol==="https:" && !url.username && !url.password && !url.hostname.endsWith(".invalid") ? url.href : undefined;}
  catch {return undefined;}
}
