import { createClient } from '@supabase/supabase-js';
import { adminOverviewRequestSchema, adminOverviewResponseSchema } from '@/admin-logs/overview-contracts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

function publicConfiguration() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  try {
    const target = new URL(url);
    const publicKey = key.startsWith('sb_publishable_') ||
      (!key.startsWith('sb_secret_') && JSON.parse(Buffer.from(key.split('.')[1] ?? '', 'base64url').toString()).role === 'anon');
    if (target.protocol !== 'https:' || !target.hostname.endsWith('.supabase.co') ||
        target.username || target.password || target.port || target.pathname !== '/' || target.search || target.hash || !publicKey) return null;
    return { url, key };
  } catch { return null; }
}

export async function POST(req: Request) {
  const requestId = crypto.randomUUID();
  const headers = {
    'Cache-Control': 'private, no-store, max-age=0',
    Pragma: 'no-cache',
    Vary: 'Authorization',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Request-ID': requestId,
  };
  const fail = (status: number, code: string) => Response.json(
    { error: { code }, request_id: requestId },
    { status, headers: { ...headers, ...(status === 429 ? { 'Retry-After': '30' } : {}) } },
  );
  const authorization = req.headers.get('authorization') ?? '';
  if (!/^Bearer [A-Za-z0-9._-]{20,8192}$/.test(authorization)) return fail(401, 'authentication_required');
  if (req.headers.get('origin') && req.headers.get('origin') !== new URL(req.url).origin) return fail(403, 'origin_not_allowed');
  if (!(req.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) return fail(415, 'json_required');
  if (Number(req.headers.get('content-length') ?? 0) > 4096) return fail(413, 'body_too_large');
  const config = publicConfiguration();
  if (!config) return fail(503, 'overview_configuration_missing');

  try {
    const reader = req.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (reader) while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 4096) { await reader.cancel(); return fail(413, 'body_too_large'); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    let raw: unknown;
    try { raw = JSON.parse(new TextDecoder().decode(bytes)); }
    catch { return fail(422, 'invalid_input'); }
    const parsed = adminOverviewRequestSchema.safeParse(raw);
    if (!parsed.success) return fail(422, 'invalid_input');

    // The caller's bearer token is used throughout. No service key or browser role claim is trusted.
    const signal = AbortSignal.timeout(20000);
    const db = createClient(config.url, config.key, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: authorization }, fetch: (input, init) => fetch(input, { ...init, cache: 'no-store', signal, redirect: 'error' }) },
    });
    const verified = await db.auth.getUser();
    if (verified.error) {
      if (verified.error.status === 429) return fail(429, 'rate_limit_exceeded');
      return (verified.error.status ?? 0) >= 500 || verified.error.name === 'AuthRetryableFetchError'
        ? fail(503, 'authentication_unavailable') : fail(401, 'invalid_or_expired_session');
    }
    if (!verified.data.user) return fail(401, 'invalid_or_expired_session');
    if (!verified.data.user.email_confirmed_at) return fail(403, 'verified_account_required');

    const permission = await db.rpc('sb_is_admin');
    if (permission.error) {
      if (permission.error.code === 'PT403' && permission.error.message === 'mfa_required') return fail(403, 'mfa_required');
      if (permission.status === 429 || permission.error.code === 'PT429') return fail(429, 'rate_limit_exceeded');
      if (['PGRST301', 'PGRST303', 'PT401'].includes(permission.error.code)) return fail(401, 'invalid_or_expired_session');
      return fail(503, 'permission_check_unavailable');
    }
    if (permission.data !== true) return fail(403, 'admin_required');

    // The database rechecks the allowlist, current auth session, MFA, and input bounds.
    const { data, error, status: rpcStatus } = await db.rpc('sb_admin_overview', { p: parsed.data });
    if (error) {
      const status = rpcStatus === 429 ? 429 : ['PGRST301', 'PGRST303'].includes(error.code) ? 401
        : /^PT(?:401|403|422|429)$/.test(error.code) ? Number(error.code.slice(2))
        : error.code === '42501' ? 403 : 503;
      const known = new Set(['authentication_required', 'invalid_or_expired_session', 'session_revoked',
        'admin_required', 'mfa_required', 'verified_account_required', 'invalid_input', 'rate_limit_exceeded',
        'invalid_date_range', 'invalid_filter']);
      const code = known.has(error.message) ? error.message
        : status === 401 ? 'invalid_or_expired_session' : status === 403 ? 'admin_required'
        : status === 422 ? 'invalid_input' : status === 429 ? 'rate_limit_exceeded' : 'overview_unavailable';
      return fail(status, code);
    }
    const response = adminOverviewResponseSchema.safeParse(data);
    if (!response.success) return fail(502, 'invalid_overview_response');
    return Response.json(response.data, { headers });
  } catch { return fail(503, 'overview_unavailable'); }
}
