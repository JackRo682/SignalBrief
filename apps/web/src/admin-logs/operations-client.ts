'use client';

import { useCallback, useEffect, useState } from 'react';
import { z } from 'zod';
import { useAuth } from '@/components/auth';
import { APIError, request } from '@/lib/api';
import { getSupabase } from '@/lib/supabase';
import { UserLogsError } from './client';
import {
  operationAuditSchema, operationDocumentsSchema, operationQueuesSchema,
  operationsSnapshotSchema, operationUsersSchema, type OperationData,
} from './operations-contracts';

export type OperationResource<T> = { data: T | null; error: UserLogsError | null; loading: boolean };
export type OperationResources = { [K in keyof OperationData]: OperationResource<OperationData[K]> };
type Period = { from: string; to: string };
type State = { scope: string; query: string; revision: number; resources: OperationResources; accessError: UserLogsError | null };

function emptyResources(loading: boolean): OperationResources {
  return {
    snapshot: { data: null, error: null, loading }, documents: { data: null, error: null, loading },
    queues: { data: null, error: null, loading }, users: { data: null, error: null, loading },
    audit: { data: null, error: null, loading },
  };
}
export function operationError(error: unknown): UserLogsError {
  if (error instanceof UserLogsError) return error;
  if (error instanceof APIError) return new UserLogsError(error.status, error.code, error.requestId);
  if (error instanceof z.ZodError) return new UserLogsError(502, 'invalid_operations_response');
  return new UserLogsError(0, error instanceof Error && /^(TimeoutError|AbortError)$/.test(error.name) ? 'request_timeout' : 'operations_unavailable');
}

async function readRpc<T>(name: string, params: Record<string, unknown>, schema: z.ZodType<T>, signal: AbortSignal): Promise<T> {
  const response = await getSupabase().rpc(name, params).abortSignal(signal);
  if (response.error) {
    const code = response.error.message === 'mfa_required' ? 'mfa_required'
      : response.error.message === 'admin_required' ? 'admin_required'
        : response.error.message === 'authentication_required' ? 'authentication_required' : 'operations_unavailable';
    const status = code === 'mfa_required' || code === 'admin_required' ? 403
      : code === 'authentication_required' ? 401 : response.status;
    // Never expose raw database messages, details, hints or internal hosts.
    throw new UserLogsError(status || 503, code);
  }
  return schema.parse(response.data);
}

export function useOperationsData(period: Period, enabled: boolean) {
  const auth = useAuth();
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<State | null>(null);
  const token = auth.token;
  const allowed = enabled && !!token && auth.me?.is_admin === true && !auth.loading && !auth.error;
  const scope = `${auth.me?.id ?? ''}:${token ?? ''}`;
  const query = JSON.stringify({ from: period.from, to: period.to });
  const current = allowed && state?.scope === scope && state.query === query && state.revision === revision;
  const reload = useCallback(() => setRevision(value => value + 1), []);
  const deny = useCallback((error: UserLogsError) => {
    setState(value => value?.scope === scope && value.query === query && value.revision === revision
      ? { scope, query, revision, resources: emptyResources(false), accessError: error } : value);
  }, [scope, query, revision]);

  useEffect(() => {
    if (!allowed || !token) { setState(null); return; }
    let alive = true;
    let denied = false;
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(25_000)]);
    const marker = { scope, query, revision };
    const selected = JSON.parse(query) as Period;
    setState({ ...marker, resources: emptyResources(true), accessError: null });

    async function load<K extends keyof OperationData>(key: K, read: () => Promise<OperationData[K]>) {
      if (!alive) return;
      try {
        const data = await read();
        if (!alive || denied) return;
        setState(value => value?.scope === scope && value.query === query && value.revision === revision && !value.accessError
          ? { ...value, resources: { ...value.resources, [key]: { data, error: null, loading: false } } } : value);
      } catch (error) {
        if (!alive || denied) return;
        const safe = operationError(error);
        if (safe.status === 401 || safe.status === 403) {
          denied = true;
          controller.abort();
          setState({ ...marker, resources: emptyResources(false), accessError: safe });
        } else {
          setState(value => value?.scope === scope && value.query === query && value.revision === revision && !value.accessError
            ? { ...value, resources: { ...value.resources, [key]: { data: null, error: safe, loading: false } } } : value);
        }
      }
    }
    // No private data cache. Strict Mode's abandoned first pass sends no requests.
    void Promise.resolve().then(async () => {
      if (!alive) return;
      await Promise.allSettled([
        load('snapshot', () => readRpc('sb_reference_ops', { p: { range: 'custom', start: selected.from, end: selected.to } }, operationsSnapshotSchema, signal)),
        load('documents', () => request('/v1/ops/documents?limit=100', token, operationDocumentsSchema, { signal })),
        load('queues', () => request('/v1/ops/queues', token, operationQueuesSchema, { signal })),
        load('users', () => readRpc('sb_reference_users', {}, operationUsersSchema, signal)),
        load('audit', () => request('/v1/ops/audit?limit=100', token, operationAuditSchema, { signal })),
      ]);
    });
    return () => { alive = false; controller.abort(); };
  }, [allowed, token, scope, query, revision]);

  const resources = current ? state.resources : emptyResources(allowed);
  return { resources, accessError: current ? state.accessError : null, loading: Object.values(resources).some(item => item.loading), reload, deny };
}
