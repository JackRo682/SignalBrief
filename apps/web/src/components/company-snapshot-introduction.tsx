"use client";

import { CompanyIntroduction } from "@/components/company-introduction";
import { companyBusinessProfiles } from "@/lib/company-business-profiles";
import { companyIntroduction } from "@/lib/company-overview";
import type { Resource } from "@/workspace/contracts";
import { usePrefs } from "@/workspace/preferences";

/** Reuses already-loaded company evidence; detail sidebars do not fetch another profile. */
export function CompanySnapshotIntroduction({ company }: { company?: Resource }) {
  const { text: t, date, value } = usePrefs();
  if (!company) return null;
  const locale = value.locale === "en" ? 1 : 0;
  const profile = companyBusinessProfiles[company.ticker.toUpperCase()];
  if (profile) return <div className="rd-company-snapshot-introduction">
    <p className="rd-detail-prose">{profile.description[locale]}</p>
    {profile.coverage && <p className="rd-detail-footnote">{profile.coverage[locale]}</p>}
    <p className="rd-detail-footnote">
      {t("공식 자료 확인", "Official source checked")}: {" "}
      <time dateTime={profile.verifiedOn}>{date(profile.verifiedOn, "date")}</time>
      <br />
      {profile.sources.map((source, index) => <span key={source.url}>
        {index > 0 && " · "}
        <a href={source.url} target="_blank" rel="noopener noreferrer">{source.label}</a>
      </span>)}
    </p>
  </div>;
  if (companyIntroduction(company, locale)) return <CompanyIntroduction company={company} />;
  return <p className="rd-detail-prose">{company.summary.trim() || t(
    "검토된 사업 소개가 아직 없습니다. 공식 기업정보와 공시를 확인하세요.",
    "No reviewed business description is available yet. Read the official company information and disclosures.",
  )}</p>;
}
