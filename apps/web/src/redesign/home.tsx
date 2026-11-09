"use client";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { useAuth } from "@/components/auth";
import { Icon, type IconName } from "@/components/icons";
import { useResource } from "@/components/ui";
import { watchlistSchema } from "@/lib/contracts";
import { companyNewsQueries, newsResponse, type NewsResponse } from "@/lib/news-contract";
import { catalogSchema, sourceOverviewSchema } from "@/workspace/contracts";
import { DataState, useData } from "@/workspace/ui";
import { useCalendarData } from "./calendar-data";
import { addDays, calendarHref } from "./calendar-utils";
import { dashboardSchema, koreaDate, rangeStart, validRange } from "./dashboard-contract";
import {
  activityDay, activityLabels, activityWhen, calendarActivity, combineActivities,
  upcomingCompanyEvents, followingActivities, newsActivities, resourceActivity,
  type ActivityKind, type HomeActivity,
} from "./home-data";
import BriefingIllustration from "./home-illustration";
import { homeSnapshotSlice, useHomeSnapshot } from "./home-snapshot";
import { CompanyLogo, Heading, More, Panel, SearchForm, formatSourceDate } from "./ui";
import "./home.css";

function useNews(company: string) {
  const { token } = useAuth(),
    [seq, setSeq] = useState(0),
    [state, setState] = useState<{
      key: string;
      data: NewsResponse | null;
      error: string;
    }>({ key: "", data: null, error: "" });
  const key = `${token}:${company}:${seq}`;
  useEffect(() => {
    if (!company || !token) return;
    let live = true;
    const controller = new AbortController();
    void fetch(`/api/news?company_id=${encodeURIComponent(company)}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(22000)]),
    })
      .then(async (r) => {
        if (!r.ok)
          throw new Error(
            r.status === 422
              ? "이 기업의 뉴스 검색은 아직 지원하지 않습니다."
              : r.status === 429
                ? "뉴스 요청 한도에 도달했습니다. 잠시 후 다시 시도해 주세요."
                : "뉴스 제공자에 연결하지 못했습니다.",
          );
        const data = newsResponse.parse(await r.json());
        if (live) setState({ key, data, error: "" });
      })
      .catch((e: unknown) => {
        if (live)
          setState({
            key,
            data: null,
            error: e instanceof Error ? e.message : "뉴스 조회 실패",
          });
      });
    return () => {
      live = false;
      controller.abort();
    };
  }, [company, token, seq, key]);
  return {
    data: state.key === key ? state.data : null,
    error: state.key === key ? state.error : "",
    loading: !!token && !!company && state.key !== key,
    reload: () => setSeq((x) => x + 1),
  };
}
const tabs = [
  ["all", "전체"], ["document", "공시"], ["analysis", "분석"],
  ["news", "뉴스"], ["calendar", "일정"],
] as const;
type ActivityTab = "all" | ActivityKind;

function ActivityLink({ item, children, className, label }: {
  item: HomeActivity; children: ReactNode; className?: string; label?: string;
}) {
  return item.external ? (
    <a href={item.href} className={className} target="_blank" rel="noopener noreferrer"
      aria-label={label ? `${label} · 새 탭에서 열기` : undefined}>{children}</a>
  ) : <Link href={item.href} className={className} aria-label={label}>{children}</Link>;
}
function Badge({ kind }: { kind: ActivityKind }) {
  return <span className="rd-home-badge" data-kind={kind}>{activityLabels[kind]}</span>;
}

export default function Home() {
  const [now] = useState(() => new Date()),
    [today] = useState(() => koreaDate(now)),
    [company, setCompany] = useState(""),
    [range, setRange] = useState({ start: rangeStart(today, 30), end: today }),
    [draft, setDraft] = useState(range),
    [rangeError, setRangeError] = useState(""),
    [tab, setTab] = useState<ActivityTab>("all"),
    [eventScope, setEventScope] = useState<"all" | "following">("all"),
    [filtersOpen, setFiltersOpen] = useState(false);
  const snapshot = useHomeSnapshot(today);
  const fallbackDirectory = useData(
    snapshot.fallback ? { action: "catalog", p: { kind: "company", limit: 50 } } : null, catalogSchema,
  );
  const defaultDashboard = !company && range.start === rangeStart(today, 30) && range.end === today;
  const filteredDashboard = useData(snapshot.fallback || !defaultDashboard ? { action: "design_dashboard", p: {
    start_date: range.start, end_date: range.end, company_id: company,
  } } : null, dashboardSchema);
  const fallbackWatchlist = useResource(snapshot.fallback ? "/v1/watchlist" : null, watchlistSchema);
  const directory = snapshot.fallback ? fallbackDirectory : homeSnapshotSlice(snapshot, "directory");
  const data = snapshot.fallback || !defaultDashboard ? filteredDashboard : homeSnapshotSlice(snapshot, "dashboard");
  const watchlist = snapshot.fallback ? fallbackWatchlist : homeSnapshotSlice(snapshot, "watchlist");
  const followed = watchlist.data && !watchlist.error ? watchlist.data.items : [];
  const fallbackOverview = useData(
    snapshot.fallback ? { action: "source_overview", p: { scope: "following", days: 0 } } : null,
    sourceOverviewSchema,
  );
  const overview = snapshot.fallback ? {
    ...fallbackOverview, data: fallbackOverview.data?.monitoring ?? null,
  } : homeSnapshotSlice(snapshot, "monitoring");
  const until = addDays(today, 30);
  const eventScopeReady = eventScope === "all" || Boolean(watchlist.data && !watchlist.error);
  const upcoming = useCalendarData(eventScopeReady ? {
    from: today, until,
    companyIds: eventScope === "following" ? followed.map((item) => item.id).sort() : undefined,
    includePersonal: false,
  } : null);
  const catalog = directory.error ? [] : directory.data?.items ?? [];
  const selected = company ? catalog.find((item) => item.id === company) :
    catalog.find((item) => followed.some((follow) => follow.id === item.id) &&
      Object.hasOwn(companyNewsQueries, item.ticker.toUpperCase())) ??
    catalog.find((item) => Object.hasOwn(companyNewsQueries, item.ticker.toUpperCase()));
  const news = useNews(selected?.id ?? "");
  const includesFollowingNews = !!selected && followed.some((item) => item.id === selected.id);
  const newsItems = newsActivities(news.error ? null : news.data, selected);
  const updates = followingActivities(overview.error ? [] : overview.data ?? [], followed, newsItems);
  const upcomingItems = upcomingCompanyEvents(upcoming.error ? [] : upcoming.data?.items ?? [],
    eventScope === "following" ? followed : null, today, until);
  const upcomingLoading = upcoming.loading || (eventScope === "following" && watchlist.loading);
  const upcomingError = (eventScope === "following" && watchlist.error) || upcoming.error;
  const recent = combineActivities(
    data.error ? [] : data.data?.filings.map((item) => resourceActivity(item, "document")) ?? [],
    data.error ? [] : data.data?.analyses.map((item) => resourceActivity(item, "analysis")) ?? [],
    data.error ? [] : data.data?.events.map(calendarActivity) ?? [],
    newsItems,
  ).filter((item) => tab === "all" || item.kind === tab);
  const visibleRecent = recent.slice(0, tab === "news" ? 5 : 3);
  const companyQuery = company ? `&company_id=${encodeURIComponent(company)}` : "";
  const moreHref = tab === "calendar" ? "/calendar" : tab === "news" && selected
    ? `/companies/${encodeURIComponent(selected.id)}?tab=news`
    : `/search?sort=newest${tab === "document" || tab === "analysis" ? `&kind=${tab}` : ""}${companyQuery}`;
  const recentLoading = (tab !== "news" && data.loading) || ((tab === "all" || tab === "news") && news.loading);
  const recentError = (tab !== "news" && data.error) || ((tab === "all" || tab === "news") && news.error);
  const recentReady = tab === "news" ? Boolean(news.data) : Boolean(data.data);
  const metrics: { title: string; count: number | null; icon: IconName; tab: ActivityKind; error: string; loading: boolean }[] = [
    { title: "기간 내 공개 공시", count: data.data?.filing_count ?? null, icon: "file", tab: "document", error: data.error, loading: data.loading },
    { title: "기간 내 승인 분석", count: data.data?.analysis_count ?? null, icon: "file", tab: "analysis", error: data.error, loading: data.loading },
    { title: "기간 내 확정 일정", count: data.data?.event_count ?? null, icon: "calendar", tab: "calendar", error: data.error, loading: data.loading },
    { title: selected ? `${selected.company_name} 뉴스` : "최신 뉴스 검색결과", count: news.data?.items.length ?? null, icon: "timeline", tab: "news", error: news.error, loading: news.loading },
  ];
  const briefingTitle = watchlist.error ? "관심 기업의 소식을 불러오지 못했습니다." :
    watchlist.loading || !watchlist.data ? "관심 기업의 주요 소식을 확인하세요." :
    followed.length ? `관심 기업 ${followed.length.toLocaleString("ko-KR")}곳의 주요 소식을 모았습니다.` : "첫 관심 기업을 추가해 보세요.";
  const dateHeading = tab === "analysis" ? "승인일" : tab === "calendar" ? "개최일" : tab === "all" ? "공개·승인·개최일" : "공개일";

  return (
    <div className="rd-home" data-screen="redesign-home">
      <Heading title="홈" description="관심 기업의 최신 공시, 분석, 일정, 뉴스를 한눈에 확인합니다." />
      {snapshot.error && <div data-home-snapshot-error><DataState loading={false} error={snapshot.error} retry={snapshot.reload} /></div>}
      <div className="rd-home-search"><SearchForm /></div>
      <div className="rd-home-overview">
        <section className="rd-home-briefing" aria-labelledby="home-briefing-title">
          <div className="rd-home-briefing-copy">
            <span className="rd-home-eyebrow">오늘의 브리프</span>
            <h2 id="home-briefing-title">{briefingTitle}</h2>
            <p>{watchlist.error ? "잠시 후 다시 시도해 주세요." : "최신 공시와 승인된 분석, 다가오는 일정을 확인해 보세요."}</p>
            <Link className="rd-btn rd-primary" href="/watchlist">
              {watchlist.data && !watchlist.error && !followed.length ? "관심 기업 추가" : "업데이트 전체 보기"}
              <span aria-hidden="true">›</span>
            </Link>
          </div>
          <BriefingIllustration />
        </section>
        <div className="rd-kpis" aria-label="조회 기간 요약">
          {metrics.map((metric) => <Link className="rd-kpi" href="#recent-activity" key={metric.tab}
            onClick={() => setTab(metric.tab)}>
            <span className="rd-kpi-icon"><Icon name={metric.icon} size={28} /></span>
            <div>
              <div className="rd-kpi-title">{metric.title}</div>
              <strong className={metric.error || metric.loading || metric.count === null ? "rd-kpi-status" : ""}>
                {metric.error ? "조회 불가" : metric.loading ? "불러오는 중" : metric.count === null ? "미제공" :
                  <>{metric.count.toLocaleString("ko-KR")}<small>건</small></>}
              </strong>
            </div><span aria-hidden="true">›</span>
          </Link>)}
        </div>
      </div>

      <div className="rd-home-panels">
        <Panel title="관심 기업 업데이트" className="rd-home-following" action={<More href="/watchlist" label="전체 보기" />}>
          <DataState loading={watchlist.loading} error={watchlist.error ?? ""} retry={watchlist.reload} />
          <DataState {...overview} loading={overview.loading && !watchlist.loading} retry={overview.reload} />
          {includesFollowingNews && <DataState {...news} loading={news.loading && !updates.length} retry={news.reload} />}
          {!!updates.length && <div className="rd-home-updates">
            {updates.slice(0, 3).map((item) => <ActivityLink item={item} key={item.key} className="rd-home-update"
              label={`${item.companyName} ${activityLabels[item.kind]} ${item.title}`}>
              <CompanyLogo ticker={item.ticker} />
              <strong className="rd-home-company">{item.companyName}</strong>
              <Badge kind={item.kind} />
              <span className="rd-home-title">{item.title}</span>
              <time className="rd-home-date" dateTime={item.date ?? undefined}>{activityWhen(item, now)}</time>
            </ActivityLink>)}
          </div>}
          {!updates.length && !watchlist.loading && !watchlist.error && !overview.loading && !overview.error && watchlist.data &&
            (!includesFollowingNews || (!news.loading && !news.error)) &&
            <p className="rd-empty">{followed.length ? "아직 수집된 최신 소식이 없습니다." : "관심 기업을 추가하면 최신 소식을 확인할 수 있습니다."}</p>}
        </Panel>
        <Panel title="다가오는 일정" className="rd-home-upcoming" action={<div className="rd-home-calendar-actions">
          <button type="button" className="rd-home-calendar-refresh" aria-label="다가오는 일정 새로고침"
            title="다가오는 일정 새로고침" disabled={upcomingLoading} onClick={() => {
              upcoming.reload();
              if (eventScope === "following") watchlist.reload();
            }}><span aria-hidden="true">↻</span></button>
          <More href="/calendar" label="전체 보기" />
        </div>}>
          <div className="rd-home-calendar-toolbar">
            <div className="rd-home-calendar-scope" role="group" aria-label="다가오는 일정 기업 범위">
              <button type="button" aria-pressed={eventScope === "all"} onClick={() => setEventScope("all")}>전체 기업</button>
              <button type="button" aria-pressed={eventScope === "following"} onClick={() => setEventScope("following")}>관심 기업</button>
            </div>
            <span>향후 30일 · 확정 일정</span>
          </div>
          <DataState loading={upcomingLoading} error={upcomingError}
            retry={eventScope === "following" && watchlist.error ? watchlist.reload : upcoming.reload} />
          {!!upcomingItems.length && <div className="rd-home-events">
            {upcomingItems.slice(0, 3).map((item) => <Link className="rd-home-event" href={calendarHref(item)} key={item.id}>
              <time className="rd-home-day" dateTime={item.occurs_on} aria-label={formatSourceDate(item.occurs_on)}>
                <span>{new Intl.DateTimeFormat("ko-KR", { weekday: "short", timeZone: "UTC" }).format(new Date(`${item.occurs_on}T00:00:00Z`))}</span>
                <strong>{item.occurs_on.slice(5).replace("-", ".")}</strong>
              </time>
              <strong className="rd-home-company">{catalog.find((c) => c.id === item.company_id)?.company_name
                || followed.find((c) => c.id === item.company_id)?.name
                || (directory.loading ? "기업명 확인 중" : "기업명 미제공")}</strong>
              <span className="rd-home-title">{item.title}</span>
              <span className="rd-home-event-meta">날짜 확정</span>
            </Link>)}
          </div>}
          {!upcomingItems.length && eventScopeReady && upcoming.data && !upcomingLoading && !upcomingError &&
            <div className="rd-empty">
              <p>{eventScope === "all" ? "앞으로 30일간 확인된 기업 일정이 없습니다." :
                followed.length ? "앞으로 30일간 확인된 관심 기업 일정이 없습니다." : "관심 기업을 추가하면 다가오는 일정을 확인할 수 있습니다."}</p>
              {eventScope === "following" && <button type="button" className="rd-more"
                onClick={() => setEventScope("all")}>전체 기업 일정 보기</button>}
            </div>}
          {upcoming.data?.truncated && <p className="rd-home-recent-note">일정이 많아 가장 가까운 일정부터 표시합니다. 캘린더에서 조회 범위를 좁혀 확인하세요.</p>}
        </Panel>
      </div>

      <section className="rd-panel rd-home-recent" id="recent-activity" aria-labelledby="home-recent-title">
        <header className="rd-panel-head">
          <h2 id="home-recent-title">최근 소식</h2>
          <div className="rd-home-tabs" role="tablist" aria-label="최근 소식 종류">
            {tabs.map(([key, label], index) => <button type="button" key={key} role="tab" id={`home-tab-${key}`}
              aria-controls="home-activity-panel" aria-selected={tab === key} tabIndex={tab === key ? 0 : -1}
              onClick={() => setTab(key)} onKeyDown={(event) => {
                if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
                event.preventDefault();
                const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 :
                  (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
                setTab(tabs[next][0]);
                document.getElementById(`home-tab-${tabs[next][0]}`)?.focus();
              }}>{label}</button>)}
          </div>
          <div className="rd-home-recent-actions">
            <button type="button" className="rd-home-filter-toggle" aria-expanded={filtersOpen}
              aria-controls="home-filters" onClick={() => setFiltersOpen((open) => !open)}>
              <Icon name="settings" size={16} /><span>조회 설정</span>
            </button>
            <More href={moreHref} label="전체 보기" />
          </div>
        </header>
        <div id="home-filters" className="rd-home-controls" hidden={!filtersOpen}>
          <div className="rd-filterbar">
            <label>기업 필터
              <select value={company} onChange={(event) => setCompany(event.target.value)}>
                <option value="">전체 기업</option>
                {catalog.map((item) => <option key={item.id} value={item.id}>{item.company_name}</option>)}
              </select>
            </label>
            <div className="rd-range">
              <strong>날짜 필터</strong>
              {([[1, "오늘"], [3, "최근 3일"], [7, "최근 1주"], [30, "최근 1개월"]] as const).map(([days, label]) =>
                <button key={days} type="button" aria-pressed={range.start === rangeStart(today, days) && range.end === today}
                  onClick={() => {
                    const next = { start: rangeStart(today, days), end: today };
                    setDraft(next); setRange(next); setRangeError("");
                  }}>{label}</button>)}
              <input type="date" aria-label="시작일" value={draft.start} max={draft.end}
                onChange={(event) => setDraft({ ...draft, start: event.target.value })} />
              <span>~</span>
              <input type="date" aria-label="종료일" value={draft.end} min={draft.start}
                onChange={(event) => setDraft({ ...draft, end: event.target.value })} />
              <button type="button" onClick={() => {
                if (!validRange(draft.start, draft.end)) {
                  setRangeError("시작일과 종료일을 확인해 주세요. 최대 366일까지 조회할 수 있습니다."); return;
                }
                setRange({ ...draft }); setRangeError("");
              }}>적용</button>
            </div>
          </div>
          {rangeError && <p role="alert" className="rd-note">{rangeError}</p>}
        </div>
        <DataState {...directory} loading={directory.loading && !visibleRecent.length} retry={directory.reload} />
        <div role="tabpanel" id="home-activity-panel" aria-labelledby={`home-tab-${tab}`} tabIndex={0}>
          {tab !== "news" && <DataState {...data} loading={data.loading && !visibleRecent.length} retry={data.reload} />}
          {(tab === "all" || tab === "news") && <div id="news"><DataState {...news} loading={news.loading && !visibleRecent.length} retry={news.reload} /></div>}
          {!!visibleRecent.length && <div className="rd-home-table-wrap">
            <table className="rd-table rd-home-table" role="table">
              <thead role="rowgroup"><tr role="row">
                <th className="rd-home-col-date" scope="col" role="columnheader">{dateHeading}</th>
                <th className="rd-home-col-company" scope="col" role="columnheader">기업명</th>
                <th className="rd-home-col-kind" scope="col" role="columnheader">구분</th>
                <th className="rd-home-col-title" scope="col" role="columnheader">제목</th>
                <th className="rd-home-col-open" scope="col" role="columnheader"><span className="rd-sr">열기</span></th>
              </tr></thead>
              <tbody role="rowgroup">{visibleRecent.map((item) => <tr key={item.key} role="row">
                <td className="rd-home-col-date" role="cell"><time dateTime={item.date ?? undefined}
                  title={item.kind === "analysis" ? "분석 승인일" : item.kind === "calendar" ? "일정 개최일" : "원문 공개일"}>
                  {formatSourceDate(activityDay(item))}</time></td>
                <td className="rd-home-col-company" role="cell"><Link href={`/companies/${encodeURIComponent(item.companyId)}`}>{item.companyName}</Link></td>
                <td className="rd-home-col-kind" role="cell"><Badge kind={item.kind} /></td>
                <td className="rd-home-col-title" role="cell"><ActivityLink item={item}>{item.title}</ActivityLink></td>
                <td className="rd-home-col-open" role="cell"><ActivityLink item={item} label={`${item.title} 열기`}><span aria-hidden="true">›</span></ActivityLink></td>
              </tr>)}</tbody>
            </table>
          </div>}
          {!visibleRecent.length && !recentLoading && !recentError && recentReady && <p className="rd-empty">조건에 맞는 자료가 없습니다.</p>}
          {(tab === "all" || tab === "news") && selected && <div className="rd-home-recent-note">
            <span>{selected.company_name} · 최신 검색</span>
            {news.data && !news.error && <>
              <span>선택 기업의 최신 검색결과 {news.data.items.length}건입니다. 공시 날짜 필터와 별도로 제공합니다.</span>
              <a href="https://www.ncloud.com/product/applicationService/NAVERAPIHUB" target="_blank" rel="noopener noreferrer">NAVER™ API HUB</a>
              <button className="rd-more rd-icon" type="button" onClick={news.reload}>새로고침</button>
            </>}
          </div>}
          {(tab === "all" || tab === "news") && !selected && !directory.loading && !directory.error && <p className="rd-home-recent-note">뉴스 검색이 연결된 기업이 없습니다.</p>}
        </div>
      </section>
      {data.data && !data.error && data.data.filing_count === 0 && data.data.analysis_count === 0 && data.data.event_count === 0 &&
        <div className="rd-note" role="status">
          <p>{range.start} ~ {range.end} 기간에 선택한 기업의 공개 자료가 없습니다. 날짜나 기업 필터를 바꾸거나 전체 이력을 확인해 주세요.</p>
          <button className="rd-more" type="button" onClick={() => {
            const next = { start: rangeStart(today, 30), end: today };
            setRange(next); setDraft(next); setCompany(""); setRangeError("");
          }}>전체 기업의 최근 1개월 보기</button>{" "}
          <Link className="rd-more" href={`/search?sort=newest${companyQuery}`}>전체 이력 보기</Link>
        </div>}
      <p className="rd-home-footnote">
        요약·최근 소식: {company ? catalog.find((item) => item.id === company)?.company_name ?? "선택 기업" : "전체 기업"} · {formatSourceDate(range.start)} ~ {formatSourceDate(range.end)}.
        공시는 원문 공개일, 분석은 승인일, 일정은 개최일 기준입니다. 시간 기준: 한국시간.
        다가오는 일정은 {eventScope === "all" ? "전체 기업" : "관심 기업"}의 향후 30일이며, 확인된 날짜만 표시합니다.
      </p>
    </div>
  );
}
