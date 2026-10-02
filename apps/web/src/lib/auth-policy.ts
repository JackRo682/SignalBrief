import type { RuntimeConfig } from "./contracts";

export const SETUP_REQUIRED = "서비스 연결 준비 중입니다. 실제 API와 Google 로그인 설정이 완료되지 않아 로그인과 데이터 조회를 사용할 수 없습니다.";
export function localDemoAllowed(hostname: string, production: boolean): boolean {
  return !production && ["localhost", "127.0.0.1", "[::1]"].includes(hostname);
}
export function assertRuntimeAuth(config: RuntimeConfig, hostname: string, production: boolean, api: string, supabase: string | undefined, key: string | undefined): void {
  if (localDemoAllowed(hostname, production) && config.demo_mode && config.auth_mode === "demo") return;
  let endpoint: URL;
  try { endpoint = new URL(api); } catch { throw new Error(SETUP_REQUIRED); }
  if (config.demo_mode || config.demo_admin_enabled || config.auth_mode !== "supabase" || endpoint.protocol !== "https:" || ["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname) || !supabase || !key) {
    throw new Error(SETUP_REQUIRED);
  }
}
