"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { z } from "zod";
import { useAuth } from "@/components/auth";
import { Icon } from "@/components/icons";
import { useResource } from "@/components/ui";
import { body, emptySchema, request } from "@/lib/api";
import {
  calendarSchema,
  companiesSchema,
  watchlistSchema,
} from "@/lib/contracts";
import { downloadText } from "@/lib/product";
import { PcLogo, PcModal } from "@/desktop/ui";
import { DataState, Notice, useMutation } from "@/workspace/ui";
import { usePrefs } from "@/workspace/preferences";
import { safeSource } from "@/workspace/contracts";
import { useCalendarData } from "./calendar-data";
import {
  addDays,
  calendarHref,
  calendarIcs,
  dayInZone,
  isoDaySchema,
  matchesCalendarScope,
  moveAnchor,
  visibleDays,
  type CalendarEntry,
  type CalendarScope,
  type CalendarView,
} from "./calendar-utils";
import "./calendar.css";

const subscriptionSchema = z.object({
  url: z.string().url(),
  expires_in_days: z.number().int().positive(),
  warning: z.string(),
});
const daysOfWeek = ["일", "월", "화", "수", "목", "금", "토"];

export default function RedesignCalendar() {
  const { token } = useAuth(),
    { value: preferences } = usePrefs(),
    action = useMutation();
  const [now] = useState(() => Date.now());
  const today = dayInZone(now, preferences.timezone);
  const [anchorOverride, setAnchor] = useState<string | null>(null),
    anchor = anchorOverride ?? today;
  const [view, setView] = useState<CalendarView>("month");
  const [scope, setScope] = useState<CalendarScope>("all"),
    [query, setQuery] = useState("");
  const [selectedCompanies, setSelectedCompanies] = useState<Set<string>>(
      new Set(),
    ),
    [includePersonal, setIncludePersonal] = useState(true);
  const [showUpcoming, setShowUpcoming] = useState(false),
    [showPast, setShowPast] = useState(false);
  const [adding, setAdding] = useState(false),
    [title, setTitle] = useState(""),
    [personalDate, setPersonalDate] = useState(today),
    [personalCompany, setPersonalCompany] = useState("");
  const [subscribe, setSubscribe] = useState<"google" | "apple" | null>(null),
    [subscriptionState, setSubscriptionState] = useState<{
      token: string | null;
      value: z.infer<typeof subscriptionSchema>;
    } | null>(null);
  const subscription =
    subscriptionState?.token === token ? subscriptionState.value : null;
  const setSubscription = (value: z.infer<typeof subscriptionSchema> | null) =>
    setSubscriptionState(value ? { token, value } : null);
  const visible = visibleDays(anchor, view);
  const calendar = useCalendarData({
    from: visible[0],
    until: visible[visible.length - 1],
  });
  const lists = useCalendarData({
    from: addDays(today, -90),
    until: addDays(today, 365),
  });
  const catalog = useResource("/v1/companies?limit=100", companiesSchema);
  const watchlist = useResource("/v1/watchlist", watchlistSchema);
  const companies = catalog.data ?? [];
  const names = new Map(companies.map((company) => [company.id, company]));
  const followed = new Set(
    watchlist.data?.items.map((company) => company.id) ?? [],
  );
  const filter = (item: CalendarEntry) =>
    matchesCalendarScope(
      item,
      scope,
      followed,
      selectedCompanies,
      includePersonal,
    );
  const entries = (calendar.data?.items ?? []).filter(filter);
  const sideEntries = (lists.data?.items ?? []).filter(filter);
  const upcoming = sideEntries
    .filter((item) => item.occurs_on >= today)
    .sort(
      (a, b) =>
        a.occurs_on.localeCompare(b.occurs_on) || a.id.localeCompare(b.id),
    );
  const past = sideEntries
    .filter((item) => item.occurs_on < today)
    .sort(
      (a, b) =>
        b.occurs_on.localeCompare(a.occurs_on) || a.id.localeCompare(b.id),
    );
  const shownCompanies = companies.filter((company) =>
    `${company.name} ${company.ticker}`
      .toLocaleLowerCase()
      .includes(query.toLocaleLowerCase()),
  );
  const heading =
    view === "month"
      ? `${Number(anchor.slice(0, 4))}년 ${Number(anchor.slice(5, 7))}월`
      : view === "week"
        ? `${visible[0]} ~ ${visible[6]}`
        : anchor;
  function chooseCompany(id: string) {
    setScope("selected");
    setSelectedCompanies((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  async function addPersonal(event: FormEvent) {
    event.preventDefault();
    await action.run(async () => {
      const name = title.trim();
      if (!name) throw new Error("일정 제목을 입력해 주세요.");
      isoDaySchema.parse(personalDate);
      await request(
        "/v1/calendar",
        token,
        calendarSchema.element,
        body("POST", {
          title: name,
          occurs_on: personalDate,
          company_id: personalCompany || null,
        }),
      );
      setAnchor(personalDate);
      setView("month");
      setTitle("");
      setAdding(false);
      setIncludePersonal(true);
      calendar.reload();
      lists.reload();
    }, "개인 일정을 저장했습니다.");
  }
  function exportVisible() {
    void action.run(async () => {
      if (calendar.data?.truncated)
        throw new Error(
          "일정이 500개를 초과합니다. 주 또는 일 보기로 범위를 줄인 뒤 내보내 주세요.",
        );
      downloadText(
        calendarIcs(entries),
        `signalbrief-${view}-${anchor}.ics`,
        "text/calendar;charset=utf-8",
      );
    }, "현재 보기의 일정을 내보냈습니다.");
  }
  function renderList(items: CalendarEntry[], expanded: boolean) {
    return (
      <div className="rd-calendar-list">
        {(expanded ? items : items.slice(0, 4)).map((item) => {
          const company = item.company_id
            ? names.get(item.company_id)
            : undefined;
          const date = new Date(`${item.occurs_on}T00:00:00Z`);
          return (
            <Link
              className="rd-calendar-list-row"
              key={item.id}
              href={calendarHref(item)}
            >
              <time className="rd-date-tile" dateTime={item.occurs_on}>
                <span>{Number(item.occurs_on.slice(5, 7))}월</span>
                <strong>{Number(item.occurs_on.slice(8, 10))}</strong>
                <small>{daysOfWeek[date.getUTCDay()]}</small>
              </time>
              {company ? (
                <PcLogo ticker={company.ticker} size={32} />
              ) : (
                <span className="rd-calendar-mini-icon">
                  <Icon name="calendar" size={23} />
                </span>
              )}
              <div>
                <strong>
                  {company
                    ? `${company.name} (${company.ticker})`
                    : item.origin === "user"
                      ? "개인 일정"
                      : "공식 일정"}
                </strong>
                <b>{item.title}</b>
                <p>
                  <Icon name="calendar" size={12} />
                  {item.origin === "user" ? "개인 일정" : "공식 일정"}
                  <Icon name="clock" size={12} />
                  {item.occurs_on} · 종일
                </p>
              </div>
            </Link>
          );
        })}
      </div>
    );
  }
  return (
    <div className="sb-redesign rd-calendar" data-screen="redesign-calendar">
      <header className="rd-calendar-heading">
        <h1>캘린더</h1>
        <p>주요 기업의 공식 일정과 개인 일정을 한눈에 확인하세요.</p>
      </header>
      <Notice action={action} />
      <div className="rd-calendar-columns">
        <aside className="rd-calendar-filter rd-calendar-card">
          <h2>기업 범위</h2>
          <fieldset className="rd-calendar-scope">
            <legend className="rd-visually-hidden">기업 범위</legend>
            {(
              [
                ["all", "전체 기업"],
                ["following", "관심 기업"],
                ["selected", "특정 기업 선택"],
              ] as const
            ).map(([key, label]) => (
              <label key={key}>
                <input
                  type="radio"
                  name="rd-calendar-scope"
                  checked={scope === key}
                  onChange={() => setScope(key)}
                />
                {label}
              </label>
            ))}
          </fieldset>
          <label className="rd-calendar-search">
            <Icon name="search" size={17} />
            <input
              aria-label="기업명 또는 티커 검색"
              value={query}
              maxLength={100}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="기업명 또는 티커 검색..."
            />
          </label>
          <DataState
            loading={catalog.loading}
            error={catalog.error ?? ""}
            retry={catalog.reload}
          />
          <div className="rd-calendar-company-list">
            {shownCompanies.map((company) => (
              <label key={company.id}>
                <input
                  type="checkbox"
                  checked={selectedCompanies.has(company.id)}
                  onChange={() => chooseCompany(company.id)}
                />
                <span>
                  {company.name} ({company.ticker})
                </span>
              </label>
            ))}
          </div>
          {!catalog.loading && !catalog.error && !shownCompanies.length && (
            <p className="rd-calendar-empty">검색 결과가 없습니다.</p>
          )}
          {companies.length === 100 && (
            <p className="rd-calendar-note">
              기업 선택 목록은 최대 100개입니다.
            </p>
          )}
          {scope === "following" && (
            <DataState
              loading={watchlist.loading}
              error={watchlist.error ?? ""}
              retry={watchlist.reload}
            />
          )}
          {scope === "following" &&
            !watchlist.loading &&
            !watchlist.error &&
            !followed.size && (
              <p className="rd-calendar-note">
                관심 기업을 등록하면 해당 기업의 일정이 표시됩니다.{" "}
                <Link href="/watchlist">기업 추가</Link>
              </p>
            )}
        </aside>
        <div className="rd-calendar-side-lists">
          <section className="rd-calendar-card">
            <header className="rd-calendar-section-head">
              <h2>
                다가오는 일정 <span>{lists.data ? upcoming.length : "…"}</span>
              </h2>
              <button
                type="button"
                onClick={() => setShowUpcoming((value) => !value)}
                aria-expanded={showUpcoming}
              >
                {showUpcoming ? "간단히 보기" : "모두 보기"} ›
              </button>
            </header>
            <DataState {...lists} retry={lists.reload} />
            {renderList(upcoming, showUpcoming)}
            {lists.data && !upcoming.length && (
              <p className="rd-calendar-empty">확인된 예정 일정이 없습니다.</p>
            )}
            <p className="rd-calendar-note">오늘부터 1년간의 확인된 일정</p>
          </section>
          <section className="rd-calendar-card">
            <header className="rd-calendar-section-head">
              <h2>
                지난 일정 <span>{lists.data ? past.length : "…"}</span>
              </h2>
              <button
                type="button"
                onClick={() => setShowPast((value) => !value)}
                aria-expanded={showPast}
              >
                {showPast ? "간단히 보기" : "모두 보기"} ›
              </button>
            </header>
            {renderList(past, showPast)}
            {lists.data && !past.length && (
              <p className="rd-calendar-empty">확인된 지난 일정이 없습니다.</p>
            )}
            <p className="rd-calendar-note">최근 90일의 확인된 일정</p>
          </section>
          {lists.data?.truncated && (
            <p className="rd-calendar-note" role="status">
              조회 한도 500개에 도달했습니다. 월·주·일 보기에서 기간별 전체
              일정을 확인하세요.
            </p>
          )}
        </div>
        <div className="rd-calendar-main">
          <section className="rd-calendar-card rd-calendar-grid-card">
            <div className="rd-calendar-toolbar">
              <div className="rd-calendar-period">
                <button
                  type="button"
                  aria-label="이전 기간"
                  onClick={() => setAnchor(moveAnchor(anchor, view, -1))}
                >
                  ‹
                </button>
                <button
                  type="button"
                  aria-label="다음 기간"
                  onClick={() => setAnchor(moveAnchor(anchor, view, 1))}
                >
                  ›
                </button>
                <h2>{heading}</h2>
              </div>
              <div className="rd-calendar-view">
                <button type="button" onClick={() => setAnchor(today)}>
                  오늘
                </button>
                <div role="group" aria-label="캘린더 표시 단위">
                  {(
                    [
                      ["month", "월"],
                      ["week", "주"],
                      ["day", "일"],
                    ] as const
                  ).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      aria-pressed={view === key}
                      onClick={() => setView(key)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <DataState {...calendar} retry={calendar.reload} />
            <div className={`rd-calendar-grid rd-calendar-grid-${view}`}>
              {view !== "day" &&
                daysOfWeek.map((day) => (
                  <div className="rd-calendar-weekday" key={day}>
                    {day}
                  </div>
                ))}
              {visible.map((day) => {
                const daily = entries.filter((item) => item.occurs_on === day);
                return (
                  <section
                    key={day}
                    className={`rd-calendar-day ${day === today ? "is-today" : ""} ${view === "month" && !day.startsWith(anchor.slice(0, 7)) ? "is-outside" : ""}`}
                    aria-label={day}
                  >
                    <button
                      type="button"
                      className="rd-calendar-day-number"
                      aria-label={`${day} 일 보기`}
                      onClick={() => {
                        setAnchor(day);
                        setView("day");
                      }}
                    >
                      <time dateTime={day}>
                        {view === "day"
                          ? `${day} (${daysOfWeek[new Date(`${day}T00:00:00Z`).getUTCDay()]})`
                          : Number(day.slice(8, 10))}
                      </time>
                    </button>
                    {(view === "month" ? daily.slice(0, 3) : daily).map(
                      (item) => (
                        <Link
                          className={`rd-calendar-chip rd-calendar-chip-${item.origin === "user" ? "personal" : String(item.company_id ?? "").charCodeAt(0) % 4}`}
                          key={item.id}
                          href={calendarHref(item)}
                        >
                          <strong>
                            {item.company_id
                              ? (names.get(item.company_id)?.name ?? item.title)
                              : "개인 일정"}
                          </strong>
                          <span>{item.title}</span>
                        </Link>
                      ),
                    )}
                    {view === "month" && daily.length > 3 && (
                      <button
                        className="rd-calendar-overflow"
                        type="button"
                        onClick={() => {
                          setAnchor(day);
                          setView("day");
                        }}
                      >
                        +{daily.length - 3}개 더 보기
                      </button>
                    )}
                    {view === "day" && calendar.data && !daily.length && (
                      <p className="rd-calendar-empty">
                        등록된 일정이 없습니다.
                      </p>
                    )}
                  </section>
                );
              })}
            </div>
            {calendar.data?.truncated && (
              <p className="rd-calendar-note" role="status">
                이 기간은 500개를 초과합니다. 주 또는 일 보기로 범위를 줄여
                주세요.
              </p>
            )}
          </section>
          <section className="rd-calendar-card rd-personal-calendar">
            <div>
              <h2>개인 캘린더</h2>
              <p>개인 일정을 추가하여 기업 일정과 함께 확인할 수 있습니다.</p>
              <label>
                <input
                  type="checkbox"
                  checked={includePersonal}
                  onChange={(event) => setIncludePersonal(event.target.checked)}
                />{" "}
                개인 일정 표시
              </label>
            </div>
            <button
              className="rd-calendar-button"
              type="button"
              onClick={() => {
                setPersonalDate(anchor);
                setAdding(true);
              }}
            >
              <Icon name="plus" size={18} />
              개인 일정 추가
            </button>
          </section>
          <section className="rd-calendar-card rd-calendar-integrations">
            <h2>내보내기 또는 구독</h2>
            <p>
              현재 보기를 파일로 내보내거나 관심 기업·개인 일정의 읽기 전용
              캘린더를 구독하세요.
            </p>
            <div>
              <button
                className="rd-calendar-button"
                onClick={() => setSubscribe("google")}
              >
                <Icon name="calendar" size={17} />
                Google 캘린더 구독
              </button>
              <button
                className="rd-calendar-button"
                onClick={() => setSubscribe("apple")}
              >
                <Icon name="calendar" size={17} />
                Apple 캘린더 구독
              </button>
              <button
                className="rd-calendar-button"
                disabled={
                  action.busy ||
                  calendar.loading ||
                  !!calendar.error ||
                  !calendar.data
                }
                onClick={exportVisible}
              >
                <Icon name="download" size={17} />
                캘린더 내보내기
              </button>
            </div>
          </section>
        </div>
      </div>
      {adding && (
        <PcModal title="개인 일정 추가" onClose={() => setAdding(false)}>
          <form className="rd-calendar-form" onSubmit={addPersonal}>
            <Notice action={action} />
            <label>
              제목
              <input
                autoFocus
                required
                maxLength={200}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </label>
            <label>
              날짜
              <input
                required
                type="date"
                value={personalDate}
                onChange={(event) => setPersonalDate(event.target.value)}
              />
            </label>
            <label>
              관련 기업 (선택)
              <select
                value={personalCompany}
                onChange={(event) => setPersonalCompany(event.target.value)}
              >
                <option value="">선택하지 않음</option>
                {companies.map((company) => (
                  <option value={company.id} key={company.id}>
                    {company.name} ({company.ticker})
                  </option>
                ))}
              </select>
            </label>
            <p>시간을 지정하지 않는 종일 일정으로 저장합니다.</p>
            <button
              className="rd-calendar-button rd-calendar-primary"
              type="submit"
              disabled={action.busy || !token}
            >
              {action.busy ? "저장 중…" : "일정 저장"}
            </button>
          </form>
        </PcModal>
      )}
      {subscribe && (
        <PcModal
          title={`${subscribe === "google" ? "Google" : "Apple"} 캘린더 구독`}
          onClose={() => setSubscribe(null)}
        >
          <div className="rd-calendar-form">
            <Notice action={action} />
            <p>
              관심 기업과 개인 일정의 읽기 전용 구독입니다. 변경 사항의 갱신
              주기는 캘린더 서비스에서 결정합니다. 구독 피드는 최대 500개 일정을
              제공합니다.
            </p>
            <p>
              {subscribe === "google"
                ? "Google 캘린더에서 다른 캘린더 → URL로 추가를 선택하고 아래 주소를 붙여넣으세요."
                : "Apple 캘린더에서 파일 → 새로운 캘린더 구독을 선택하고 아래 주소를 붙여넣으세요."}
            </p>
            <p>
              구독 주소를 가진 사람은 일정 내용을 볼 수 있습니다. 새 주소를
              생성하면 기존 주소가 폐기됩니다.
            </p>
            <button
              className="rd-calendar-button rd-calendar-primary"
              disabled={action.busy}
              onClick={() =>
                void action.run(async () => {
                  const result = await request(
                    "/v1/calendar/subscription",
                    token,
                    subscriptionSchema,
                    body("POST"),
                  );
                  if (!safeSource(result.url))
                    throw new Error("구독 주소를 확인할 수 없습니다.");
                  setSubscription(result);
                }, "구독 주소를 생성했습니다.")
              }
            >
              비공개 구독 주소 생성
            </button>
            {subscription && (
              <>
                <label>
                  구독 주소
                  <input
                    readOnly
                    value={subscription.url}
                    onFocus={(event) => event.target.select()}
                  />
                </label>
                <p>{subscription.expires_in_days}일 후 만료됩니다.</p>
                <button
                  className="rd-calendar-button"
                  disabled={action.busy}
                  onClick={() =>
                    void action.run(async () => {
                      if (!navigator.clipboard)
                        throw new Error("주소를 직접 선택하여 복사해 주세요.");
                      await navigator.clipboard.writeText(subscription.url);
                    }, "구독 주소를 복사했습니다.")
                  }
                >
                  주소 복사
                </button>
              </>
            )}
            <button
              className="rd-calendar-button"
              disabled={action.busy}
              onClick={() =>
                void action.run(async () => {
                  await request(
                    "/v1/calendar/subscription",
                    token,
                    emptySchema,
                    body("DELETE"),
                  );
                  setSubscription(null);
                }, "캘린더 구독 주소를 폐기했습니다.")
              }
            >
              구독 주소 폐기
            </button>
          </div>
        </PcModal>
      )}
    </div>
  );
}
