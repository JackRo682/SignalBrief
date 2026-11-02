'use client';
import { useState } from 'react';
import { usePrefs } from '@/workspace/preferences';
import { decimalInput } from '@/lib/decimal-input';
import type { CompanyFinancialsState } from './use-company-financials';

function exactValue(raw: string) {
  const value = decimalInput(raw), [whole, fraction] = value.split('.');
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (fraction === undefined ? '' : `.${fraction}`);
}
export function CompanyFinancials({ remote }: { remote: CompanyFinancialsState }) {
  const { text: t, date } = usePrefs(), [expanded, setExpanded] = useState(false);
  const data = remote.data, items = data?.items ?? [];
  return <>
    {remote.loading && <p role="status">{t('공식 재무 수치를 불러오는 중입니다.', 'Loading reported financial figures.')}</p>}
    {(remote.error || data?.status === 'unavailable') && <p role="alert">{t('공식 수치를 갱신하지 못했습니다. 이미 확인된 수치가 있으면 유지됩니다.', 'Reported figures could not be refreshed. Previously verified figures are retained.')} <button type="button" onClick={remote.retry}>{t('수치 다시 불러오기', 'Retry figures')}</button></p>}
    {data?.status === 'pending' && <p role="status">{remote.polling ? t('공식 수치를 수집하고 있습니다. 완료되면 자동으로 표시합니다.', 'Collecting reported figures. Results will appear automatically.') : t('수집이 진행 중입니다. 잠시 후 다시 확인하세요.', 'Collection is still pending. Check again shortly.')}</p>}
    {items.length > 0 && <>
      <p className="rd-detail-muted">{t('공식 공시의 보고 수치입니다. 각 행의 기간·통화·회계 기준을 확인하세요.', 'Values reported in official filings. Each row retains its period, currency and accounting basis.')}
        {data?.source && <> · {t('확인', 'Checked')}: {date(data.source.fetched_at)}</>}</p>
      <div className="rd-detail-table-scroll"><table className="rd-detail-fact-table">
        <caption className="rd-detail-sr-only">{t('공식 보고 수치와 원문 근거', 'Reported figures and source evidence')}</caption>
        <tbody>{(expanded ? items : items.slice(0, 12)).map((item, index) => <tr key={`${item.location}:${index}`}>
          <th scope="row">{item.label}<small>{item.scope === 'consolidated' ? t('연결', 'Consolidated') : item.scope === 'separate' ? t('별도', 'Separate') : t('발행사 보고값', 'Issuer reported value')}</small></th>
          <td><strong>{exactValue(item.value_raw)} {item.unit}</strong><small>{item.period_label}</small>
            <small>{item.accounting_standard ?? t('회계 기준 별도 미표기', 'Accounting standard not separately specified')}
              {item.filed_on && <> · {t('공시', 'Filed')}: {date(item.filed_on, 'date')}</>}</small></td>
          <td><a href={item.source_url} target="_blank" rel="noopener noreferrer">{t('공식 수치 원문', 'Official source')} ↗</a>
            <details className="sb-profile-evidence"><summary>{t('보고값 근거', 'Reported value evidence')}</summary>
              <p>{item.taxonomy} · {item.concept}</p><p>{item.form} · {item.accession}</p>
              <blockquote>{item.source_quote}</blockquote>
            </details></td>
        </tr>)}</tbody></table></div>
      {items.length > 12 && <button type="button" className="rd-detail-text-button" onClick={() => setExpanded(value => !value)}>{expanded ? t('간략히 보기', 'Show fewer') : t(`전체 ${items.length}개 보고값 보기`, `Show all ${items.length} reported values`)}</button>}
    </>}
    {data && !items.length && ['ready', 'unsupported', 'not_collected'].includes(data.status) && <p className="rd-detail-empty">{data.status === 'ready'
      ? t('조회한 공식 자료에 이 형식의 보고 수치가 없습니다. 공시 원문을 확인할 수 있습니다.', 'The official source returned no figures in this format. The original disclosures remain available.')
      : data.status === 'unsupported' ? t('이 발행사의 공식 재무 자료 형식은 아직 연결되지 않았습니다.', 'This issuer’s official financial format is not connected yet.')
        : t('공식 수치 수집을 준비하고 있습니다.', 'Preparing official financial collection.')}</p>}
  </>;
}

export function CompanyAnalysisStatus({ remote, hasApproved }: { remote: CompanyFinancialsState; hasApproved: boolean }) {
  const { text: t } = usePrefs();
  if (hasApproved) return null;
  const analysis = remote.data?.analysis;
  const message = analysis?.status === 'approved'
    ? t('승인된 분석 목록을 불러오고 있습니다.', 'Loading the approved analysis list.')
    : analysis?.status === 'pending_review'
    ? t(`${analysis.pending_review}건의 분석이 작성되어 근거 검토를 기다리고 있습니다. 검토가 끝나면 이곳에 표시합니다.`, `${analysis.pending_review} analyses are awaiting evidence review. They will appear here after approval.`)
    : analysis?.status === 'queued' || analysis?.status === 'collecting'
      ? t('수집된 공시를 분석 대기열에 연결했습니다. 분석과 근거 검토가 끝나면 표시합니다.', 'Collected filings are queued for analysis. Results appear after analysis and evidence review.')
      : analysis?.status === 'blocked' ? t('분석 처리가 중단되어 운영 확인이 필요합니다. 수집된 공시 원문은 열어볼 수 있습니다.', 'Analysis processing needs operational attention. Collected source filings remain available.')
        : remote.loading ? t('분석 수집 상태를 확인하고 있습니다.', 'Checking analysis collection status.')
          : t('아직 검토가 완료된 분석이 없습니다. 공식 공시와 보고 수치는 별도로 제공합니다.', 'No analysis has completed review yet. Official disclosures and reported figures are available separately.');
  return <p className="rd-detail-callout" role="status">{message}</p>;
}
