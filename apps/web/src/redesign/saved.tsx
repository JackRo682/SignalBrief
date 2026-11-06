"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { z } from "zod";
import { useAuth } from "@/components/auth";
import { Icon } from "@/components/icons";
import { initializeSupabase } from "@/lib/supabase";
import { workspace } from "@/workspace/client";
import {
  catalogSchema,
  resourceHref,
  savedSchema,
  type Resource,
} from "@/workspace/contracts";
import { usePrefs } from "@/workspace/preferences";
import {
  DataState,
  Empty,
  Modal,
  Notice,
  useData,
  useMutation,
} from "@/workspace/ui";
import {
  calendarEntrySchema,
  calendarHref,
  type CalendarEntry,
} from "./calendar-utils";
import { CompanyLogo as Logo } from "./ui";
import "./personal.css";
import "./saved.css";

type Section = "analysis" | "event" | "document" | "history";
const savedCompanySchema = z.object({ id: z.string().uuid(), name: z.string(), ticker: z.string() });
type SavedCompany = z.infer<typeof savedCompanySchema>;
const savedCalendarSchema = calendarEntrySchema.extend({ company: savedCompanySchema.nullable().optional() });
const sections: {
  key: Section;
  label: string;
  icon: "file" | "calendar" | "star" | "clock";
}[] = [
  { key: "analysis", label: "저장한 분석", icon: "file" },
  { key: "event", label: "저장한 일정", icon: "calendar" },
  { key: "document", label: "북마크 문서", icon: "star" },
  { key: "history", label: "최근 본 항목", icon: "clock" },
];

function sectionFromLocation(): Section {
  const url = new URL(window.location.href);
  const query = url.searchParams.get("tab");
  const legacyHash = url.hash.replace(/^#rd-saved-/, "");
  return sections.find((section) => section.key === query)?.key
    ?? sections.find((section) => section.key === legacyHash)?.key
    ?? "analysis";
}

function Bookmark({ filled = true }: { filled?: boolean }) {
  return (
    <svg
      width="21"
      height="24"
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="1.7"
      aria-hidden="true"
    >
      <path d="M6 3h12v18l-6-4-6 4V3Z" />
    </svg>
  );
}

function useSavedDates() {
  const { token } = useAuth(),
    [revision, setRevision] = useState(0);
  const [state, setState] = useState<{
    token: string | null;
    data: { items: CalendarEntry[]; unavailableIds: string[]; companies: SavedCompany[] } | null;
    loading: boolean;
    error: string;
  }>({ token: null, data: null, loading: false, error: "" });
  const reload = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    let alive = true;
    if (!token) {
      setState({ token, data: null, loading: false, error: "" });
      return;
    }
    setState({ token, data: null, loading: true, error: "" });
    void (async () => {
      try {
        const db = await initializeSupabase();
        const response = await db
          .rpc("sb_reference_reminders", { p: { action: "list" } })
          .abortSignal(
            AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]),
          );
        if (response.error)
          throw new Error("저장한 일정을 불러오지 못했습니다.");
        const ids = z
          .array(z.object({ calendar_id: z.string().uuid() }))
          .parse(response.data)
          .map((item) => item.calendar_id);
        const items: CalendarEntry[] = [];
        const companies: SavedCompany[] = [];
        // Bound each query rather than silently losing items at the REST row cap.
        for (let offset = 0; offset < ids.length; offset += 100) {
          const result = await db
            .from("calendar_items")
            .select(
              "id,title,occurs_on,company_id,event_id,origin,quote,source_url,source_timezone,verified_at,company:companies(id,name,ticker)",
            )
            .in("id", ids.slice(offset, offset + 100))
            .eq("calendar_status", "confirmed")
            .abortSignal(
              AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]),
            );
          if (result.error)
            throw new Error("저장한 일정의 상세 정보를 불러오지 못했습니다.");
          const rows = z.array(savedCalendarSchema).parse(result.data);
          for (const row of rows) {
            if (row.company && row.company.id !== row.company_id)
              throw new Error("저장한 일정의 기업 정보를 확인하지 못했습니다.");
            if (row.company) companies.push(row.company);
            items.push(row);
          }
        }
        const visible = new Set(items.map((item) => item.id));
        if (alive)
          setState({
            token,
            data: {
              items,
              companies,
              unavailableIds: ids.filter((id) => !visible.has(id)),
            },
            loading: false,
            error: "",
          });
      } catch (error) {
        if (alive)
          setState({
            token,
            data: null,
            loading: false,
            error:
              error instanceof Error && error.message.startsWith("저장한")
                ? error.message
                : "저장한 일정의 연결 상태를 확인해 주세요.",
          });
      }
    })();
    return () => {
      alive = false;
      controller.abort();
    };
  }, [token, revision]);
  const current = state.token === token;
  return {
    data: current ? state.data : null,
    loading: Boolean(token && (!current || state.loading)),
    error: current ? state.error : "",
    reload,
  };
}

function CalendarRemoveButton({
  id,
  title,
  reload,
}: {
  id: string;
  title: string;
  reload: () => void;
}) {
  const action = useMutation();
  return (
    <span className="rd-p-save-action">
      <button
        className="rd-p-icon-button rd-p-bookmark"
        aria-label={`${title} 일정 저장 취소`}
        aria-pressed="true"
        disabled={action.busy}
        onClick={() =>
          void action.run(async () => {
            const db = await initializeSupabase();
            const response = await db
              .rpc("sb_reference_reminders", {
                p: { action: "set", calendar_id: id, enabled: false },
              })
              .abortSignal(AbortSignal.timeout(20000));
            if (response.error)
              throw new Error(
                "일정 저장을 취소하지 못했습니다. 다시 시도해 주세요.",
              );
            z.object({
              saved: z.literal(true),
              delivery: z.literal("saved_interest_only"),
            }).parse(response.data);
            reload();
          })
        }
      >
        <Bookmark />
      </button>
      {action.error && (
        <small role="alert" className="rd-p-inline-error">
          {action.error}
        </small>
      )}
    </span>
  );
}

function SavedCalendarItem({
  item,
  reload,
  companyName,
}: {
  item: CalendarEntry;
  reload: () => void;
  companyName: string;
}) {
  const { date } = usePrefs();
  return (
    <article>
      <span className="rd-p-tile green">
        <Icon name="calendar" />
      </span>
      <div>
        <Link href={calendarHref(item)} className="rd-p-card-title">
          {item.title}
        </Link>
        <p>
          {companyName} · {date(item.occurs_on, "date")}
        </p>
      </div>
      <CalendarRemoveButton id={item.id} title={item.title} reload={reload} />
    </article>
  );
}

/** Uses the existing owner-scoped save API; changes become visible only after persistence. */
function SaveButton({ item, reload, labeled = false }: { item: Resource; reload: () => void; labeled?: boolean }) {
  const { token } = useAuth(),
    action = useMutation();
  if (item.kind === "company") return null;
  const kind = item.kind;
  return (
    <span className="rd-p-save-action">
      <button
        type="button"
        className={labeled ? "rd-p-button" : "rd-p-icon-button rd-p-bookmark"}
        aria-label={`${item.title} ${item.is_saved ? "저장 취소" : "저장"}`}
        aria-pressed={item.is_saved}
        disabled={action.busy}
        onClick={() =>
          void action.run(async () => {
            await workspace(
              token,
              {
                action: "save",
                p: { id: item.id, kind, saved: !item.is_saved },
              },
              z.object({ saved: z.boolean() }),
            );
            reload();
          })
        }
      >
        <Bookmark filled={item.is_saved} />
        {labeled && <span>{item.is_saved ? "저장 취소" : "저장"}</span>}
      </button>
      {action.error && (
        <small role="alert" className="rd-p-inline-error">
          {action.error}
        </small>
      )}
    </span>
  );
}

function SaveDiscovery({ kind, reload }: { kind: "analysis" | "document"; reload: () => void }) {
  const result = useData({ action: "catalog", p: { kind, sort: "newest", limit: 3 } }, catalogSchema);
  const { date } = usePrefs();
  const kinds = kind === "analysis" ? ["event", "us_analysis", "dart_analysis"] : ["filing", "document"];
  const items = result.data?.items.filter(item => kinds.includes(item.kind) && !item.is_saved) ?? [];
  return (
    <section className="rd-saved-discovery" aria-labelledby={`rd-save-discovery-title-${kind}`}>
      <header className="rd-p-section-head">
        <h3 id={`rd-save-discovery-title-${kind}`}>저장할 자료 찾기</h3>
        <Link className="rd-p-link" href={kind === "analysis" ? "/search?kind=analysis" : "/search?kind=filing"}>
          전체 보기 <Icon name="arrow" size={16} />
        </Link>
      </header>
      <p className="rd-p-muted">{kind === "analysis" ? "최근 공개된 분석" : "최근 공시·문서"}입니다. 저장을 누르면 내 목록에 추가됩니다.</p>
      <DataState {...result} retry={result.reload} />
      <div className="rd-saved-resource-list">
        {items.map(item => <article key={`${item.kind}:${item.id}`} className="rd-saved-resource">
          <Logo ticker={item.ticker} />
          <div className="rd-saved-resource-body">
              <div className="rd-saved-meta"><span>{item.company_name}</span><span>{item.ticker}</span></div>
              <Link className="rd-p-card-title" href={resourceHref(item)}>{item.title}</Link>
              {item.summary && <p>{item.summary}</p>}
              <footer>{item.kind === "event" ? "검토된 분석" : item.kind.endsWith("analysis") ? "승인된 분석" : "공식 문서"} · {date(item.published_at, item.publication_precision)}</footer>
          </div>
          <SaveButton item={item} labeled reload={reload} />
        </article>)}
      </div>
      {result.data && !result.error && !items.length && <p className="rd-p-muted">지금 표시할 공개 자료가 없습니다.</p>}
    </section>
  );
}

function SavedSection({
  id,
  title,
  icon,
  total,
  active,
  expanded,
  toggle,
  children,
}: {
  id: Section;
  title: string;
  icon: "file" | "calendar" | "star" | "clock";
  total: number | null;
  active: boolean;
  expanded: boolean;
  toggle: () => void;
  children: ReactNode;
}) {
  return (
    <section
      id={`rd-saved-${id}`}
      className="rd-p-saved-section"
      role="tabpanel"
      hidden={!active}
      tabIndex={0}
      aria-labelledby={`rd-saved-tab-${id}`}
    >
      <header className="rd-p-section-head">
        <h2 id={`rd-saved-title-${id}`}>
          <Icon name={icon} />
          {title}
          {total !== null && <span className="rd-saved-total">{total}개</span>}
        </h2>
        {(total ?? 0) > (id === "analysis" ? 3 : 4) && (
          <button className="rd-p-link" onClick={toggle}>
            {expanded ? "접기" : "더보기"}
            <Icon name="arrow" size={16} />
          </button>
        )}
      </header>
      {children}
    </section>
  );
}

export default function Saved() {
  const { token } = useAuth();
  return (
    <Suspense fallback={<p role="status">저장 항목을 불러오는 중…</p>}>
      <SavedContent key={token ?? "signed-out"} />
    </Suspense>
  );
}

function SavedContent() {
  const { token } = useAuth(),
    prefs = usePrefs(),
    action = useMutation();
  const routeQuery = useSearchParams().toString();
  const [active, setActive] = useState<Section>("analysis"),
    [query, setQuery] = useState(""),
    [draft, setDraft] = useState(""),
    [company, setCompany] = useState(""),
    [sort, setSort] = useState<"newest" | "oldest">("newest"),
    [manage, setManage] = useState(false),
    [expanded, setExpanded] = useState<Section[]>([]);
  const tabRefs = useRef<Partial<Record<Section, HTMLButtonElement | null>>>({});
  useEffect(() => {
    const syncSection = () => setActive(sectionFromLocation());
    syncSection();
    window.addEventListener("popstate", syncSection);
    window.addEventListener("hashchange", syncSection);
    return () => {
      window.removeEventListener("popstate", syncSection);
      window.removeEventListener("hashchange", syncSection);
    };
  }, [routeQuery]);
  const selectSection = (key: Section) => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("tab") !== key || url.hash) {
      url.searchParams.set("tab", key);
      url.hash = "";
      // Native history integrates with the App Router without scrolling or
      // remounting the archive; Back and detail-return retain the selected tab.
      window.history.pushState(null, "", `${url.pathname}${url.search}`);
    }
    setActive(key);
  };
  const saved = useData(
    { action: "saved_list", p: { kind: "", sort } },
    savedSchema,
  );
  const history = useData(
    { action: "saved_list", p: { kind: "history", sort } },
    savedSchema,
  );
  const dates = useSavedDates();
  const reload = () => {
    saved.reload();
    history.reload();
  };
  const toggle = (key: Section) =>
    setExpanded((current) =>
      current.includes(key)
        ? current.filter((x) => x !== key)
        : [...current, key],
    );
  // The owner-scoped API returns the complete bounded archive: at most 500
  // bookmarks and 100 history rows. Filtering it retains every saved company,
  // including issuers outside the first page of the global directory.
  const normalize = (value: string) => value.normalize("NFKC").trim().toLocaleLowerCase();
  const matches = (item: Resource) => (!company || item.company_id === company)
    && (!query || normalize(`${item.title} ${item.company_name} ${item.ticker}`).includes(normalize(query)));
  const items = (saved.data?.items ?? []).filter(matches);
  // Published legacy events are reviewed analyses; calendar interests are separate records.
  const analyses = items.filter(
    (item) =>
      item.kind === "event" ||
      item.kind === "us_analysis" ||
      item.kind === "dart_analysis",
  );
  const documents = items.filter(
    (item) => item.kind === "filing" || item.kind === "document",
  );
  const hasFilters = Boolean(query || company);
  const visits = (history.data?.items ?? []).filter(matches);
  const dateCompanies = new Map<string, SavedCompany>();
  for (const item of [...(saved.data?.items ?? []), ...(history.data?.items ?? [])]) {
    if (item.company_id) dateCompanies.set(item.company_id, { id: item.company_id, name: item.company_name || item.title, ticker: item.ticker });
  }
  for (const item of dates.data?.companies ?? []) dateCompanies.set(item.id, item);
  const companies = [...dateCompanies.values()].sort((a, b) => a.name.localeCompare(b.name));
  const calendarItems = (dates.data?.items ?? [])
    .filter(
      (item) =>
        (!company || item.company_id === company) &&
        (!query ||
          normalize(`${item.title} ${dateCompanies.get(item.company_id ?? "")?.name ?? ""} ${dateCompanies.get(item.company_id ?? "")?.ticker ?? ""}`)
            .includes(normalize(query))),
    )
    .sort((a, b) =>
      sort === "newest"
        ? b.occurs_on.localeCompare(a.occurs_on)
        : a.occurs_on.localeCompare(b.occurs_on),
    );
  const unavailableDates =
    !company && !query ? (dates.data?.unavailableIds ?? []) : [];
  const visibleCalendarItems = expanded.includes("event") ? calendarItems : calendarItems.slice(0, 4);
  const visibleUnavailableDates = expanded.includes("event")
    ? unavailableDates
    : unavailableDates.slice(0, Math.max(0, 4 - visibleCalendarItems.length));
  const totals: Record<Section, number | null> = {
    analysis: saved.data && !saved.error ? analyses.length : null,
    document: saved.data && !saved.error ? documents.length : null,
    history: history.data && !history.error ? visits.length : null,
    event: dates.data && !dates.error ? calendarItems.length + unavailableDates.length : null,
  };
  const page = (list: Resource[], key: Section, limit = 4) =>
    expanded.includes(key) ? list : list.slice(0, limit);
  const track = (item: Resource) => {
    if (prefs.value.history_enabled)
      void workspace(
        token,
        { action: "visit", p: { kind: item.kind, id: item.id } },
        z.unknown(),
      ).catch(() => {});
  };

  return (
    <div className="rd-p-page" data-screen="redesign-saved">
      <header className="rd-p-heading">
        <div>
          <h1>저장</h1>
          <p>다시 보고 싶은 분석, 일정, 문서를 한곳에 모아 보세요.</p>
        </div>
        <button className="rd-p-button rd-saved-manage" type="button" onClick={() => setManage(true)}>
          <Icon name="settings" size={17} />기록 관리
        </button>
      </header>
      <Notice action={action} />
      <div className="rd-p-saved-tabs" role="tablist" aria-label="저장 항목">
        {sections.map((section, index) => (
          <button
            key={section.key}
            ref={(node) => { tabRefs.current[section.key] = node; }}
            id={`rd-saved-tab-${section.key}`}
            type="button"
            role="tab"
            className={active === section.key ? "active" : ""}
            aria-selected={active === section.key}
            aria-controls={`rd-saved-${section.key}`}
            tabIndex={active === section.key ? 0 : -1}
            onClick={() => selectSection(section.key)}
            onKeyDown={(event) => {
              const nextIndex = event.key === "ArrowRight" ? (index + 1) % sections.length
                : event.key === "ArrowLeft" ? (index + sections.length - 1) % sections.length
                  : event.key === "Home" ? 0 : event.key === "End" ? sections.length - 1 : null;
              if (nextIndex === null) return;
              event.preventDefault();
              const next = sections[nextIndex].key;
              selectSection(next);
              // Let the browser reveal the focused tab inside the mobile strip.
              tabRefs.current[next]?.focus();
            }}
          >
            <Icon name={section.icon} />
            <span>{section.label}</span>
            {totals[section.key] !== null && <span className="rd-saved-tab-count" aria-hidden="true">{totals[section.key]}</span>}
          </button>
        ))}
      </div>
      <form
        className="rd-p-filter-panel"
        onSubmit={(event) => {
          event.preventDefault();
          setQuery(draft.trim());
        }}
      >
        <label>
          정렬
          <select
            aria-label="저장 항목 정렬"
            value={sort}
            onChange={(event) => setSort(event.target.value as typeof sort)}
          >
            <option value="newest">{active === "event" ? "일정 날짜 최신순" : "최신순"}</option>
            <option value="oldest">{active === "event" ? "일정 날짜 오래된 순" : "오래된 순"}</option>
          </select>
        </label>
        <label>
          회사
          <select
            aria-label="저장 항목 회사"
            value={company}
            onChange={(event) => setCompany(event.target.value)}
          >
            <option value="">전체 회사</option>
            {companies.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label className="rd-p-grow">
          키워드
          <input
            aria-label="저장 항목 키워드"
            placeholder="키워드로 검색하세요."
            value={draft}
            maxLength={100}
            onChange={(event) => setDraft(event.target.value)}
          />
        </label>
        <button className="rd-p-button" type="submit">
          <Icon name="search" size={17} />
          검색
        </button>
        {hasFilters && (
          <button
            className="rd-p-button"
            type="button"
            onClick={() => {
              setQuery("");
              setDraft("");
              setCompany("");
            }}
          >
            저장 필터 초기화
          </button>
        )}
      </form>
      <div className="rd-p-saved-stack">
        <SavedSection
          id="analysis"
          title="저장한 분석"
          icon="file"
          total={totals.analysis}
          active={active === "analysis"}
          expanded={expanded.includes("analysis")}
          toggle={() => toggle("analysis")}
        >
          <DataState {...saved} retry={saved.reload} />
          <div className="rd-saved-resource-list">
            {page(analyses, "analysis", 3).map((item) => (
              <article
                key={`${item.kind}:${item.id}`}
                className="rd-saved-resource"
              >
                <Logo ticker={item.ticker} />
                <div className="rd-saved-resource-body">
                <div className="rd-saved-meta">
                  <Link
                    href={`/companies/${item.company_id}`}
                  >
                    <strong>{item.company_name}</strong>
                  </Link>
                  <span>{item.ticker}</span>
                </div>
                <Link
                  href={resourceHref(item)}
                  className="rd-p-card-title"
                  onClick={() => track(item)}
                >
                  {item.title}
                </Link>
                {item.summary && <p>{item.summary}</p>}
                <div className="rd-p-tags">
                  <span>{item.kind === "event" ? "검토된 분석" : "승인된 분석"}</span>
                  {item.category && <span>{item.category}</span>}
                  {item.coverage === "excerpt" && <span>발췌 분석</span>}
                </div>
                <footer>
                  <time dateTime={item.published_at ?? undefined}>
                    {prefs.date(item.published_at, item.publication_precision)}
                  </time>
                  {item.provider && <> · {item.provider.toUpperCase()}</>}
                </footer>
                </div>
                <SaveButton item={item} reload={reload} />
              </article>
            ))}
          </div>
          {saved.data && !analyses.length && !saved.error && (
            <Empty
              title={
                hasFilters
                  ? "조건에 맞는 저장한 분석이 없습니다."
                  : "저장한 분석이 없습니다."
              }
              description={
                hasFilters
                  ? "키워드나 회사 필터를 바꾸거나 초기화해 보세요."
                  : "공개된 분석에서 저장 버튼을 눌러 모아 보세요."
              }
              href={hasFilters ? undefined : "/search?kind=analysis"}
              label="분석 찾아보기"
            />
          )}
          {active === "analysis" && !hasFilters && saved.data && !saved.error && !saved.loading && !analyses.length && <SaveDiscovery kind="analysis" reload={reload} />}
        </SavedSection>
        <SavedSection
          id="document"
          title="북마크 문서"
          icon="star"
          total={totals.document}
          active={active === "document"}
          expanded={expanded.includes("document")}
          toggle={() => toggle("document")}
        >
          <DataState {...saved} retry={saved.reload} />
          {documents.length > 0 && <div className="rd-p-table-scroll">
            <table className="rd-p-saved-table">
              <thead>
                <tr>
                  <th>제목</th>
                  <th>회사</th>
                  <th>문서 유형</th>
                  <th>작성일</th>
                  <th>파일 형식</th>
                  <th>
                    <span className="rd-p-sr-only">저장 관리</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {page(documents, "document").map((item) => (
                  <tr key={`${item.kind}:${item.id}`}>
                    <td>
                      <Link
                        href={resourceHref(item)}
                        onClick={() => track(item)}
                      >
                        <Icon name="file" size={20} />
                        {item.title}
                      </Link>
                    </td>
                    <td>{item.company_name}</td>
                    <td>
                      <span className="rd-p-badge">
                        {item.category || "공식 자료"}
                      </span>
                    </td>
                    <td>
                      <time dateTime={item.published_at ?? undefined}>
                        {prefs.date(
                          item.published_at,
                          item.publication_precision,
                        )}
                      </time>
                    </td>
                    <td>
                      <Link className="rd-p-link" href={resourceHref(item)}>
                        원문 확인
                      </Link>
                    </td>
                    <td>
                      <SaveButton item={item} reload={reload} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>}
          {saved.data && !documents.length && !saved.error && (
            <Empty
              title={
                hasFilters
                  ? "조건에 맞는 북마크 문서가 없습니다."
                  : "북마크한 문서가 없습니다."
              }
              description={
                hasFilters
                  ? "키워드나 회사 필터를 바꾸거나 초기화해 보세요."
                  : "공시 상세에서 저장 버튼을 눌러 모아 보세요."
              }
              href={hasFilters ? undefined : "/search?kind=filing"}
              label="공시 찾아보기"
            />
          )}
          {active === "document" && !hasFilters && saved.data && !saved.error && !saved.loading && !documents.length && <SaveDiscovery kind="document" reload={reload} />}
        </SavedSection>
        <SavedSection
          id="history"
          title="최근 본 항목"
          icon="clock"
          total={totals.history}
          active={active === "history"}
          expanded={expanded.includes("history")}
          toggle={() => toggle("history")}
        >
          <DataState {...history} retry={history.reload} />
          {!prefs.value.history_enabled && (
            <p className="rd-p-muted">
              방문 기록 저장이 꺼져 있습니다.{" "}
              <Link className="rd-p-link" href="/settings/account">
                계정 설정에서 변경
              </Link>
            </p>
          )}
          <div className="rd-p-history-grid">
            {page(visits, "history").map((item) => (
              <Link
                className="rd-p-history-card"
                key={`${item.kind}:${item.id}`}
                href={resourceHref(item)}
                onClick={() => track(item)}
              >
                <Logo ticker={item.ticker} />
                <span>
                  <strong>{item.company_name || item.title}</strong>
                  <small>
                    {item.kind === "company"
                      ? "기업 개요"
                      : item.kind === "event"
                        ? "이벤트"
                        : item.kind.endsWith("analysis")
                          ? "승인된 분석"
                          : "공식 자료"}
                  </small>
                  <span className="rd-p-history-title">
                    {item.kind === "company" ? item.ticker : item.title}
                  </span>
                </span>
                <time dateTime={item.saved_at}>
                  {prefs.date(item.saved_at ?? item.published_at)}
                </time>
                <Icon name="arrow" size={16} />
              </Link>
            ))}
          </div>
          {history.data && !visits.length && !history.error && (
            <Empty title="최근 본 항목이 없습니다." />
          )}
        </SavedSection>
        <SavedSection
          id="event"
          title="저장한 일정"
          icon="calendar"
          total={totals.event}
          active={active === "event"}
          expanded={expanded.includes("event")}
          toggle={() => toggle("event")}
        >
          <DataState {...dates} retry={dates.reload} />
          {calendarItems.length > 0 && (
            <p className="rd-p-muted">
              일정은 행사 날짜를 기준으로 정렬합니다.
            </p>
          )}
          <div className="rd-p-event-list">
            {visibleCalendarItems.map((item) => (
              <SavedCalendarItem
                key={item.id}
                item={item}
                reload={dates.reload}
                companyName={
                  dateCompanies.get(item.company_id ?? "")?.name ??
                  (item.origin === "user" ? "개인 일정" : "기업 일정")
                }
              />
            ))}
          </div>
          {unavailableDates.length > 0 && (
            <div className="rd-p-event-list">
              {visibleUnavailableDates.map((id, index) => (
                <article key={id}>
                  <span className="rd-p-tile">
                    <Icon name="calendar" />
                  </span>
                  <div>
                    <strong>사용할 수 없는 저장 일정</strong>
                    <p>일정이 취소되었거나 더 이상 열람할 수 없습니다.</p>
                  </div>
                  <CalendarRemoveButton
                    id={id}
                    title={`사용할 수 없는 일정 ${index + 1}`}
                    reload={dates.reload}
                  />
                </article>
              ))}
            </div>
          )}
          {dates.data &&
            !calendarItems.length &&
            !unavailableDates.length &&
            !dates.error && (
              <Empty
                title={
                  hasFilters
                    ? "조건에 맞는 저장한 일정이 없습니다."
                    : "저장한 일정이 없습니다."
                }
                description={
                  hasFilters
                    ? "키워드나 회사 필터를 바꾸거나 초기화해 보세요."
                    : "캘린더에서 관심 일정을 저장해 보세요."
                }
                href={hasFilters ? undefined : "/calendar"}
                label="캘린더 열기"
              />
            )}
        </SavedSection>
      </div>
      {manage && (
        <Modal title="방문·검색 기록 관리" onClose={() => setManage(false)}>
          <Notice action={action} />
          <p>
            이 계정의 방문·검색 기록을 삭제합니다. 저장한 분석과 북마크는
            유지됩니다.
          </p>
          <p className="rd-p-muted">
            방문 기록은 최근 100개, 검색어는 최근 10개까지 보관됩니다.
          </p>
          <div className="rd-p-modal-actions">
            <button className="rd-p-button" onClick={() => setManage(false)}>
              취소
            </button>
            <button
              className="rd-p-button danger"
              disabled={action.busy}
              onClick={() =>
                void action.run(async () => {
                  await workspace(
                    token,
                    { action: "history_clear", p: {} },
                    z.unknown(),
                  );
                  reload();
                  setManage(false);
                }, "방문·검색 기록을 지웠습니다.")
              }
            >
              기록 지우기
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
