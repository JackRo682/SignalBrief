'use client';

import { useEffect, useRef } from 'react';
import { useAuth } from '@/components/auth';
import { Loading, ErrorState, useAction, ActionNotice } from '@/components/ui';
import { API_URL } from '@/lib/api';
import { Heading } from '@/research/ui';
import { useOperationRecord } from '@/admin-logs/record-client';
import { useOpsWorkspace } from '@/admin-logs/workspace-context';

export default function OpsDocument({ id }: { id: string }) {
  const auth = useAuth();
  const action = useAction();
  const workspace = useOpsWorkspace();
  const result = useOperationRecord(`/v1/ops/documents/${encodeURIComponent(id)}`);
  const downloadRequest = useRef<AbortController | null>(null);
  useEffect(() => () => { downloadRequest.current?.abort(); }, [auth.token, auth.me?.id, id]);

  async function download() {
    if (action.busy || !auth.token || !auth.me?.is_admin || auth.error) return;
    await action.run(async () => {
      const controller = new AbortController();
      downloadRequest.current?.abort();
      downloadRequest.current = controller;
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(45_000)]);
      try {
        const response = await fetch(`${API_URL}/v1/ops/documents/${encodeURIComponent(id)}/raw`, {
          headers: { Authorization: `Bearer ${auth.token}` }, credentials: 'omit', cache: 'no-store', signal,
        });
        if (signal.aborted) throw new DOMException('Download cancelled', 'AbortError');
        if (!response.ok) {
          if (response.status === 401 || response.status === 403) {
            const payload = await response.json().catch(() => null);
            if (!signal.aborted) workspace?.deny({ status: response.status, code: payload?.error?.code === 'mfa_required' ? 'mfa_required' : 'raw_download_failed' });
          }
          throw new Error('원본 파일을 받지 못했습니다. 연결과 접근 권한을 확인해 주세요.');
        }
        const blob = await response.blob();
        if (signal.aborted) throw new DOMException('Download cancelled', 'AbortError');
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `source-${id}.bin`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1_000);
      } finally {
        if (downloadRequest.current === controller) downloadRequest.current = null;
      }
    });
  }

  if (!auth.me?.is_admin) return <ErrorState message="운영자 권한이 필요합니다."/>;
  return <>
    <Heading tag="OPERATIONS / DOCUMENT" title="원문·출처·처리 이력" description="원본 파일은 브라우저에 실행 가능한 HTML로 렌더링하지 않습니다.">
      <button type="button" className="button secondary" disabled={action.busy} onClick={download}>원본 파일 받기</button>
    </Heading>
    <ActionNotice action={action}/>
    {result.loading ? <Loading/> : result.error ? <ErrorState message={result.error} retry={result.reload}/>
      : <section className="panel"><pre className="document-json">{JSON.stringify(result.data, null, 2)}</pre></section>}
  </>;
}
