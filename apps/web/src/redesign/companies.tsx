"use client";
import Link from "next/link";
import { useState } from "react";
import { Icon } from "@/components/icons";
import { companyBusinessProfiles } from "@/lib/company-business-profiles";
import { catalogSchema, sourceOverviewSchema } from "@/workspace/contracts";
import { DataState, useData } from "@/workspace/ui";
import { CompanyLogo, Heading, SearchForm, formatSourceDate } from "./ui";

export function marketCategory(
  value: string,
): "kospi" | "kosdaq" | "overseas" | "unclassified" {
  const market = value.toUpperCase();
  if (["KOSPI", "코스피", "KRX:KOSPI"].includes(market)) return "kospi";
  if (["KOSDAQ", "코스닥", "KRX:KOSDAQ"].includes(market)) return "kosdaq";
  if (
    [
      "NASDAQ",
      "NYSE",
      "AMEX",
      "NYSEARCA",
      "NYSE ARCA",
      "OTC",
      "LSE",
      "TSE",
      "HKEX",
    ].includes(market)
  )
    return "overseas";
  return "unclassified";
}
export default function Companies() {
  const [query, setQuery] = useState(""),
    [market, setMarket] = useState<
      "all" | "kospi" | "kosdaq" | "overseas" | "unclassified"
    >("all"),
    [offset, setOffset] = useState(0);
  const directory = useData(
    {
      action: "design_directory",
      p: { market_group: market, q: query, limit: 50, offset },
    },
    catalogSchema,
  );
  const overview = useData(
    { action: "source_overview", p: { scope: "all", days: 0 } },
    sourceOverviewSchema,
  );
  const monitoring = new Map(
    overview.data?.monitoring.map((x) => [x.company_id, x]),
  );
  const rows = directory.data?.items ?? [];
  const hasUnknown = directory.data?.markets.some(
    (x) => marketCategory(x) === "unclassified",
  );
  return (
    <div data-screen="redesign-companies">
      <Heading title="기업" />
      <div className="rd-directory-tools">
        <SearchForm
          onSubmit={(q) => {
            setQuery(q);
            setOffset(0);
          }}
        />
        <div className="rd-market-tabs" role="group" aria-label="시장">
          {[
            ["all", "전체"],
            ["kospi", "코스피"],
            ["kosdaq", "코스닥"],
            ["overseas", "해외주식"],
            ...(hasUnknown ? [["unclassified", "시장 미분류"]] : []),
          ].map(([key, label]) => (
            <button
              type="button"
              key={key}
              aria-pressed={market === key}
              onClick={() => {
                setMarket(key as typeof market);
                setOffset(0);
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <DataState {...directory} retry={directory.reload} />
      <DataState {...overview} retry={overview.reload} />
      {market === "unclassified" && (
        <p className="rd-note">
          거래소 정보가 세부 시장까지 확인되지 않은 기업입니다.
        </p>
      )}
      <div className="rd-companies">
        {rows.map((c) => {
          const record = monitoring.get(c.id),
            profile = companyBusinessProfiles[c.ticker.toUpperCase()];
          return (
            <article className="rd-company-card" key={c.id}>
              <div className="rd-company-card-top">
                <Link href={`/companies/${c.id}`} className="rd-company-name">
                  <CompanyLogo ticker={c.ticker} />
                  <div>
                    <h2>{c.company_name}</h2>
                    <p>
                      {c.ticker} · {c.market}
                    </p>
                  </div>
                </Link>
                <p className="rd-company-description">
                  {profile?.description[0] ||
                    c.summary ||
                    "확인된 기업 소개가 아직 없습니다."}
                </p>
                <div className="rd-company-links">
                  <Link href={`/search?kind=document&company_id=${c.id}`}>
                    <Icon name="file" />
                    전체 공시 보기 <span aria-hidden="true">→</span>
                  </Link>
                  <Link href={`/search?kind=analysis&company_id=${c.id}`}>
                    <Icon name="timeline" />
                    승인된 분석 보기 <span aria-hidden="true">→</span>
                  </Link>
                </div>
              </div>
              <dl className="rd-company-foot">
                <div>
                  <dt>최근 공시</dt>
                  <dd>
                    {overview.loading
                      ? "확인 중"
                      : overview.error
                        ? "조회 실패"
                        : record?.latest_filing
                          ? formatSourceDate(record.latest_filing.published_at)
                          : "수집 전"}
                  </dd>
                </div>
                <div>
                  <dt>최근 분석</dt>
                  <dd>
                    {overview.loading
                      ? "확인 중"
                      : overview.error
                        ? "조회 실패"
                        : record?.latest_analysis
                          ? formatSourceDate(
                              record.latest_analysis.reviewed_at ??
                                record.latest_analysis.published_at,
                            )
                          : "승인 전"}
                  </dd>
                </div>
                <div>
                  <dt>다음 일정</dt>
                  <dd>
                    {overview.loading
                      ? "확인 중"
                      : overview.error
                        ? "조회 실패"
                        : record?.next_event
                          ? formatSourceDate(record.next_event.occurs_on)
                          : "확인된 일정 없음"}
                  </dd>
                </div>
              </dl>
            </article>
          );
        })}
      </div>
      {!directory.loading && !directory.error && !rows.length && (
        <p className="rd-empty">조건에 맞는 등록 기업이 없습니다.</p>
      )}
      {(offset > 0 || directory.data?.next_offset != null) && (
        <div className="rd-pagination">
          <button
            className="rd-btn"
            disabled={directory.loading || offset === 0}
            onClick={() => setOffset(Math.max(0, offset - 50))}
          >
            이전
          </button>
          <span>{Math.floor(offset / 50) + 1}</span>
          <button
            className="rd-btn"
            disabled={directory.loading || directory.data?.next_offset == null}
            onClick={() => setOffset(directory.data?.next_offset ?? offset)}
          >
            다음
          </button>
        </div>
      )}
    </div>
  );
}
