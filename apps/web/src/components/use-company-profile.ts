'use client';
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/components/auth';
import { companyProfileSchema, type CompanyProfileData } from '@/lib/company-profile-contract';

export function useOfficialCompanyProfile(id: string, ticker: string, revision = 0, enabled = true) {
  const { token } = useAuth();
  const [refresh, setRefresh] = useState(0);
  const scope = JSON.stringify([token, id, ticker, revision, refresh]);
  const [state, setState] = useState<{
    scope: string; data: CompanyProfileData | null; error: boolean; status: number; polling: boolean;
  }>({ scope: '', data: null, error: false, status: 0, polling: false });
  const retry = useCallback(() => setRefresh(value => value + 1), []);
  useEffect(() => {
    if (!token || !enabled || !ticker) return;
    let active = true;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    void (async () => {
      for (let poll = 0; poll <= 8 && active; poll++) {
        const response = await fetch(`/api/company-profile?company_id=${encodeURIComponent(id)}`, {
          headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', credentials: 'omit',
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(45000)]),
        });
        if (!response.ok) { if (active) setState({ scope, data: null, error: true, status: response.status, polling: false }); return; }
        const data = companyProfileSchema.parse(await response.json());
        if ((data.status === 'verified' && data.profile?.ticker !== ticker) ||
          (data.enrichment && data.enrichment.company_id !== id)) throw new Error('company_identity_mismatch');
        if (!active) return;
        const polling = poll < 8 && data.enrichment?.last_error === 'profile_refresh_in_progress';
        setState({ scope, data, error: false, status: response.status, polling });
        if (!polling) return;
        await new Promise<void>(resolve => {
          const cancel = () => { clearTimeout(timer); resolve(); };
          timer = setTimeout(() => { controller.signal.removeEventListener('abort', cancel); resolve(); }, 5000);
          controller.signal.addEventListener('abort', cancel, { once: true });
        });
      }
    })().catch(() => { if (active) setState({ scope, data: null, error: true, status: 502, polling: false }); });
    return () => { active = false; clearTimeout(timer); controller.abort(); };
  }, [enabled, id, ticker, token, scope]);
  const current = state.scope === scope;
  return { data: current ? state.data : null, error: current && state.error,
    status: current ? state.status : 0, loading: Boolean(enabled && token && (!current || state.polling)), retry };
}
export type OfficialCompanyProfileState = ReturnType<typeof useOfficialCompanyProfile>;
