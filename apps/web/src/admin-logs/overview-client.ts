'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/components/auth';
import { adminOverviewRequestSchema, adminOverviewResponseSchema, type AdminOverviewRequest, type AdminOverviewResponse } from './overview-contracts';

import { UserLogsError } from './client';

function safeRequestId(value: unknown): string | null {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(value) ? value : null;
}

export async function fetchAdminOverview(token: string, query: AdminOverviewRequest, signal?: AbortSignal): Promise<AdminOverviewResponse> {
  const payload = adminOverviewRequestSchema.parse(query);
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort();
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 25_000);
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) controller.abort();
  try {
    const response = await fetch('/api/admin/overview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      signal: controller.signal,
    });
    const data: unknown = await response.json().catch(() => null);
    const envelope = data && typeof data === 'object' ? data as Record<string, unknown> : {};
    const error = envelope.error && typeof envelope.error === 'object' ? envelope.error as Record<string, unknown> : {};
    const requestId = safeRequestId(response.headers.get('x-request-id')) ?? safeRequestId(envelope.request_id);
    if (!response.ok) {
      const code = typeof error.code === 'string' && /^[a-z_0-9]{1,80}$/.test(error.code) ? error.code : 'overview_request_failed';
      const retryHeader = Number(response.headers.get('retry-after'));
      const retrySeconds = Number.isFinite(retryHeader) && retryHeader > 0 ? Math.min(300, Math.ceil(retryHeader)) : 30;
      throw new UserLogsError(response.status, code, requestId, response.status === 429 ? Date.now() + retrySeconds * 1_000 : null);
    }
    const result = adminOverviewResponseSchema.safeParse(data);
    if (!result.success || result.data.from !== payload.from || result.data.to !== payload.to || result.data.include_admin !== payload.include_admin) {
      throw new UserLogsError(502, 'invalid_overview_response', requestId);
    }
    return result.data;
  } catch (error) {
    if (timedOut) throw new UserLogsError(0, 'request_timeout');
    if (error instanceof UserLogsError || signal?.aborted) throw error;
    throw new UserLogsError(0, 'network_unreachable');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

type Snapshot = {
  scope: string;
  query: string;
  revision: number;
  data: AdminOverviewResponse | null;
  error: UserLogsError | null;
  loading: boolean;
};

export function useAdminOverview(query: AdminOverviewRequest) {
  const auth = useAuth();
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<Snapshot | null>(null);
  const rateLimit = useRef<{ scope: string; error: UserLogsError } | null>(null);
  const token = auth.token;
  const enabled = !!token && auth.me?.is_admin === true && !auth.loading && !auth.error;
  const scope = `${auth.me?.id ?? ''}:${token ?? ''}`;
  const key = JSON.stringify(query);
  const current = enabled && state?.scope === scope && state.query === key && state.revision === revision;

  const reload = useCallback(() => {
    const hold = rateLimit.current;
    if (hold?.scope === scope && (hold.error.retryAt ?? 0) > Date.now()) return;
    setRevision(value => value + 1);
  }, [scope]);

  useEffect(() => {
    if (!enabled || !token) {
      setState(null);
      rateLimit.current = null;
      return;
    }
    let alive = true;
    const controller = new AbortController();
    const snapshot = { scope, query: key, revision };
    const hold = rateLimit.current;
    if (hold?.scope === scope && (hold.error.retryAt ?? 0) > Date.now()) {
      setState({ ...snapshot, data: null, error: hold.error, loading: false });
      return;
    }
    rateLimit.current = null;
    setState({ ...snapshot, data: null, error: null, loading: true });
    // Strict Mode and immediately abandoned renders must not send extra private reads.
    void Promise.resolve().then(async () => {
      if (!alive) return;
      try {
        const result = await fetchAdminOverview(token, JSON.parse(key) as AdminOverviewRequest, controller.signal);
        if (alive) setState({ ...snapshot, data: result, error: null, loading: false });
      } catch (error) {
        if (!alive) return;
        const safe = error instanceof UserLogsError ? error : new UserLogsError(0, 'network_unreachable');
        if (safe.status === 429) rateLimit.current = { scope, error: safe };
        setState({ ...snapshot, data: null, error: safe, loading: false });
      }
    });
    return () => { alive = false; controller.abort(); };
  }, [enabled, token, scope, key, revision]);

  // No persisted cache: an identity, token, permission, or filter change hides old rows in this render.
  return {
    data: current ? state.data : null,
    error: current ? state.error : null,
    loading: enabled && (!current || state.loading),
    reload,
  };
}
