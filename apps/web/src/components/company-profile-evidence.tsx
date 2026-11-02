'use client';
import type { ProfileEnrichment, ProfileEvidence } from '@/lib/company-profile-contract';
import { usePrefs } from '@/workspace/preferences';

export function CompanyProfileEvidence({ enrichment, evidence }: {
  enrichment: ProfileEnrichment; evidence: ProfileEvidence;
}) {
  const { text: t, date } = usePrefs();
  const source = enrichment.sources.find(item => item.id === evidence.source_id);
  if (!source) return null;
  return <>
    {source.normalization === 'dart-periodic-recovered-text-v1' && <p className="sb-company-profile-source">{t('원문에서 복구한 발췌입니다. 문서 구조를 추가로 확인해야 합니다.', 'This excerpt was recovered from the original markup. Its document structure requires further review.')}</p>}
    <details className="sb-profile-evidence">
    <summary>{t('원문과 출처', 'Source and quotation')}</summary>
    <blockquote>{evidence.quote}</blockquote>
    <p><a href={source.source_url} target="_blank" rel="noopener noreferrer">{source.title} ↗</a></p>
    <p>{source.provider}{source.published_on && <> · {t('공개일', 'Published')}: {date(source.published_on, 'date')}</>}
      {' · '}{t('확인', 'Checked')}: {date(source.fetched_at)}</p>
    </details>
  </>;
}
