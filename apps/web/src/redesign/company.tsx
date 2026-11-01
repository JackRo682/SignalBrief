"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState, type KeyboardEvent, type ReactNode } from "react";
import { z } from "zod";
import { useAuth } from "@/components/auth";
import { Icon, type IconName } from "@/components/icons";
import CompanyProfile from "@/components/company-profile";
import { CompanyNews } from "@/components/company-news";
import { body, emptySchema, request } from "@/lib/api";
import { companyBusinessProfiles } from "@/lib/company-business-profiles";
import { decimalInput } from "@/lib/decimal-input";
import { workspace } from "@/workspace/client";
import {
  companyDetailSchema,
  resourceHref,
  safeSource,
  sourceOverviewSchema,
  type Resource,
} from "@/workspace/contracts";
import { usePrefs } from "@/workspace/preferences";
import { DataState, Notice, useData, useMutation } from "@/workspace/ui";
import "./detail.css";

const tabs = [
  ["overview", "개요", "Overview"],
  ["disclosures", "공시", "Disclosures"],
  ["analyses", "분석", "Analyses"],
  ["news", "뉴스", "News"],
  ["events", "일정", "Events"],
] as const;
type Tab = (typeof tabs)[number][0];
const logos = new Set([
  "AAPL",
  "NVDA",
  "TSLA",
  "005930",
  "000660",
  "005380",
  "035420",
  "035720",
  "373220",
  "005490",
]);
const labels: Record<string, [string, string]> = {
  revenue: ["매출액", "Revenue"],
  sales: ["매출액", "Sales"],
  operating_income: ["영업이익", "Operating income"],
  operating_profit: ["영업이익", "Operating profit"],
  net_income: ["순이익", "Net income"],
  total_assets: ["총 자산", "Total assets"],
  eps: ["주당순이익", "Earnings per share"],
  capex: ["설비투자", "Capital expenditure"],
  dividend: ["배당", "Dividend"],
  employees: ["임직원 수", "Employees"],
};

/** Formatting only: keep the stored decimal and unit; never infer an FX conversion. */
export function exactDetailValue(raw: string) {
  const value = decimalInput(raw);
  if (!/^[+-]?\d+(\.\d+)?$/.test(value)) return raw;
  const [whole, fraction] = value.split(".");
  return (
    whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",") +
    (fraction === undefined ? "" : `.${fraction}`)
  );
}

export function DetailPanel({
  title,
  action,
  children,
  className = "",
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rd-detail-panel ${className}`}>
      <header>
        <h2>{title}</h2>
        {action}
      </header>
      {children}
    </section>
  );
}

export function DetailSource({
  url,
  children,
}: {
  url: string | null;
  children: ReactNode;
}) {
  const href = safeSource(url);
  return href ? (
    <a
      className="rd-detail-source"
      href={href}
      target="_blank"
      rel="noopener noreferrer"
    >
      {children}
      <span aria-hidden="true"> ↗</span>
    </a>
  ) : null;
}

export function DetailLogo({ ticker }: { ticker: string }) {
  return (
    <span className="rd-detail-logo" aria-hidden="true">
      {logos.has(ticker.toUpperCase()) ? (
        <Image
          src={`/reference-assets/logos/${ticker.toUpperCase()}.webp`}
          width={96}
          height={96}
          alt=""
        />
      ) : ticker === "MSFT" ? (
        <span className="rd-detail-msft">
          <i />
          <i />
          <i />
          <i />
        </span>
      ) : (
        <span>{ticker}</span>
      )}
    </span>
  );
}

export function DetailRows({
  items,
  empty,
}: {
  items: Resource[];
  empty: string;
}) {
  const { date, text: t } = usePrefs();
  return items.length ? (
    <ul className="rd-detail-rows">
      {items.map((item) => (
        <li key={`${item.kind}:${item.id}`}>
          <Link href={resourceHref(item)}>
            <span className="rd-detail-row-copy">
              <strong>{item.title}</strong>
              <small>
                {item.company_name}
                {item.reviewed_at
                  ? ` · ${t("검토", "Reviewed")} ${date(item.reviewed_at)}`
                  : ""}
              </small>
            </span>
            <time dateTime={item.published_at ?? undefined}>
              {date(item.published_at, item.publication_precision)}
            </time>
            <span aria-hidden="true">›</span>
          </Link>
        </li>
      ))}
    </ul>
  ) : (
    <p className="rd-detail-empty">{empty}</p>
  );
}

export default function CompanyDetail({ id }: { id: string }) {
  return <CompanyContent key={id} id={id} />;
}

function CompanyContent({ id }: { id: string }) {
  const { token } = useAuth();
  const { text: t, date, value } = usePrefs();
  const result = useData({ action: "company", p: { id } }, companyDetailSchema);
  const action = useMutation();
  const [tab, setTab] = useState<Tab>("overview");
  const data = result.data,
    company = data?.company;
  const profile = company
    ? companyBusinessProfiles[company.ticker.toUpperCase()]
    : undefined;
  const locale = value.locale === "en" ? 1 : 0;
  const events = useData(
    tab === "events"
      ? {
          action: "source_overview",
          p: { scope: "all", company_id: id, days: 0 },
        }
      : null,
    sourceOverviewSchema,
  );

  useEffect(() => {
    const sync = () => {
      const requested = new URLSearchParams(window.location.search).get("tab");
      setTab(
        tabs.some(([name]) => name === requested)
          ? (requested as Tab)
          : "overview",
      );
    };
    sync();
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);

  useEffect(() => {
    if (token && value.history_enabled && company?.id) {
      void workspace(
        token,
        { action: "visit", p: { kind: "company", id: company.id } },
        z.unknown(),
      ).catch(() => {});
    }
  }, [token, value.history_enabled, company?.id]);

  function changeTab(next: Tab) {
    setTab(next);
    const url = new URL(window.location.href);
    if (next === "overview") url.searchParams.delete("tab");
    else url.searchParams.set("tab", next);
    window.history.pushState(
      window.history.state,
      "",
      `${url.pathname}${url.search}${url.hash}`,
    );
  }

  function tabKeyboard(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const target =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? tabs.length - 1
          : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) %
            tabs.length;
    changeTab(tabs[target][0]);
    document.getElementById(`rd-company-${id}-${tabs[target][0]}`)?.focus();
  }

  const facts =
    data?.facts.filter(
      (fact) =>
        fact.value_raw !== null &&
        fact.unit &&
        fact.period &&
        fact.basis &&
        fact.quote,
    ) ?? [];
  const sourceNotes = profile && (
    <p className="rd-detail-footnote">
      {t("공식 자료 확인", "Official source checked")}:{" "}
      <time dateTime={profile.verifiedOn}>
        {date(profile.verifiedOn, "date")}
      </time>
      <br />
      {profile.sources.map((source, index) => (
        <span key={source.url}>
          {index > 0 ? " · " : ""}
          <DetailSource url={source.url}>{source.label}</DetailSource>
        </span>
      ))}
    </p>
  );

  return (
    <article
      className="rd-company-detail"
      data-testid="redesign-company-detail"
    >
      <DataState {...result} retry={result.reload} />
      <Notice action={action} />
      {data && company && (
        <>
          <header className="rd-detail-company-hero">
            <DetailLogo ticker={company.ticker} />
            <div className="rd-detail-company-identity">
              <h1>{company.company_name || company.title}</h1>
              <p>
                {company.ticker}
                <span aria-hidden="true"> | </span>
                {company.market}
              </p>
              <p className="rd-detail-company-tagline">
                {t(
                  "공식 자료에 연결된 기업 정보",
                  "Company information connected to official sources",
                )}
              </p>
            </div>
            <button
              type="button"
              className="rd-detail-primary"
              disabled={action.busy}
              aria-pressed={data.watching}
              onClick={() =>
                void action.run(
                  async () => {
                    await request(
                      `/v1/watchlist/${encodeURIComponent(id)}`,
                      token,
                      emptySchema,
                      body(data.watching ? "DELETE" : "PUT"),
                    );
                    result.reload();
                  },
                  data.watching
                    ? t("관심 기업에서 삭제했습니다.", "Company unfollowed.")
                    : t("관심 기업에 추가했습니다.", "Company followed."),
                )
              }
            >
              <Icon name={data.watching ? "check" : "plus"} size={20} />
              {data.watching
                ? t("팔로우 중", "Following")
                : t("팔로우", "Follow")}
            </button>
          </header>
          <nav
            className="rd-detail-tabs"
            role="tablist"
            aria-label={t("기업 정보", "Company information")}
          >
            {tabs.map(([key, ko, en], index) => (
              <button
                key={key}
                id={`rd-company-${id}-${key}`}
                type="button"
                role="tab"
                aria-selected={tab === key}
                aria-controls={`rd-company-panel-${id}-${key}`}
                tabIndex={tab === key ? 0 : -1}
                onClick={() => changeTab(key)}
                onKeyDown={(event) => tabKeyboard(event, index)}
              >
                {t(ko, en)}
              </button>
            ))}
          </nav>
          <div
            role="tabpanel"
            id={`rd-company-panel-${id}-${tab}`}
            aria-labelledby={`rd-company-${id}-${tab}`}
          >
            {tab === "overview" && (
              <div className="rd-detail-overview-grid">
                <DetailPanel
                  title={t("사업 소개", "Business overview")}
                  className="rd-detail-introduction"
                >
                  {profile ? (
                    <>
                      <p className="rd-detail-prose">
                        {profile.description[locale]}
                      </p>
                      {profile.coverage && (
                        <p className="rd-detail-callout">
                          {profile.coverage[locale]}
                        </p>
                      )}
                      {sourceNotes}
                    </>
                  ) : (
                    <p className="rd-detail-empty">
                      {t(
                        "검토된 사업 소개가 아직 없습니다. 공식 기업정보와 공시를 확인하세요.",
                        "No reviewed business description is available yet. Read the official company information and disclosures.",
                      )}
                    </p>
                  )}
                </DetailPanel>
                <DetailPanel title={t("제품/서비스", "Products and services")}>
                  {profile ? (
                    <>
                      <div className="rd-detail-products">
                        {profile.products[locale].map((product, index) => (
                          <article className="rd-detail-product" key={product}>
                            <div
                              className={`rd-detail-product-symbol rd-detail-tone-${index % 4}`}
                              aria-hidden="true"
                            >
                              <Icon
                                name={
                                  (
                                    [
                                      "settings",
                                      "pie",
                                      "spark",
                                      "file",
                                    ] as IconName[]
                                  )[index % 4]
                                }
                                size={34}
                              />
                            </div>
                            <h3>{product}</h3>
                          </article>
                        ))}
                      </div>
                      {sourceNotes}
                    </>
                  ) : (
                    <p className="rd-detail-empty">
                      {t(
                        "출처가 확인된 제품 정보가 없습니다.",
                        "No sourced product information is available.",
                      )}
                    </p>
                  )}
                </DetailPanel>
                <DetailPanel title={t("사업 영역", "Business areas")}>
                  {profile ? (
                    <>
                      <div className="rd-detail-areas">
                        {profile.areas[locale].map((area, index) => (
                          <article key={area}>
                            <span
                              className={`rd-detail-area-symbol rd-detail-tone-${index % 4}`}
                              aria-hidden="true"
                            >
                              <Icon
                                name={
                                  (
                                    [
                                      "settings",
                                      "spark",
                                      "pie",
                                      "timeline",
                                    ] as IconName[]
                                  )[index % 4]
                                }
                                size={23}
                              />
                            </span>
                            <h3>{area}</h3>
                          </article>
                        ))}
                      </div>
                      <p className="rd-detail-footnote">
                        {t(
                          "제품과 활동을 기준으로 한 분류입니다. 공시의 회계 보고 부문과 다를 수 있습니다.",
                          "These categories describe products and activities and may differ from accounting reportable segments.",
                        )}
                      </p>
                    </>
                  ) : (
                    <p className="rd-detail-empty">
                      {t(
                        "검토된 사업 영역 정보가 없습니다.",
                        "No reviewed business-area information is available.",
                      )}
                    </p>
                  )}
                </DetailPanel>
                <div className="rd-detail-profile-wrap">
                  <CompanyProfile id={id} ticker={company.ticker} />
                </div>
                <DetailPanel title={t("주요 수치 정보", "Verified figures")}>
                  {facts.length ? (
                    <div className="rd-detail-table-scroll">
                      <table className="rd-detail-fact-table">
                        <caption className="rd-detail-sr-only">
                          {t(
                            "원문에서 확인된 수치와 기간",
                            "Figures and periods verified in source documents",
                          )}
                        </caption>
                        <tbody>
                          {facts.map((fact) => (
                            <tr key={fact.id}>
                              <th scope="row">
                                {labels[fact.field]
                                  ? t(...labels[fact.field])
                                  : fact.field}
                              </th>
                              <td>
                                <strong>
                                  {exactDetailValue(fact.value_raw!)}{" "}
                                  {fact.unit}
                                </strong>
                                <small>
                                  {fact.period} · {fact.basis}
                                </small>
                              </td>
                              <td>
                                <Link
                                  href={`/events/${encodeURIComponent(fact.event_id)}?panel=evidence`}
                                >
                                  {t("출처 확인", "Source evidence")} ↗
                                </Link>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="rd-detail-empty">
                      {t(
                        "기간·단위·회계 기준·인용 근거가 확인된 공개 수치가 없습니다.",
                        "No published figures with a verified period, unit, accounting basis and quotation are available.",
                      )}
                    </p>
                  )}
                </DetailPanel>
                <DetailPanel
                  title={t("최근 공시", "Recent disclosures")}
                  action={
                    <button
                      type="button"
                      className="rd-detail-text-button"
                      onClick={() => changeTab("disclosures")}
                    >
                      {t("전체 보기", "View all")} ›
                    </button>
                  }
                >
                  <DetailRows
                    items={data.documents.slice(0, 5)}
                    empty={t(
                      "수집된 공시가 아직 없습니다.",
                      "No disclosures have been collected yet.",
                    )}
                  />
                </DetailPanel>
              </div>
            )}
            {tab === "disclosures" && (
              <DetailPanel
                title={t("공식 공시", "Official disclosures")}
                action={
                  <Link
                    href={`/search?kind=document&company_id=${encodeURIComponent(id)}`}
                  >
                    {t("전체 이력 검색", "Search full history")} ›
                  </Link>
                }
              >
                <DetailRows
                  items={data.documents}
                  empty={t(
                    "이 기업의 공시가 아직 수집되지 않았습니다.",
                    "No disclosures have been collected for this company.",
                  )}
                />
              </DetailPanel>
            )}
            {tab === "analyses" && (
              <div className="rd-detail-stack">
                <DetailPanel
                  title={t("승인된 분석", "Approved analyses")}
                  action={
                    <Link
                      href={`/search?kind=analysis&company_id=${encodeURIComponent(id)}`}
                    >
                      {t("전체 보기", "View all")} ›
                    </Link>
                  }
                >
                  <p className="rd-detail-muted">
                    {t(
                      "원문의 일부를 검토한 발췌 요약입니다. 전체 보고서 분석을 의미하지 않습니다.",
                      "These are reviewed source-excerpt summaries, not analyses of the complete reports.",
                    )}
                  </p>
                  <DetailRows
                    items={data.analyses}
                    empty={t(
                      "승인된 분석이 아직 없습니다.",
                      "No approved analyses are available yet.",
                    )}
                  />
                </DetailPanel>
                {data.events.length > 0 && (
                  <DetailPanel
                    title={t("게시된 변화 분석", "Published event analyses")}
                  >
                    <DetailRows items={data.events} empty="" />
                  </DetailPanel>
                )}
              </div>
            )}
            {tab === "news" && (
              <DetailPanel title={t("기업 뉴스", "Company news")}>
                <CompanyNews
                  companyId={id}
                  companyName={company.company_name}
                />
              </DetailPanel>
            )}
            {tab === "events" && (
              <div className="rd-detail-stack">
                <DataState {...events} retry={events.reload} />
                {events.data && (
                  <>
                    <DetailPanel title={t("다가오는 일정", "Upcoming events")}>
                      <CompanyCalendarRows entries={events.data.calendar} />
                    </DetailPanel>
                    <DetailPanel title={t("지난 일정", "Past events")}>
                      <CompanyCalendarRows
                        entries={events.data.historical_calendar}
                      />
                    </DetailPanel>
                  </>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </article>
  );
}

function CompanyCalendarRows({
  entries,
}: {
  entries: z.infer<typeof sourceOverviewSchema>["calendar"];
}) {
  const { date, text: t } = usePrefs();
  return entries.length ? (
    <ul className="rd-detail-calendar-rows">
      {entries.map((entry) => (
        <li key={entry.id}>
          <span className="rd-detail-calendar-icon">
            <Icon name="calendar" size={23} />
          </span>
          <div>
            <h3>{entry.title}</h3>
            <p>
              <time dateTime={entry.occurs_on}>
                {date(entry.occurs_on, "date")}
              </time>
              {entry.source_timezone ? ` · ${entry.source_timezone}` : ""}
            </p>
            <DetailSource url={entry.source_url}>
              {t("일정 원문", "Event source")}
            </DetailSource>
          </div>
          <small>
            {t("확인", "Verified")}: {date(entry.verified_at)}
          </small>
        </li>
      ))}
    </ul>
  ) : (
    <p className="rd-detail-empty">
      {t(
        "공식 출처로 확인된 일정이 없습니다.",
        "No events have been verified from official sources.",
      )}
    </p>
  );
}
