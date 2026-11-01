"use client";

import { companyIntroduction } from "@/lib/company-overview";
import type { Resource } from "@/workspace/contracts";
import { usePrefs } from "@/workspace/preferences";

/** A factual fallback, separate from the reviewed business/product descriptions. */
export function CompanyIntroduction({ company }: { company: Resource }) {
  const { text: t, date, value } = usePrefs();
  const introduction = companyIntroduction(company, value.locale === "en" ? 1 : 0);
  if (!introduction) return null;
  return <div className="rd-company-official-introduction">
    <p className="rd-detail-prose">{introduction.text}</p>
    <p className="rd-detail-footnote">
      <a href={introduction.source_url} target="_blank" rel="noopener noreferrer">
        {introduction.label} · {introduction.provider}
      </a>
      {" · "}{t("확인", "Retrieved")}: {date(introduction.fetched_at)}
    </p>
  </div>;
}
