'use client';
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/components/auth';
import { companyFinancialsSchema, type CompanyFinancialsData } from '@/lib/company-financials-contract';

/** The first POST is cached/idempotent on the server. Subsequent polls are reads. */
export function useCompanyFinancials(companyId: string, enabled: boolean, revision = 0) {
  const { token } = useAuth();
  const [refresh, setRefresh] = useState(0);
  const key = JSON.stringify([token, companyId, revision, refresh]);
  const [state, setState] = useState<{ key: string; data: CompanyFinancialsData | null; error: boolean; polling: boolean }>(
    { key: '', data: null, error: false, polling: false });
  const retry = useCallback(() => setRefresh(value => value + 1), []);
  useEffect(() => {
    if (!token || !enabled) return;
    let alive = true;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    void (async () => {
      let data: CompanyFinancialsData | null = null;
      try {
        for (let poll = 0; poll <= 12 && alive; poll++) {
          const url = poll ? `/api/us/company-financials?company_id=${encodeURIComponent(companyId)}` : '/api/us/company-financials';
          const response = await fetch(url, { method: poll ? 'GET' : 'POST',
            headers: { Authorization: `Bearer ${token}`, ...(!poll ? { 'Content-Type': 'application/json' } : {}) },
            ...(!poll ? { body: JSON.stringify({ company_id: companyId }) } : {}),
            credentials: 'omit', cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(55000)]),
          });
          if (!response.ok) throw new Error('financials_unavailable');
          data = companyFinancialsSchema.parse(await response.json());
          if (data.company_id !== companyId) throw new Error('company_identity_mismatch');
          if (!alive) return;
          const polling = poll < 12 && (data.status === 'pending' || ['queued', 'collecting'].includes(data.analysis.status));
          setState({ key, data, error: false, polling });
          if (!polling) return;
          await new Promise<void>(resolve => {
            const cancel = () => { clearTimeout(timer); resolve(); };
            timer = setTimeout(() => { controller.signal.removeEventListener('abort', cancel); resolve(); }, 10000);
            controller.signal.addEventListener('abort', cancel, { once: true });
          });
        }
      } catch { if (alive) setState({ key, data: data?.company_id === companyId ? data : null, error: true, polling: false }); }
    })();
    return () => { alive = false; clearTimeout(timer); controller.abort(); };
  }, [companyId, enabled, token, key]);
  const current = state.key === key;
  return { data: current ? state.data : null, error: current && state.error,
    loading: Boolean(enabled && token && !current), polling: current && state.polling, retry };
}
export type CompanyFinancialsState = ReturnType<typeof useCompanyFinancials>;
