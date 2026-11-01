"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";
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

function SaveDiscovery({ reload }: { reload: () => void }) {
  const analyses = useData({ action: "catalog", p: { kind: "analysis", sort: "newest", limit: 3 } }, catalogSchema);
  const documents = useData({ action: "catalog", p: { kind: "document", sort: "newest", limit: 3 } }, catalogSchema);
  const { date } = usePrefs();
  return (
    <section className="rd-p-panel" aria-labelledby="rd-save-discovery-title">
      <header className="rd-p-section-head"><h2 id="rd-save-discovery-title"><Icon name="star" />저장할 자료 찾기</h2></header>
      <p className="rd-p-muted">아래는 최근 공개된 자료입니다. 저장을 누른 자료만 내 저장 목록에 추가됩니다.</p>
      {([{ title: "최근 공개 분석", result: analyses, kinds: ["event", "us_analysis", "dart_analysis"] },
        { title: "최근 공시·문서", result: documents, kinds: ["filing", "document"] }] as const).map(({ title, result, kinds }) => {
        const items = result.data?.items.filter(item => (kinds as readonly string[]).includes(item.kind) && !item.is_saved) ?? [];
        return <div key={title}>
          <h3>{title}</h3>
          <DataState {...result} retry={result.reload} />
          <div className="rd-p-analysis-grid">
            {items.map(item => <article key={`${item.kind}:${item.id}`} className="rd-p-analysis-card">
              <header><span>{item.company_name} · {item.ticker}</span><SaveButton item={item} labeled reload={reload} /></header>
              <Link className="rd-p-card-title" href={resourceHref(item)}>{item.title}</Link>
              {item.summary && <p>{item.summary}</p>}
              <footer>{item.kind === "event" ? "검토된 분석" : item.kind.endsWith("analysis") ? "승인된 분석" : "공식 문서"} · {date(item.published_at, item.publication_precision)}</footer>
            </article>)}
          </div>
          {result.data && !result.error && !items.length && <p className="rd-p-muted">지금 표시할 공개 자료가 없습니다.</p>}
        </div>;
      })}
    </section>
  );
}

function SavedSection({
  id,
  title,
  icon,
  total,
  expanded,
  toggle,
  children,
}: {
  id: Section;
  title: string;
  icon: "file" | "calendar" | "star" | "clock";
  total: number;
  expanded: boolean;
  toggle: () => void;
  children: ReactNode;
}) {
  return (
    <section
      id={`rd-saved-${id}`}
      className="rd-p-panel rd-p-saved-section"
      aria-labelledby={`rd-saved-title-${id}`}
    >
      <header className="rd-p-section-head">
        <h2 id={`rd-saved-title-${id}`}>
          <Icon name={icon} />
          {title}
        </h2>
        {total > (id === "analysis" ? 3 : 4) && (
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
  return <SavedContent key={token ?? "signed-out"} />;
}

function SavedContent() {
  const { token } = useAuth(),
    prefs = usePrefs(),
    action = useMutation();
  const [active, setActive] = useState<Section>("analysis"),
    [query, setQuery] = useState(""),
    [draft, setDraft] = useState(""),
    [company, setCompany] = useState(""),
    [sort, setSort] = useState<"newest" | "oldest">("newest"),
    [manage, setManage] = useState(false),
    [expanded, setExpanded] = useState<Section[]>([]);
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
        </div>
      </header>
      <Notice action={action} />
      <nav className="rd-p-saved-tabs" aria-label="저장 항목 바로가기">
        {sections.map((section) => (
          <a
            key={section.key}
            href={`#rd-saved-${section.key}`}
            className={active === section.key ? "active" : ""}
            aria-current={active === section.key ? "location" : undefined}
            onClick={() => setActive(section.key)}
          >
            <Icon name={section.icon} />
            <span>{section.label}</span>
          </a>
        ))}
      </nav>
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
            <option value="newest">최신순</option>
            <option value="oldest">오래된 순</option>
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
        <button
          className="rd-p-button"
          type="button"
          onClick={() => setManage(true)}
        >
          <Icon name="settings" size={17} />
          기록 관리
        </button>
      </form>
      <DataState {...saved} retry={saved.reload} />
      {!hasFilters && saved.data && !saved.error && saved.data.items.length === 0 && <SaveDiscovery reload={reload} />}
      <div className="rd-p-saved-stack">
        <SavedSection
          id="analysis"
          title="저장한 분석"
          icon="file"
          total={analyses.length}
          expanded={expanded.includes("analysis")}
          toggle={() => toggle("analysis")}
        >
          <div className="rd-p-analysis-grid">
            {page(analyses, "analysis", 3).map((item) => (
              <article
                key={`${item.kind}:${item.id}`}
                className="rd-p-analysis-card"
              >
                <header>
                  <Link
                    href={`/companies/${item.company_id}`}
                    className="rd-p-company-identity"
                  >
                    <Logo ticker={item.ticker} />
                    <strong>{item.company_name}</strong>
                    <small>{item.ticker}</small>
                  </Link>
                  <SaveButton item={item} reload={reload} />
                </header>
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
        </SavedSection>
        <SavedSection
          id="document"
          title="북마크 문서"
          icon="star"
          total={documents.length}
          expanded={expanded.includes("document")}
          toggle={() => toggle("document")}
        >
          <div className="rd-p-table-scroll">
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
          </div>
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
        </SavedSection>
        <SavedSection
          id="history"
          title="최근 본 항목"
          icon="clock"
          total={visits.length}
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
          total={Math.max(calendarItems.length, unavailableDates.length)}
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
            {(expanded.includes("event")
              ? calendarItems
              : calendarItems.slice(0, 4)
            ).map((item) => (
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
              {(expanded.includes("event")
                ? unavailableDates
                : unavailableDates.slice(0, 4)
              ).map((id, index) => (
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
