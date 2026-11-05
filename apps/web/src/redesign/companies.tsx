"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Icon } from "@/components/icons";
import { companyBusinessProfiles } from "@/lib/company-business-profiles";
import { CompanyIntroduction } from "@/components/company-introduction";
import { catalogSchema, sourceOverviewSchema } from "@/workspace/contracts";
import { DataState, useData } from "@/workspace/ui";
import { CompanyLogo, Heading, SearchForm, formatSourceDate } from "./ui";
import CompanyDiscovery from "./company-discovery";
import UniverseCoverage from "./universe-coverage";
import { marketCategory, normalizeCompanyQuery, type MarketGroup } from "./company-search";
export { marketCategory } from "./company-search";
const markets: MarketGroup[] = ["all", "kospi", "kosdaq", "overseas", "unclassified"];
function directoryFilters(params: Pick<URLSearchParams, "get">) {
  const requestedMarket = params.get("market_group") as MarketGroup | null;
  const requestedOffset = params.get("offset") ?? "0";
  const market: MarketGroup = requestedMarket && markets.includes(requestedMarket) ? requestedMarket : "all";
  return {
    query: normalizeCompanyQuery(params.get("q") ?? ""),
    market,
    offset: /^\d+$/.test(requestedOffset) && Number(requestedOffset) <= 10000 ? Number(requestedOffset) : 0,
  };
}
export default function Companies() {
  return (
    <Suspense fallback={<div data-screen="redesign-companies"><Heading title="기업" /><p role="status">기업 목록을 불러오는 중입니다.</p></div>}>
      <Directory />
    </Suspense>
  );
}
function Directory() {
  const { query, market, offset } = directoryFilters(useSearchParams());
  function change(patch: Partial<ReturnType<typeof directoryFilters>>) {
    const url = new URL(window.location.href);
    // Read the current URL so consecutive choices merge before React commits.
    const next = {
      ...directoryFilters(url.searchParams),
      ...(patch.query !== undefined || patch.market !== undefined ? { offset: 0 } : {}),
      ...patch,
    };
    for (const [key, value] of [["q", next.query], ["market_group", next.market === "all" ? "" : next.market], ["offset", next.offset || ""]] as const) {
      if (value === "") url.searchParams.delete(key);
      else url.searchParams.set(key, String(value));
    }
    if (url.href !== window.location.href) {
      // Next's native history integration updates useSearchParams without an
      // unnecessary server navigation and restores filters on Back/Forward.
      window.history.pushState(null, "", `${url.pathname}${url.search}${url.hash}`);
    }
  }
  const directory = useData(
    {
      action: "design_directory",
      p: { market_group: market, q: query, limit: 50, offset },
    },
    catalogSchema,
  );
  const rows = directory.data?.items ?? [];
  const overview = useData(
    directory.data ? { action: "source_overview", p: { scope: "all", days: 0, company_ids: rows.map(row => row.id) } } : null,
    sourceOverviewSchema,
  );
  const monitoring = new Map(
    overview.data?.monitoring.map((x) => [x.company_id, x]),
  );
  const hasUnknown = directory.data?.markets.some(
    (x) => marketCategory(x) === "unclassified",
  );
  return (
    <div data-screen="redesign-companies">
      <Heading title="기업" />
      <UniverseCoverage />
      <div className="rd-directory-tools">
        <SearchForm
          initial={query}
          onSubmit={(q) => change({ query: normalizeCompanyQuery(q) })}
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
              onClick={() => change({ market: key as MarketGroup })}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <DataState {...directory} retry={directory.reload} />
      <DataState {...overview} retry={overview.reload} />
      <CompanyDiscovery query={query} marketGroup={market} existingCompanies={rows} />
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
                {profile?.description[0] || c.summary ? <p className="rd-company-description">{profile?.description[0] || c.summary}</p>
                  : c.official_overview ? <CompanyIntroduction company={c} />
                  : <p className="rd-company-description">확인된 기업 소개가 아직 없습니다.</p>}
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
      {!query && !directory.loading && !directory.error && !rows.length && (
        <p className="rd-empty">조건에 맞는 등록 기업이 없습니다.</p>
      )}
      {(offset > 0 || directory.data?.next_offset != null) && (
        <div className="rd-pagination">
          <button
            className="rd-btn"
            disabled={directory.loading || offset === 0}
            onClick={() => change({ offset: Math.max(0, offset - 50) })}
          >
            이전
          </button>
          <span>{Math.floor(offset / 50) + 1}</span>
          <button
            className="rd-btn"
            disabled={directory.loading || directory.data?.next_offset == null}
            onClick={() => change({ offset: directory.data?.next_offset ?? offset })}
          >
            다음
          </button>
        </div>
      )}
    </div>
  );
}
