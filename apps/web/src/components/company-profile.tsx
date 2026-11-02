'use client';
import { useAuth } from '@/components/auth';
import { usePrefs } from '@/workspace/preferences';
import { useOfficialCompanyProfile, type OfficialCompanyProfileState } from './use-company-profile';
import { CompanyProfileEvidence } from './company-profile-evidence';
import './company-profile.css';

export default function CompanyProfile({ id, ticker, hideUnavailable = false, remote }: {
  id: string; ticker: string; hideUnavailable?: boolean; remote?: OfficialCompanyProfileState;
}) {
  const { token } = useAuth(), { text: t, date } = usePrefs();
  const own = useOfficialCompanyProfile(id, ticker, 0, remote === undefined);
  const current = remote ?? own, data = current.data;
  const p = data?.status === 'verified' ? data.profile : null;
  const enriched = data?.enrichment;
  const leadership = enriched?.leadership ?? [], formation = enriched?.formation ?? [];
  const legacySEC = data?.provider === 'SEC EDGAR' && !enriched;
  const fields = p ? [
    [t('회사명', 'Company'), p.name], [t('영문명', 'English name'), p.english_name],
    [t('업종', 'Industry'), p.industry_description ?? p.industry_code],
    [t('결산월', 'Fiscal year end month'), p.fiscal_month], [t('주소', 'Address'), p.address],
  ] : [];
  const formationLabels = {
    founded: t('창립', 'Founded'), incorporated: t('법인 설립', 'Incorporated'),
    reorganized: t('법인 재편', 'Reorganized'), established: t('설립', 'Established'),
  };
  if (hideUnavailable && data && !current.error && !p) return null;
  return <section className="sb-company-profile" aria-label={t('기업 기본정보', 'Company profile')}>
    <h2>{t('기업 기본정보', 'Company profile')}</h2>
    {!token ? <p role="status">{t('로그인 후 기업정보를 조회할 수 있습니다.', 'Sign in to load company information.')}</p>
      : current.loading ? <p role="status">{t('기업정보를 불러오는 중입니다.', 'Loading company profile.')}</p>
      : current.error ? <p role="alert">{current.status === 401
        ? t('로그인이 만료되었습니다. 다시 로그인해 주세요.', 'Your session expired. Sign in again.')
        : current.status === 429
          ? t('기업정보 제공자의 요청 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.', 'The company profile request limit was reached. Retry shortly.')
          : t('기업정보를 불러오지 못했습니다.', 'Company profile could not be loaded.')} <button type="button" aria-label={t('기업정보 다시 시도', 'Retry company profile')} onClick={current.retry}>{t('다시 시도', 'Retry')}</button></p>
        : !p ? <p>{data?.status === 'unsupported' ? t('이 출처의 기업 기본정보는 아직 지원하지 않습니다.', 'Company profiles from this source are not supported yet.') : t('제공된 기업정보가 없습니다.', 'No company profile is available.')}</p>
          : <>
            <dl>
              {fields.slice(0, 2).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || t('정보 없음', 'Not available')}</dd></div>)}
              <div><dt>{t('대표자', 'Leadership')}</dt><dd>{p.ceo || (leadership.length && enriched
                ? leadership.map((person, index) => <div key={`${person.name}:${index}`}>
                  <strong>{person.name}</strong><br />{person.role}
                  <p className="sb-company-profile-source">{t('자료 기준', 'As of')}: {date(person.as_of, 'date')}
                    {person.basis === 'filing' ? ` · ${t('공시 기재', 'Reported in filing')}` : ` · ${t('공식 출처 확인', 'Official source checked')}`}</p>
                  <CompanyProfileEvidence enrichment={enriched} evidence={person.evidence} />
                </div>)
                : legacySEC ? t('원천 데이터에서 미제공', 'Not supplied by this source') : t('공식 자료에서 아직 확인되지 않았습니다.', 'Not yet verified in official sources'))}</dd></div>
              <div><dt>{t('설립 정보', 'Formation')}</dt><dd>{formation.length && enriched
                ? formation.map((entry, index) => <div key={`${entry.kind}:${index}`}>
                  <strong>{formationLabels[entry.kind]}: {entry.date}</strong>
                  <CompanyProfileEvidence enrichment={enriched} evidence={entry.evidence} />
                </div>)
                : p.established_on || (legacySEC ? t('원천 데이터에서 미제공', 'Not supplied by this source') : t('공식 자료에서 아직 확인되지 않았습니다.', 'Not yet verified in official sources'))}</dd></div>
              {fields.slice(2).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || t('정보 없음', 'Not available')}</dd></div>)}
            </dl>
            {legacySEC && (!p.ceo || !p.established_on) && <p className="sb-company-profile-source">{t('SEC 기업정보 원천에는 대표자·설립일이 제공되지 않습니다. 해당 항목은 조회 오류가 아닙니다.', 'The SEC issuer metadata source does not provide the CEO or establishment date. Missing entries are not loading errors.')}</p>}
            {enriched?.last_error && <p role="status" className="sb-company-profile-source">{t('추가 공식 자료를 모두 갱신하지 못해 마지막으로 확인된 정보를 표시합니다.', 'Some sources could not be refreshed. The last verified information is retained.')} <button type="button" onClick={current.retry}>{t('다시 확인', 'Recheck')}</button></p>}
            {p.website && <p><a href={p.website} target="_blank" rel="noopener noreferrer">{t('공식 홈페이지', 'Company website')} ↗</a></p>}
            <p className="sb-company-profile-source"><a href={data?.source_url} target="_blank" rel="noopener noreferrer">{data?.provider === 'SEC EDGAR' ? t('출처: SEC EDGAR 기업정보', 'Source: SEC EDGAR issuer information') : t('출처: 금융감독원 OpenDART 기업개황', 'Source: FSS OpenDART company overview')}</a><br />{t('조회', 'Retrieved')}: {date(data?.fetched_at ?? null)} · {t('실시간 정보가 아닙니다.', 'Not real-time data.')}</p>
          </>}
  </section>;
}
