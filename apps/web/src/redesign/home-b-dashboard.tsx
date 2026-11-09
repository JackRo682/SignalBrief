"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { z } from "zod";
import { useAuth } from "@/components/auth";
import { Icon, type IconName } from "@/components/icons";
import { useResource } from "@/components/ui";
import { watchlistSchema } from "@/lib/contracts";
import { workspaceFeatures } from "@/lib/workspace-features";
import { workspace } from "@/workspace/client";
import {
  catalogSchema,
  resourceHref,
  safeSource,
  savedSchema,
  sourceOverviewSchema,
  type Resource,
} from "@/workspace/contracts";
import { useQuotes } from "@/workspace/market";
import {
  markContentNotificationRead,
  useContentNotifications,
} from "@/workspace/notification-state";
import { usePrefs } from "@/workspace/preferences";
import { DataState, Notice, useData, useMutation } from "@/workspace/ui";
import { useCalendarCoverage, useCalendarData } from "./calendar-data";
import { addDays, calendarHref } from "./calendar-utils";
import { koreaDate } from "./dashboard-contract";
import {
  activityLabels,
  activityWhen,
  followingActivities,
  resourceActivity,
  upcomingCompanyEvents,
} from "./home-data";
import {
  calendarCategory,
  documentCategory,
  documentLabel,
} from "./home-b-data";
import { useHomeBNews } from "./home-b-news";
import { homeSnapshotSlice, useHomeSnapshot } from "./home-snapshot";
import {
  compareWatchlistCompanies,
  watchlistMonitoring,
} from "./watchlist-data";
import { CompanyLogo, SaveButton, formatSourceDate } from "./ui";
import "./home-b.css";

type DashboardIcon =
  | IconName
  | "building"
  | "layers"
  | "chart"
  | "bookmark"
  | "external"
  | "news";
const extraPaths: Partial<Record<DashboardIcon, string>> = {
  building:
    "M4 21V4h12v17M2 21h20M16 10h4v11M7 7h2m3 0h1M7 11h2m3 0h1M7 15h2m3 0h1M8 21v-3h4v3",
  layers: "m12 3 10 5-10 5L2 8Zm-10 9 10 5 10-5M2 16l10 5 10-5",
  chart: "M3 13h4v8H3Zm7-6h4v14h-4Zm7-5h4v19h-4Z",
  bookmark: "M6 3h12v18l-6-4-6 4Z",
  external: "M14 3h7v7M21 3 11 13M10 5H4v15h15v-6",
  news: "M6 4h15v16H6ZM3 7v13h3M9 8h3v4H9Zm6 0h3m-3 4h3M9 16h9",
};
function DashboardIcon({
  name,
  size = 20,
}: {
  name: DashboardIcon;
  size?: number;
}) {
  return extraPaths[name] ? (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={extraPaths[name]} />
    </svg>
  ) : (
    <Icon name={name as IconName} size={size} />
  );
}
function Card({
  title,
  description,
  icon,
  href,
  className,
  children,
  id,
}: {
  title: string;
  description?: string;
  icon: DashboardIcon;
  href?: string;
  className: string;
  children: ReactNode;
  id?: string;
}) {
  return (
    <section className={`hb-card ${className}`} aria-label={title} id={id}>
      <header className="hb-card-head">
        <div className="hb-card-heading">
          <h2>
            <span className="hb-heading-icon">
              <DashboardIcon name={icon} />
            </span>
            {title}
          </h2>
          {description && <p>{description}</p>}
        </div>
        {href && (
          <Link
            className="hb-more"
            href={href}
            aria-label={`${title} 전체 보기`}
          >
            전체 보기 <Icon name="arrow" size={15} />
          </Link>
        )}
      </header>
      {children}
    </section>
  );
}
function Badge({
  children,
  tone = "blue",
}: {
  children: ReactNode;
  tone?: "blue" | "green" | "gray";
}) {
  return (
    <span className="hb-badge" data-tone={tone}>
      {children}
    </span>
  );
}
function Metric({
  title,
  count,
  icon,
  href,
  note,
  loading,
  error,
}: {
  title: string;
  count: number | null;
  icon: DashboardIcon;
  href: string;
  note?: string;
  loading: boolean;
  error?: string | null;
}) {
  return (
    <Link
      className="hb-metric"
      href={href}
      aria-label={`${title} ${error ? "조회 불가" : loading ? "불러오는 중" : count === null ? "확인 전" : count.toLocaleString("ko-KR")}`}
    >
      <span className="hb-metric-icon">
        <DashboardIcon name={icon} size={25} />
      </span>
      <div className="hb-metric-copy">
        <span>{title}</span>
        <div
          className="hb-metric-value"
          data-status={Boolean(error || loading || count === null)}
        >
          <strong>
            {error
              ? "조회 불가"
              : loading || count === null
                ? "—"
                : count.toLocaleString("ko-KR")}
          </strong>
          {note && <small>{note}</small>}
        </div>
      </div>
    </Link>
  );
}
function SourceMeta({
  item,
  now,
  analysis = false,
}: {
  item: Resource;
  now: Date;
  analysis?: boolean;
}) {
  const activity = resourceActivity(item, analysis ? "analysis" : "document");
  return (
    <span className="hb-meta">
      {analysis ? "승인된 분석" : (item.provider?.toUpperCase() ?? "공식 자료")}
      {analysis && item.coverage === "excerpt" && " · 원문 발췌"} ·{" "}
      <time dateTime={activity.date ?? undefined}>
        {activityWhen(activity, now)}
      </time>
    </span>
  );
}
function SavedRow({
  item,
  history,
  now,
  reload,
}: {
  item: Resource;
  history: boolean;
  now: Date;
  reload: () => void;
}) {
  const { token } = useAuth(),
    action = useMutation(),
    date = item.saved_at ?? null;
  const time = activityWhen(
    { ...resourceActivity(item, "document"), date, precision: "timestamp" },
    now,
  );
  return (
    <div className="hb-saved-row">
      <span className="hb-mini-icon">
        <Icon name={history ? "clock" : "file"} size={17} />
      </span>
      <Link
        className="hb-row-copy"
        href={resourceHref(item)}
        title={item.title}
      >
        <strong>
          {item.ticker ? `${item.ticker}: ` : ""}
          {item.title}
        </strong>
      </Link>
      <span className="hb-meta">
        <time dateTime={date ?? undefined}>{time}</time>
        {date && (history ? " 열람" : " 저장")}
      </span>
      <details className="hb-item-menu">
        <summary aria-label={`${item.title} 메뉴`}>
          <span aria-hidden="true">···</span>
        </summary>
        <div>
          <Link href={resourceHref(item)}>자료 열기</Link>
          {history ? (
            <Link href="/settings/appearance">열람 기록 설정</Link>
          ) : (
            item.kind !== "company" && (
              <button
                type="button"
                disabled={action.busy}
                onClick={() =>
                  void action.run(async () => {
                    if (item.kind === "company") return;
                    await workspace(
                      token,
                      {
                        action: "save",
                        p: { id: item.id, kind: item.kind, saved: false },
                      },
                      z.object({ saved: z.literal(false) }),
                    );
                    reload();
                  })
                }
              >
                저장 취소
              </button>
            )
          )}
        </div>
      </details>
      <Notice action={action} />
    </div>
  );
}
const eventTabs = [
  ["all", "향후 7일"],
  ["earnings", "실적 발표"],
  ["investor", "투자자 행사"],
  ["corporate", "기업 활동"],
  ["other", "기타"],
] as const;
const documentTabs = [
  ["all", "전체"],
  ["filing", "공시"],
  ["release", "발표자료"],
  ["presentation", "프레젠테이션"],
] as const;
const savedTabs = [
  ["analysis", "분석"],
  ["document", "문서"],
  ["history", "열람 기록"],
] as const;

/** Only B changes. Shared navigation, A/B assignment, A, and all APIs stay authoritative. */
export default function HomeB() {
  const { token } = useAuth(),
    router = useRouter(),
    preferences = usePrefs();
  const [now] = useState(() => new Date()),
    today = koreaDate(now),
    until = addDays(today, 6);
  const [eventTab, setEventTab] =
      useState<(typeof eventTabs)[number][0]>("all"),
    [documentTab, setDocumentTab] =
      useState<(typeof documentTabs)[number][0]>("all"),
    [savedTab, setSavedTab] =
      useState<(typeof savedTabs)[number][0]>("analysis"),
    [newsCompany, setNewsCompany] = useState("");
  const snapshot = useHomeSnapshot(today);
  const fallbackWatchlist = useResource(snapshot.fallback ? "/v1/watchlist" : null, watchlistSchema);
  const watchlist = snapshot.fallback ? fallbackWatchlist : homeSnapshotSlice(snapshot, "watchlist");
  const followed = watchlist.error ? [] : (watchlist.data?.items ?? []);
  const fallbackOverview = useData(
    snapshot.fallback ? { action: "source_overview", p: { scope: "following", days: 0 } } : null,
    sourceOverviewSchema,
  );
  const overview = snapshot.fallback ? {
    ...fallbackOverview, data: fallbackOverview.data?.monitoring ?? null,
  } : homeSnapshotSlice(snapshot, "monitoring");
  const fallbackDirectory = useData(
    snapshot.fallback ? { action: "catalog", p: { kind: "company", limit: 50 } } : null,
    catalogSchema,
  );
  const fallbackDocuments = useData(
    snapshot.fallback ? {
      action: "catalog",
      p: { kind: "document", days: 30, sort: "newest", limit: 50 },
    } : null,
    catalogSchema,
  );
  const fallbackAnalyses = useData(
    snapshot.fallback ? { action: "catalog", p: { kind: "analysis", sort: "newest", limit: 2 } } : null,
    catalogSchema,
  );
  const directory = snapshot.fallback ? fallbackDirectory : homeSnapshotSlice(snapshot, "directory");
  const documents = snapshot.fallback ? fallbackDocuments : homeSnapshotSlice(snapshot, "documents");
  const analyses = snapshot.fallback ? fallbackAnalyses : homeSnapshotSlice(snapshot, "analyses");
  const coverage = useCalendarCoverage(null);
  const upcoming = useCalendarData(
      { from: today, until, includePersonal: false },
      coverage.collectionRevision,
    ),
    notifications = useContentNotifications(true, { homeToday: today }),
    alertsAction = useMutation();
  const historyAllowed =
    preferences.loaded && preferences.value.history_enabled;
  const otherSaved = useData(
    (snapshot.fallback || savedTab !== "analysis") && (savedTab !== "history" || historyAllowed)
      ? { action: "saved_list", p: { kind: savedTab, sort: "newest" } }
      : null,
    savedSchema,
  );
  const saved = snapshot.fallback || savedTab !== "analysis" ? otherSaved : homeSnapshotSlice(snapshot, "saved");
  const monitoring = watchlistMonitoring(
    overview.error ? [] : (overview.data ?? []),
    followed,
  );
  const companies = [...followed]
      .sort((a, b) =>
        compareWatchlistCompanies(a, b, "latest", monitoring, new Map()),
      )
      .slice(0, 4),
    updates = followingActivities([...monitoring.values()], companies);
  const quotes = useQuotes(
      workspaceFeatures.marketData
        ? companies.map((company) => company.ticker)
        : [],
      "1m",
    ),
    quoteMap = new Map(quotes.quotes.map((quote) => [quote.symbol, quote]));
  const news = useHomeBNews(newsCompany),
    dates = upcomingCompanyEvents(
      upcoming.error ? [] : (upcoming.data?.items ?? []),
      null,
      today,
      until,
    );
  const visibleDates = dates
    .filter((item) => eventTab === "all" || calendarCategory(item) === eventTab)
    .slice(0, 4);
  const filings = (documents.error ? [] : (documents.data?.items ?? [])).filter(
      (item) => item.kind === "document" || item.kind === "filing",
    ),
    visibleDocuments = filings
      .filter(
        (item) =>
          documentTab === "all" || documentCategory(item) === documentTab,
      )
      .slice(0, 3);
  const approved = (analyses.error ? [] : (analyses.data?.items ?? []))
    .filter(
      (item) =>
        item.kind === "us_analysis" ||
        item.kind === "dart_analysis" ||
        item.kind === "event",
    )
    .slice(0, 2);
  const companyMap = new Map(
    (directory.error ? [] : (directory.data?.items ?? [])).map((item) => [
      item.id,
      { name: item.company_name || item.title, ticker: item.ticker },
    ]),
  );
  followed.forEach((company) =>
    companyMap.set(company.id, { name: company.name, ticker: company.ticker }),
  );
  const coverageData = coverage.error ? null : coverage.data;
  const coveragePercent =
    coverageData && coverageData.registered_companies > 0
      ? Math.round(
          (100 *
            Math.min(
              coverageData.covered_companies,
              coverageData.registered_companies,
            )) /
            coverageData.registered_companies,
        )
      : null;
  const reloadSaved = () => {
    if (snapshot.fallback) {
      saved.reload();
      documents.reload();
    } else {
      snapshot.reload();
      if (savedTab !== "analysis") otherSaved.reload();
    }
  };
  return (
    <div
      className="sb-home-b"
      data-home-layout="B"
      data-screen="redesign-home-b"
    >
      {snapshot.error && <div data-home-snapshot-error><DataState loading={false} error={snapshot.error} retry={snapshot.reload} /></div>}
      <div className="hb-layout">
        <div className="hb-main">
          <header className="hb-intro">
            <div>
              <h1>오늘</h1>
              <p>
                관심 기업, 다가오는 일정, 승인된 리서치를 한곳에서 확인하세요.
              </p>
            </div>
            <svg
              className="hb-waves"
              viewBox="0 0 620 100"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <path
                d="M0 100C65 102 94 49 145 66S221 100 270 63S326 49 373 68S433 41 475 56S553 90 620 12V100Z"
                fill="#eaf3ff"
              />
              <path
                d="M50 100C120 104 170 43 218 53S271 87 321 73S380 53 422 39S471 79 517 66S571 27 620 31V100Z"
                fill="#d7e8ff"
                opacity=".66"
              />
              <path
                d="M170 100C210 87 253 96 301 76S362 85 413 49S460 41 492 49S554 42 573 21S604 1 620 0V100Z"
                fill="#bdd9ff"
                opacity=".7"
              />
            </svg>
          </header>
          <div className="hb-summary" aria-label="오늘의 요약">
            <Metric
              title="관심 기업"
              icon="building"
              href="/watchlist"
              count={watchlist.data?.items.length ?? null}
              loading={watchlist.loading}
              error={watchlist.error}
            />
            <Metric
              title="다가오는 일정"
              icon="calendar"
              href="/calendar"
              count={upcoming.data ? dates.length : null}
              loading={upcoming.loading}
              error={upcoming.error}
              note={upcoming.data?.truncated ? "500건 이상" : "향후 7일"}
            />
            <Metric
              title="신규 문서"
              icon="file"
              href="/search?kind=document&days=30&sort=newest"
              count={documents.data?.total ?? null}
              loading={documents.loading}
              error={documents.error}
              note="최근 30일"
            />
            <Metric
              title="읽지 않은 알림"
              icon="bell"
              href="/alerts"
              count={notifications.data?.unread_count ?? null}
              loading={notifications.loading}
              error={notifications.error}
            />
          </div>
          <div className="hb-panels">
            <Card
              title="관심기업 업데이트"
              description="관심기업의 주요 소식과 변화를 확인하세요."
              icon="star"
              href="/watchlist"
              className="hb-following"
            >
              <DataState
                loading={watchlist.loading}
                error={watchlist.error ?? ""}
                retry={watchlist.reload}
              />
              <DataState {...overview} loading={overview.loading && !watchlist.loading} retry={overview.reload} />
              {!watchlist.error &&
                companies.map((company) => {
                  const update = updates.find(
                      (item) => item.companyId === company.id,
                    ),
                    quote = quoteMap.get(company.ticker.toUpperCase());
                  return (
                    <Link
                      className="hb-update"
                      href={
                        update?.href ??
                        `/companies/${encodeURIComponent(company.id)}`
                      }
                      key={company.id}
                    >
                      <CompanyLogo ticker={company.ticker} />
                      <span className="hb-company">
                        <strong>{company.ticker}</strong>
                        <span>{company.name}</span>
                      </span>
                      <span
                        className="hb-quote"
                        title={
                          quote
                            ? `${quote.source} · ${formatSourceDate(quote.as_of, quote.as_of.length === 10 ? "date" : "timestamp")}`
                            : undefined
                        }
                      >
                        <strong>
                          {quote?.price != null
                            ? new Intl.NumberFormat("ko-KR", {
                                style: "currency",
                                currency: quote.currency,
                                maximumFractionDigits:
                                  quote.currency === "KRW" ? 0 : 2,
                              }).format(quote.price)
                            : "—"}
                        </strong>
                        {quote?.change_pct != null ? (
                          <span
                            className="hb-change"
                            data-direction={
                              quote.change_pct > 0
                                ? "up"
                                : quote.change_pct < 0
                                  ? "down"
                                  : "flat"
                            }
                          >
                            {quote.change_pct > 0
                              ? "▲ +"
                              : quote.change_pct < 0
                                ? "▼ "
                                : ""}
                            {quote.change_pct.toFixed(2)}%
                          </span>
                        ) : (
                          <small>
                            {quotes.loading ? "시세 확인 중" : "시세 미제공"}
                          </small>
                        )}
                      </span>
                      <span className="hb-update-copy">
                        <span className="hb-update-top">
                          <Badge>
                            {update ? activityLabels[update.kind] : "확인 전"}
                          </Badge>
                          {update && (
                            <time
                              className="hb-meta"
                              dateTime={update.date ?? undefined}
                            >
                              {activityWhen(update, now)}
                            </time>
                          )}
                        </span>
                        <strong className="hb-title">
                          {update?.title ??
                            (overview.loading
                              ? "최신 소식을 불러오고 있습니다."
                              : overview.error
                                ? "최신 소식을 확인하지 못했습니다."
                                : "아직 수집된 업데이트가 없습니다.")}
                        </strong>
                      </span>
                    </Link>
                  );
                })}
              {!watchlist.loading &&
                !watchlist.error &&
                watchlist.data &&
                !followed.length && (
                  <p className="hb-empty">
                    관심 기업을 추가하면 최신 소식을 확인할 수 있습니다.{" "}
                    <Link href="/watchlist">관심 기업 추가 →</Link>
                  </p>
                )}
            </Card>
            <Card
              title="다가오는 일정"
              description="향후 예정된 실적 발표, 투자자 행사 등을 확인하세요."
              icon="calendar"
              href="/calendar"
              className="hb-calendar"
            >
              <div
                className="hb-tabs"
                role="group"
                aria-label="다가오는 일정 분류"
                title="공식 일정 제목 기준 분류"
              >
                {eventTabs.map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={eventTab === key}
                    onClick={() => setEventTab(key)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <DataState {...upcoming} retry={upcoming.reload} />
              {visibleDates.map((item) => {
                const company = item.company_id
                    ? companyMap.get(item.company_id)
                    : undefined,
                  date = new Date(`${item.occurs_on}T00:00:00Z`);
                return (
                  <Link
                    href={calendarHref(item)}
                    key={item.id}
                    className="hb-event"
                  >
                    <time className="hb-event-date" dateTime={item.occurs_on}>
                      <strong>
                        {new Intl.DateTimeFormat("ko-KR", {
                          month: "long",
                          day: "numeric",
                          timeZone: "UTC",
                        }).format(date)}
                      </strong>
                      <small>
                        (
                        {new Intl.DateTimeFormat("ko-KR", {
                          weekday: "short",
                          timeZone: "UTC",
                        }).format(date)}
                        )
                      </small>
                    </time>
                    <CompanyLogo ticker={company?.ticker ?? ""} />
                    <span className="hb-row-copy">
                      <strong>
                        {company ? `${company.ticker} — ` : ""}
                        {item.title}
                      </strong>
                      <span>
                        시간 미제공
                        {item.source_timezone
                          ? ` · ${item.source_timezone}`
                          : ""}
                      </span>
                    </span>
                    <Badge tone="green">확정</Badge>
                  </Link>
                );
              })}
              {!upcoming.loading &&
                !upcoming.error &&
                upcoming.data &&
                !visibleDates.length && (
                  <p className="hb-empty">
                    향후 7일 동안{" "}
                    {eventTab === "all"
                      ? "확정된 일정"
                      : "이 분류에 해당하는 일정"}
                    이 없습니다.{" "}
                    <Link href="/calendar">전체 캘린더 보기 →</Link>
                  </p>
                )}
              {upcoming.data?.truncated && (
                <p className="hb-meta">
                  최대 500개 일정 기준입니다. 전체 범위는 캘린더에서 확인하세요.
                </p>
              )}
            </Card>
            <Card
              title="최신 문서"
              description="최근 등록된 공시, 발표자료 등을 확인하세요."
              icon="file"
              href="/search?kind=document&sort=newest"
              className="hb-documents"
            >
              <div className="hb-tabs" role="group" aria-label="문서 유형">
                {documentTabs.map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={documentTab === key}
                    onClick={() => setDocumentTab(key)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <DataState {...documents} retry={documents.reload} />
              {visibleDocuments.map((item) => (
                <div className="hb-document" key={`${item.kind}:${item.id}`}>
                  <CompanyLogo ticker={item.ticker} />
                  <div className="hb-row-copy">
                    <Link href={resourceHref(item)} title={item.title}>
                      <strong>
                        {item.ticker} <span aria-hidden="true"> | </span>{" "}
                        {item.title}
                      </strong>
                    </Link>
                    <SourceMeta item={item} now={now} />
                  </div>
                  <Badge>{documentLabel(item)}</Badge>
                  {safeSource(item.source_url) ? (
                    <a
                      className="hb-icon-button"
                      href={safeSource(item.source_url)}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`${item.title} 원문 새 탭에서 열기`}
                    >
                      <DashboardIcon name="external" size={18} />
                    </a>
                  ) : (
                    <span
                      className="hb-icon-button"
                      title="원문 링크 미제공"
                      aria-label="원문 링크 미제공"
                    >
                      —
                    </span>
                  )}
                  <SaveButton item={item} onSaved={reloadSaved} />
                </div>
              ))}
              {!documents.loading &&
                !documents.error &&
                documents.data &&
                !visibleDocuments.length && (
                  <p className="hb-empty">
                    최근 조회한 자료에 해당 유형의 문서가 없습니다.{" "}
                    <Link href="/search?kind=document&sort=newest">
                      전체 문서 보기 →
                    </Link>
                  </p>
                )}
              {documents.data && documents.data.total > 50 && (
                <p className="hb-meta">
                  최근 30일의 최신 50개 문서에서 분류합니다.
                </p>
              )}
            </Card>
            <Card
              title="승인된 분석"
              description="검토와 승인을 마친 분석 리포트를 확인하세요."
              icon="chart"
              href="/search?kind=analysis&sort=newest"
              className="hb-analyses"
            >
              <DataState {...analyses} retry={analyses.reload} />
              {approved.map((item) => (
                <Link
                  href={resourceHref(item)}
                  className="hb-analysis"
                  key={`${item.kind}:${item.id}`}
                >
                  <CompanyLogo ticker={item.ticker} />
                  <span className="hb-row-copy">
                    <strong>
                      {item.ticker}: {item.title}
                    </strong>
                    {item.summary && (
                      <span className="hb-analysis-summary">
                        {item.summary}
                      </span>
                    )}
                    <SourceMeta item={item} now={now} analysis />
                  </span>
                  <Badge tone="green">승인 완료</Badge>
                </Link>
              ))}
              {!analyses.loading &&
                !analyses.error &&
                analyses.data &&
                !approved.length && (
                  <p className="hb-empty">아직 공개된 승인 분석이 없습니다.</p>
                )}
            </Card>
            <Card
              title="시장 / 기업 뉴스"
              description="시장 동향과 주요 기업 소식을 한눈에 확인하세요."
              icon="news"
              href={
                newsCompany
                  ? `/companies/${encodeURIComponent(newsCompany)}?tab=news`
                  : "/news"
              }
              className="hb-news"
              id="news"
            >
              <label className="hb-news-filter">
                <span className="rd-sr">뉴스 기업 선택</span>
                <select
                  className="hb-news-select"
                  aria-label="뉴스 기업 선택"
                  value={newsCompany}
                  onChange={(event) => setNewsCompany(event.target.value)}
                >
                  <option value="">시장 뉴스</option>
                  {followed.map((company) => (
                    <option key={company.id} value={company.id}>
                      {company.name}
                    </option>
                  ))}
                </select>
              </label>
              <DataState {...news} retry={news.reload} />
              {!news.error &&
                news.data?.items.slice(0, 4).map((item, index) => {
                  const href = item.originalLink ?? item.link,
                    when = activityWhen(
                      {
                        key: href,
                        kind: "news",
                        companyId: newsCompany,
                        companyName: "",
                        ticker: "",
                        title: item.title,
                        href,
                        date: item.publishedAt,
                        precision: "timestamp",
                        external: true,
                      },
                      now,
                    );
                  return (
                    <div className="hb-news-row" key={`${href}:${index}`}>
                      <span className="hb-dot" aria-hidden="true" />
                      <a
                        className="hb-row-copy"
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={item.title}
                      >
                        <strong>{item.title}</strong>
                      </a>
                      <span className="hb-meta">
                        {new URL(href).hostname.replace(/^www\./, "")} ·{" "}
                        <time dateTime={item.publishedAt}>{when}</time>
                      </span>
                    </div>
                  );
                })}
              {!news.loading &&
                !news.error &&
                news.data &&
                !news.data.items.length && (
                  <p className="hb-empty">관련 뉴스 검색결과가 없습니다.</p>
                )}
              <p className="hb-news-credit">
                <a
                  href="https://www.ncloud.com/product/applicationService/NAVERAPIHUB"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  NAVER™ 검색결과
                </a>{" "}
                · 기사 권리는 각 언론사에 있습니다.
              </p>
            </Card>
            <Card
              title="저장한 항목"
              description="저장한 분석, 문서, 열람 기록을 확인하세요."
              icon="bookmark"
              href={`/saved?tab=${savedTab}`}
              className="hb-saved"
            >
              <div
                className="hb-tabs"
                role="group"
                aria-label="저장한 항목 분류"
              >
                {savedTabs.map(([key, label]) => (
                  <button
                    type="button"
                    key={key}
                    aria-pressed={savedTab === key}
                    onClick={() => setSavedTab(key)}
                  >
                    {label}{" "}
                    <span>
                      (
                      {key === "history" &&
                      preferences.loaded &&
                      !historyAllowed
                        ? "꺼짐"
                        : saved.error || !saved.data
                          ? "—"
                          : saved.data.counts[key].toLocaleString("ko-KR")}
                      )
                    </span>
                  </button>
                ))}
              </div>
              {savedTab === "history" && !historyAllowed ? (
                <p className="hb-empty">
                  {preferences.loaded
                    ? "열람 기록 저장이 꺼져 있습니다."
                    : "열람 기록 설정을 확인하고 있습니다."}{" "}
                  <Link href="/settings/appearance">설정 보기 →</Link>
                </p>
              ) : (
                <>
                  <DataState {...saved} retry={saved.reload} />
                  {!saved.error &&
                    saved.data?.items
                      .slice(0, 3)
                      .map((item) => (
                        <SavedRow
                          key={`${item.kind}:${item.id}`}
                          item={item}
                          history={savedTab === "history"}
                          now={now}
                          reload={reloadSaved}
                        />
                      ))}
                  {!saved.loading &&
                    !saved.error &&
                    saved.data &&
                    !saved.data.items.length && (
                      <p className="hb-empty">
                        {savedTab === "history"
                          ? "최근 열람한 항목이 없습니다."
                          : `저장한 ${savedTab === "analysis" ? "분석" : "문서"}가 없습니다.`}{" "}
                        <Link href={`/saved?tab=${savedTab}`}>
                          저장 화면 보기 →
                        </Link>
                      </p>
                    )}
                </>
              )}
            </Card>
          </div>
        </div>
        <aside className="hb-sidebar" aria-label="커버리지와 알림">
          <Card
            title="커버리지 현황"
            description="등록 기업의 공식 일정 소스 현황입니다."
            icon="layers"
            className="hb-coverage"
          >
            <DataState {...coverage} retry={coverage.reload} />
            <div className="hb-coverage-value">
              {coveragePercent === null ? "—" : `${coveragePercent}%`}
            </div>
            <div
              className="hb-progress"
              role="progressbar"
              aria-label="공식 일정 소스 확인 비율"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={coveragePercent ?? undefined}
              aria-valuetext={
                coveragePercent === null ? "확인 전" : `${coveragePercent}%`
              }
            >
              <span style={{ width: `${coveragePercent ?? 0}%` }} />
            </div>
            <div className="hb-coverage-list">
              <div>
                <span className="hb-dot" data-state="current" />
                <strong>소스 확인</strong>
                <span>
                  {coverageData
                    ? `${coverageData.covered_companies}개 기업`
                    : "—"}
                </span>
              </div>
              <div>
                <span className="hb-dot" data-state="updating" />
                <strong>업데이트 중</strong>
                <span>
                  {coverageData
                    ? `${coverageData.pending_companies}개 기업`
                    : "—"}
                </span>
              </div>
              <div>
                <span className="hb-dot" data-state="review" />
                <strong>확인 필요</strong>
                <span>
                  {coverageData
                    ? `${Math.max(0, coverageData.registered_companies - coverageData.covered_companies)}개 기업`
                    : "—"}
                </span>
              </div>
            </div>
            {coverageData && (
              <div
                className="hb-coverage-note"
                data-state={coveragePercent === 100 ? "ok" : "warning"}
              >
                <Icon
                  name={coveragePercent === 100 ? "check" : "clock"}
                  size={18}
                />
                <span>
                  {coverageData.registered_companies === 0
                    ? "등록된 기업이 없습니다."
                    : coveragePercent === 100
                      ? "모든 등록 기업에 공식 일정 소스가 연결되어 있습니다."
                      : "일부 기업의 공식 일정 소스 확인이 필요합니다."}
                </span>
              </div>
            )}
            <p className="hb-coverage-caption">
              등록된 공식 소스 기준이며 최신성 보장은 아닙니다. 업데이트 중인 기업은
              다른 상태에도 포함될 수 있습니다.
            </p>
          </Card>
          <Card title="알림" icon="bell" href="/alerts" className="hb-alerts">
            <DataState {...notifications} retry={notifications.reload} />
            <Notice action={alertsAction} />
            {!notifications.error &&
              notifications.data?.items.slice(0, 4).map((item) => (
                <Link
                  href={resourceHref(item.resource)}
                  className="hb-alert"
                  data-unread={!item.read_at}
                  key={item.id}
                  aria-disabled={alertsAction.busy}
                  onAuxClick={(event) => {
                    if (event.button === 1 && !item.read_at)
                      void alertsAction.run(
                        () => markContentNotificationRead(token, item.id),
                        "", { invalidateCache: false },
                      );
                  }}
                  onClick={(event) => {
                    if (
                      event.metaKey ||
                      event.ctrlKey ||
                      event.shiftKey ||
                      event.altKey ||
                      event.button !== 0
                    ) {
                      if (!item.read_at)
                        void alertsAction.run(
                          () => markContentNotificationRead(token, item.id),
                          "", { invalidateCache: false },
                        );
                      return;
                    }
                    event.preventDefault();
                    void alertsAction.run(async () => {
                      if (!item.read_at)
                        await markContentNotificationRead(token, item.id);
                      router.push(resourceHref(item.resource));
                    }, "", { invalidateCache: false });
                  }}
                >
                  <span
                    className="hb-alert-icon"
                    data-tone={
                      item.resource.kind.endsWith("analysis") ? "green" : "blue"
                    }
                  >
                    <Icon
                      name={
                        item.resource.kind.endsWith("analysis")
                          ? "check"
                          : item.resource.kind === "event"
                            ? "calendar"
                            : "file"
                      }
                      size={21}
                    />
                  </span>
                  <span className="hb-row-copy">
                    <strong>
                      {item.resource.ticker} {item.resource.title}
                    </strong>
                    <span className="hb-alert-summary">
                      {item.resource.summary || "새 자료가 등록되었습니다."}
                    </span>
                  </span>
                  <span className="hb-alert-meta">
                    <time dateTime={item.created_at}>
                      {activityWhen(
                        {
                          ...resourceActivity(item.resource, "document"),
                          date: item.created_at,
                          precision: "timestamp",
                        },
                        now,
                      )}
                    </time>
                    {!item.read_at && (
                      <span className="hb-dot" aria-label="읽지 않음" />
                    )}
                  </span>
                </Link>
              ))}
            {!notifications.loading &&
              !notifications.error &&
              notifications.data &&
              !notifications.data.items.length && (
                <p className="hb-empty">
                  새 알림이 없습니다. 관심 기업의 새 자료가 등록되면 표시됩니다.
                </p>
              )}
          </Card>
        </aside>
      </div>
    </div>
  );
}
