'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/components/auth';
import { errorMessage, request } from '@/lib/api';
import { jsonObjectSchema } from '@/lib/contracts';
import { operationError } from './operations-client';
import { useOpsWorkspace } from './workspace-context';

type RecordState = { scope: string; revision: string; data: Record<string, unknown> | null; error: string; loading: boolean };

/** Detail records share the dashboard's refresh and authorization boundary. */
export function useOperationRecord(path: string) {
  const auth = useAuth();
  const workspace = useOpsWorkspace();
  const [localRevision, setLocalRevision] = useState(0);
  const [state, setState] = useState<RecordState | null>(null);
  const scope = `${auth.me?.id ?? ''}:${auth.token ?? ''}:${path}`;
  const revision = `${workspace?.refreshVersion ?? 0}:${localRevision}`;
  const deny = workspace?.deny;
  const allowed = !!auth.token && auth.me?.is_admin === true && !auth.loading && !auth.error;
  const reload = useCallback(() => setLocalRevision(value => value + 1), []);
  useEffect(() => {
    if (!allowed) return;
    const controller = new AbortController();
    setState({ scope, revision, data: null, error: '', loading: true });
    void request(path, auth.token, jsonObjectSchema, { signal: controller.signal }).then(data => {
      if (!controller.signal.aborted) setState({ scope, revision, data, error: '', loading: false });
    }).catch(error => {
      if (controller.signal.aborted) return;
      const safe = operationError(error);
      if (safe.status === 401 || safe.status === 403) deny?.(safe);
      setState({ scope, revision, data: null, error: errorMessage(error), loading: false });
    });
    return () => controller.abort();
  }, [allowed, auth.token, scope, revision, path, deny]);
  const current = allowed && state?.scope === scope && state.revision === revision;
  return { data: current ? state.data : null, error: current ? state.error : '', loading: current ? state.loading : allowed, reload };
}
