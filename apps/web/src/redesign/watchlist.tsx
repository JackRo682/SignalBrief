"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth";
import { Icon, type IconName } from "@/components/icons";
import { useResource } from "@/components/ui";
import { body, emptySchema, request } from "@/lib/api";
import { companiesSchema, watchlistSchema } from "@/lib/contracts";
import { resourceHref, sourceOverviewSchema, type Resource } from "@/workspace/contracts";
import { usePrefs } from "@/workspace/preferences";
import { DataState, Empty, Modal, Notice, useData, useMutation } from "@/workspace/ui";
import { useCalendarData } from "./calendar-data";
import { addDays, calendarHref, dayInZone } from "./calendar-utils";
import CompanyDiscovery from "./company-discovery";
import { normalizeCompanyQuery } from "./company-search";
import { CompanyLogo as Logo } from "./ui";
import {
  compareWatchlistCompanies, matchesWatchlistFilter, nextWatchlistEvents,
  recentlyUpdatedCompanies, watchlistMonitoring, watchlistUpcoming,
  type WatchlistFilter, type WatchlistSort,
} from "./watchlist-data";
import "./personal.css";
import "./watchlist.css";

function Activity({ icon, tone, label, item, empty, loading, error }: {
  icon: IconName; tone: string; label: string; item?: Resource | null;
  empty: string; loading: boolean; error: string;
}) {
  const { date } = usePrefs();
  const available = item && !error && !loading;
  const isAnalysis = item && ["event", "us_analysis", "dart_analysis"].includes(item.kind);
  const description = isAnalysis && item.summary ? item.summary : item?.title;
  const updatedAt = isAnalysis && item.reviewed_at ? item.reviewed_at : item?.published_at;
  const precision = isAnalysis && item.reviewed_at ? "timestamp" : item?.publication_precision;
  const contents = <>
    <span className={`rd-w-tile ${tone}`}><Icon name={icon} size={18} /></span>
    <div className="rd-w-activity-body">
      <div className="rd-w-activity-top">
        <strong>{label}</strong>
        {available && <time dateTime={updatedAt ?? undefined}>{date(updatedAt ?? null, precision)}</time>}
      </div>
      <p title={available ? description : undefined}>
        {error ? "자료를 불러오지 못했습니다." : loading ? "확인 중…" : item ? description : empty}
      </p>
    </div>
  </>;
  return available
    ? <Link className="rd-w-activity" href={resourceHref(item)} aria-label={`${label} ${item.title}`}>{contents}</Link>
    : <div className="rd-w-activity">{contents}</div>;
}

const filters: ReadonlyArray<[WatchlistFilter, string]> = [
  ["all", "전체"], ["notifications", "알림 켬"], ["us", "미국"], ["kr", "한국"], ["upcoming", "일정 예정"],
];

export default function Watchlist() {
  const { token } = useAuth(), prefs = usePrefs(), action = useMutation();
  const list = useResource("/v1/watchlist", watchlistSchema);
  const overview = useData({ action: "source_overview", p: { scope: "following", days: 0 } }, sourceOverviewSchema);
  const [adding, setAdding] = useState(false), [draft, setDraft] = useState(""), [query, setQuery] = useState(""),
    [filter, setFilter] = useState(""), [filterQuery, setFilterQuery] = useState(""),
    [category, setCategory] = useState<WatchlistFilter>("all"), [sort, setSort] = useState<WatchlistSort>("latest");
  const activeQuery = adding ? query : filterQuery;
  const searchPending = activeQuery !== normalizeCompanyQuery(adding ? draft : filter);
  const catalog = useResource(
    adding || filterQuery ? `/v1/companies?q=${encodeURIComponent(activeQuery)}&limit=50` : null, companiesSchema,
  );
  useEffect(() => {
    const timeout = setTimeout(() => setQuery(normalizeCompanyQuery(draft)), 250);
    return () => clearTimeout(timeout);
  }, [draft]);
  useEffect(() => {
    const timeout = setTimeout(() => setFilterQuery(normalizeCompanyQuery(filter)), 250);
    return () => clearTimeout(timeout);
  }, [filter]);

  // Never render an all-company fallback, stale failed read, or another account's rows.
  const companies = list.error ? [] : list.data?.items ?? [];
  const ids = new Set(companies.map(company => company.id));
  const companyById = new Map(companies.map(company => [company.id, company]));
  const monitoring = watchlistMonitoring(overview.error ? [] : overview.data?.monitoring ?? [], companies);
  const today = dayInZone(new Date(), prefs.value.timezone), until = addDays(today, 365);
  const calendar = useCalendarData(list.data && !list.error ? {
    from: today, until, companyIds: [...ids].sort(), includePersonal: false,
  } : null);
  const upcoming = watchlistUpcoming(calendar.error ? [] : calendar.data?.items ?? [], companies, today, until);
  const nextEvents = nextWatchlistEvents(upcoming);
  const mutedIds = new Set(prefs.value.muted_companies);
  const normalizedFilter = normalizeCompanyQuery(filter).toLocaleLowerCase();
  const filterLookupUnresolved = Boolean(normalizedFilter) &&
    (adding || searchPending || catalog.loading || catalog.data === null || Boolean(catalog.error));
  const visible = companies.filter(company =>
    (`${company.name} ${company.ticker}`.toLocaleLowerCase().includes(normalizedFilter) ||
      (!adding && !searchPending && !catalog.error && !!catalog.data?.some(row => row.id === company.id))) &&
    matchesWatchlistFilter(company, category, mutedIds, nextEvents),
  ).sort((a, b) => compareWatchlistCompanies(a, b, sort, monitoring, nextEvents));
  const recent = recentlyUpdatedCompanies(companies, monitoring).slice(0, 4);
  const hasUndatedUpdates = [...monitoring.values()].some(row =>
    row.filing_count > 0 || row.analysis_count > 0 || row.latest_filing || row.latest_analysis,
  );
  const eventsLoading = list.loading || calendar.loading;
  const eventsError = list.error || calendar.error;
  const reload = () => {
    list.reload(); overview.reload(); calendar.reload();
    window.dispatchEvent(new Event("signalbrief:content-updated"));
  };
  const follow = async (id: string, enabled: boolean) => {
    await request(`/v1/watchlist/${encodeURIComponent(id)}`, token, emptySchema, body(enabled ? "PUT" : "DELETE"));
    reload();
  };
  const candidates = searchPending || catalog.error ? [] : (catalog.data ?? []).filter(company => adding || !ids.has(company.id));
  const picker = <>
    <DataState loading={searchPending || catalog.loading} error={catalog.error ?? ""} retry={catalog.reload} />
    <div className="rd-p-company-picker">
      {candidates.map(company => <div key={company.id}>
        <Link className="rd-p-company-identity" href={`/companies/${company.id}`}>
          <Logo ticker={company.ticker} />
          <span><strong>{company.name}</strong><small>{company.ticker} · {company.market}</small></span>
        </Link>
        <button type="button" className="rd-p-button" disabled={action.busy || ids.has(company.id)}
          onClick={() => void action.run(() => follow(company.id, true), "관심 기업에 추가했습니다.")}>
          {ids.has(company.id) ? "추가됨" : "추가"}
        </button>
      </div>)}
    </div>
    {!searchPending && <CompanyDiscovery query={activeQuery} existingCompanies={catalog.error ? [] : catalog.data ?? []}
      selectedCompanyIds={[...ids]} disabled={action.busy} selectionLabel="관심 기업에 추가" selectedLabel="추가됨"
      onSelect={async company => { await follow(company.id, true); catalog.reload(); }} />}
    {!activeQuery && !catalog.loading && catalog.data && !catalog.data.length && !catalog.error &&
      <p className="rd-p-muted">기업명이나 종목코드를 입력해 공식 기업목록을 검색하세요.</p>}
  </>;

  return <div className="rd-p-page rd-w-page" data-screen="redesign-watchlist">
    <header className="rd-p-heading rd-w-heading">
      <div><h1>관심 기업</h1><p>관심 기업의 주요 공시, 분석, 일정을 한눈에 확인하세요.</p></div>
      <button type="button" className="rd-p-button primary" onClick={() => setAdding(true)}>
        <Icon name="plus" />기업 추가
      </button>
    </header>
    <Notice action={action} />
    <DataState loading={list.loading} error={list.error ?? ""} retry={list.reload} />
    <DataState loading={false} error={prefs.error} retry={prefs.reload} />
    <div className="rd-w-layout">
      <div className="rd-w-main">
        <section className="rd-w-toolbar" aria-label="관심 기업 검색 및 필터">
          <div className="rd-w-toolbar-top">
            <label className="rd-p-search rd-w-search">
              <Icon name="search" size={19} />
              <input aria-label="관심 기업 검색" value={filter} maxLength={100} placeholder="기업명 또는 티커 검색"
                onChange={event => setFilter(event.target.value)} />
            </label>
            <label className="rd-w-sort">정렬 기준
              <select aria-label="관심 기업 정렬" value={sort} onChange={event => setSort(event.target.value as WatchlistSort)}>
                <option value="latest">업데이트 순</option><option value="name">기업명 순</option><option value="event">일정 가까운 순</option>
              </select>
            </label>
          </div>
          <div className="rd-w-filters" role="group" aria-label="관심 기업 필터">
            {filters.map(([value, label]) => <button type="button" key={value} aria-pressed={category === value}
              disabled={value === "notifications" && !prefs.loaded || value === "upcoming" && eventsLoading}
              onClick={() => setCategory(value)}>{label}</button>)}
          </div>
        </section>
        <DataState loading={false} error={overview.error} retry={overview.reload} />
        <div className="rd-w-list" aria-label="관심 기업 목록" aria-busy={list.loading}>
          {visible.map(company => {
            const row = monitoring.get(company.id), muted = mutedIds.has(company.id), next = nextEvents.get(company.id);
            const eventContents = <>
              <span className="rd-w-tile green"><Icon name="calendar" size={18} /></span>
              <div className="rd-w-activity-body">
                <div className="rd-w-activity-top"><strong>다음 일정</strong>
                  {next && <time dateTime={next.occurs_on}>{prefs.date(next.occurs_on, "date")}</time>}
                </div>
                <p title={next?.title}>{eventsLoading ? "확인 중…" : eventsError ? "일정을 불러오지 못했습니다." :
                  next?.title ?? (calendar.data?.truncated ? "표시 범위 내 예정 일정이 없습니다." : "향후 1년간 확인된 예정 일정이 없습니다.")}</p>
              </div>
            </>;
            return <article className="rd-w-card" key={company.id} aria-label={`${company.name} 관심 기업`}>
              <header className="rd-w-card-head">
                <Link className="rd-p-company-identity" href={`/companies/${company.id}`}>
                  <Logo ticker={company.ticker} />
                  <span><strong>{company.name}</strong><small>{company.ticker}<span aria-hidden="true"> ｜ </span>{company.market}</small></span>
                </Link>
                <div className="rd-p-watch-actions">
                  <span>알림 설정</span>
                  <button type="button" role="switch" className="rd-p-switch" aria-label={`${company.name} 알림`}
                    aria-checked={!muted} disabled={!prefs.loaded || prefs.busy || action.busy}
                    onClick={() => void action.run(() => prefs.save({ muted_companies: muted
                      ? prefs.value.muted_companies.filter(id => id !== company.id)
                      : [...prefs.value.muted_companies, company.id] }), "기업 알림 설정을 저장했습니다.")}><span /></button>
                  <details className="rd-p-overflow" onKeyDown={event => {
                    if (event.key === "Escape") {
                      event.currentTarget.open = false;
                      event.currentTarget.querySelector("summary")?.focus();
                    }
                  }}>
                    <summary aria-label={`${company.name} 메뉴`}>⋮</summary>
                    <div><button type="button" disabled={action.busy} aria-label={`${company.name} 팔로우 취소`}
                      onClick={() => void action.run(() => follow(company.id, false), "관심 기업에서 삭제했습니다.")}>팔로우 취소</button></div>
                  </details>
                </div>
              </header>
              <div className="rd-w-activities">
                <Activity icon="file" tone="blue" label="최신 공시" item={row?.latest_filing}
                  empty="아직 수집된 공시가 없습니다." loading={overview.loading} error={overview.error} />
                <Activity icon="timeline" tone="purple" label="최신 분석" item={row?.latest_analysis}
                  empty="아직 승인된 분석이 없습니다." loading={overview.loading} error={overview.error} />
                {next && !eventsLoading && !eventsError
                  ? <Link className="rd-w-activity" href={calendarHref(next)} aria-label={`다음 일정 ${next.title}`}>{eventContents}</Link>
                  : <div className="rd-w-activity">{eventContents}</div>}
              </div>
            </article>;
          })}
        </div>
        {list.data && !companies.length && !list.error && <Empty title="첫 관심 기업을 추가해 보세요."
          description="기업을 팔로우하면 수집된 공시와 승인된 분석을 한곳에서 확인할 수 있습니다." />}
        {list.data && companies.length > 0 && !visible.length && !list.error && !filterLookupUnresolved &&
          !(category === "upcoming" && (eventsLoading || eventsError)) && !(category === "notifications" && !prefs.loaded) &&
          <Empty title="검색 조건에 맞는 관심 기업이 없습니다." />}
        {!adding && normalizeCompanyQuery(filter) && <section className="rd-w-discovery" aria-label="관심 기업 추가 검색">
          <h2>전체 기업에서 검색</h2><p className="rd-p-muted">검색 결과에서 직접 추가한 기업만 관심 기업에 등록됩니다.</p>{picker}
        </section>}
      </div>
      <aside className="rd-w-sidebar" aria-label="관심 기업 요약">
        <section className="rd-w-panel" aria-labelledby="watchlist-upcoming-title">
          <header><h2 id="watchlist-upcoming-title">다가오는 일정</h2></header>
          <DataState loading={eventsLoading} error={eventsError} retry={list.error ? list.reload : calendar.reload} />
          {!eventsError && <div className="rd-w-side-list">
            {upcoming.slice(0, 4).map(item => <Link className="rd-w-event" key={item.id} href={calendarHref(item)}
              aria-label={`${companyById.get(item.company_id!)?.name} ${item.title} ${prefs.date(item.occurs_on, "date")}`}>
              <span className="rd-w-side-company" title={companyById.get(item.company_id!)?.name}>{companyById.get(item.company_id!)?.name}</span>
              <span className="rd-w-event-type" title={item.title}>{item.title}</span>
              <time dateTime={item.occurs_on}>{prefs.date(item.occurs_on, "date")}</time>
            </Link>)}
          </div>}
          {!eventsLoading && !eventsError && !upcoming.length && <p className="rd-w-empty">
            {companies.length ? "향후 1년간 확인된 관심 기업 일정이 없습니다." : "관심 기업을 추가하면 예정 일정을 확인할 수 있습니다."}
          </p>}
          <p className="rd-w-panel-note">향후 1년 · 확정 일정{calendar.data?.truncated ? " · 가까운 500건 기준" : ""}
            <Link href="/calendar">전체 보기 ›</Link></p>
        </section>
        <section className="rd-w-panel" aria-labelledby="watchlist-recent-title">
          <header><h2 id="watchlist-recent-title">최근 업데이트된 기업</h2></header>
          <DataState loading={list.loading || overview.loading} error={list.error || overview.error}
            retry={list.error ? list.reload : overview.reload} />
          {!list.error && !overview.error && <div className="rd-w-side-list">
            {recent.map(company => {
              const row = monitoring.get(company.id)!;
              return <Link className="rd-w-ranking" key={company.id} href={`/companies/${company.id}`}>
                <span className="rd-w-side-company" title={company.name}>{company.name}</span>
                <span className="rd-w-counts">공시 {row.filing_count.toLocaleString()}건 · 분석 {row.analysis_count.toLocaleString()}건</span>
              </Link>;
            })}
          </div>}
          {!list.loading && !overview.loading && !list.error && !overview.error && !recent.length &&
            <p className="rd-w-empty">{hasUndatedUpdates ? "업데이트 날짜를 확인할 수 있는 자료가 없습니다." : "아직 수집된 관심 기업 업데이트가 없습니다."}</p>}
          <p className="rd-w-panel-note">최신 자료순 · 누적 공시·승인 분석</p>
        </section>
      </aside>
    </div>
    {adding && <Modal title="관심 기업 추가" onClose={() => setAdding(false)}>
      <Notice action={action} />
      <label className="rd-p-search"><Icon name="search" />
        <input autoFocus aria-label="추가할 기업 검색" value={draft} maxLength={100}
          onChange={event => setDraft(event.target.value)} placeholder="기업명 또는 티커를 입력하세요." />
      </label>{picker}
    </Modal>}
  </div>;
}
