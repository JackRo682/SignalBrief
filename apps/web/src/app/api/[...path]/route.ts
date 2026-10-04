import type { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MAX_BODY = 131072;
const allowed = /^(?:v1\/(?:config|me|preferences|notification-settings|onboarding|companies|watchlist|portfolio|feed|events|questions|calendar|alerts|notifications|analytics|ops)(?:\/[a-zA-Z0-9_.-]+)*|health(?:\/ready)?)$/;
function error(status: number, code: string) {
  return Response.json({ error: { code } }, { status, headers: { "Cache-Control": "no-store" } });
}
async function proxy(req: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  const route = path.join("/");
  if (!allowed.test(route) || path.some(p => p === "." || p === "..")) return error(404, "route_not_found");
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!base || !key) return error(503, "supabase_configuration_missing");
  let upstream: URL;
  try { upstream = new URL(base); } catch { return error(503, "supabase_configuration_invalid"); }
  if (upstream.protocol !== "https:" || !upstream.hostname.endsWith(".supabase.co") || upstream.username || upstream.password) return error(503, "supabase_configuration_invalid");
  upstream.pathname = `/functions/v1/signalbrief-api/${route}`;
  upstream.search = req.nextUrl.search;
  const headers = new Headers({ apikey: key });
  const authorization = req.headers.get("authorization");
  const publicConfig = req.method === "GET" && route === "v1/config";
  if (authorization && !publicConfig) headers.set("Authorization", authorization);
  let payload: Uint8Array | undefined;
  if (!["GET", "HEAD"].includes(req.method)) {
    if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY) return error(413, "body_too_large");
    const reader = req.body?.getReader(); const chunks: Uint8Array[] = []; let total = 0;
    if (reader) while (true) { const { value, done } = await reader.read(); if (done) break; total += value.length; if (total > MAX_BODY) { await reader.cancel(); return error(413, "body_too_large"); } chunks.push(value); }
    if (total > 0 && !(req.headers.get("content-type") ?? "").startsWith("application/json")) return error(415, "json_required");
    payload = new Uint8Array(total); let offset = 0; for (const chunk of chunks) { payload.set(chunk, offset); offset += chunk.length; }
    headers.set("Content-Type", "application/json");
  }
  try {
    const response = await fetch(upstream, { method: req.method, headers, body: payload as BodyInit | undefined, redirect: "error", cache: publicConfig ? "force-cache" : "no-store", ...(publicConfig ? { next: { revalidate: 300 } } : {}), signal: AbortSignal.timeout(25000) });
    const output = new Headers({ "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" });
    if (publicConfig && response.ok) output.set("Cache-Control", "public, max-age=300");
    for (const name of ["content-type", "content-disposition", "x-request-id", "retry-after"]) { const value = response.headers.get(name); if (value) output.set(name, value); }
    return new Response(response.body, { status: response.status, headers: output });
  } catch { return error(502, "api_unreachable"); }
}
export { proxy as GET, proxy as POST, proxy as PUT, proxy as PATCH, proxy as DELETE };
