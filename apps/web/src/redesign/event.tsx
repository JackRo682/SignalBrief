"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type KeyboardEvent } from "react";
import { z } from "zod";
import { useAuth } from "@/components/auth";
import { Icon } from "@/components/icons";
import { useResource } from "@/components/ui";
import { body, emptySchema, request } from "@/lib/api";
import { detailSchema } from "@/lib/contracts";
import { downloadText } from "@/lib/product";
import { initializeSupabase } from "@/lib/supabase";
import { useEventAnalytics } from "@/lib/use-event-analytics";
import { PcLogo, PcModal } from "@/desktop/ui";
import { workspace } from "@/workspace/client";
import {
  companyDetailSchema,
  resourceHref,
  resourceSchema,
  safeSource,
  type Resource,
} from "@/workspace/contracts";
import { usePrefs } from "@/workspace/preferences";
import { DataState, Notice, useData, useMutation } from "@/workspace/ui";
import { useCalendarData } from "./calendar-data";
import {
  addDays,
  calendarHref,
  calendarIcs,
  dayInZone,
  type CalendarEntry,
} from "./calendar-utils";
import "./calendar.css";

const saveResult = z.object({ saved: z.boolean() });
const reminderResult = z.object({
  saved: z.literal(true),
  delivery: z.literal("saved_interest_only"),
});
const reminderList = z.array(z.object({ calendar_id: z.string() }));
const tabs = [
  ["overview", "개요"],
  ["agenda", "아젠다"],
  ["analysis", "관련 분석"],
  ["documents", "문서"],
] as const;
type Tab = (typeof tabs)[number][0];

export default function RedesignEvent({
  id,
  kind = "event",
  panel,
}: {
  id: string;
  kind?: "event" | "calendar";
  panel?: string;
}) {
  return (
    <EventContent key={`${kind}:${id}`} id={id} kind={kind} panel={panel} />
  );
}

function EventContent({
  id,
  kind,
  panel,
}: {
  id: string;
  kind: "event" | "calendar";
  panel?: string;
}) {
  const { token } = useAuth(),
    router = useRouter(),
    { date: formatDate, value: preferences } = usePrefs();
  const action = useMutation(),
    [tab, setTab] = useState<Tab>(
      panel === "evidence" ? "documents" : "overview",
    );
  const [now] = useState(() => Date.now()),
    today = dayInZone(now, preferences.timezone);
  const isCalendar = kind === "calendar";
  const scheduled = useCalendarData(isCalendar ? { id } : null);
  const published = useResource(
    !isCalendar ? `/v1/events/${encodeURIComponent(id)}` : null,
    detailSchema,
  );
  const resource = useData(
    !isCalendar ? { action: "resource", p: { kind: "event", id } } : null,
    resourceSchema,
  );
  const occurrence = scheduled.data?.items[0] ?? null;
  const eventDetail = published.data;
  const analyticsEventId = !isCalendar && !published.loading && !published.error &&
    eventDetail?.event.id === id && eventDetail.event.state === "published" && !eventDetail.event.is_demo
    ? eventDetail.event.id : null;
  const engageEvidence = useEventAnalytics(
    analyticsEventId,
    panel === "evidence" && (tab === "overview" || tab === "documents") && Boolean(eventDetail?.evidence.length),
    "event_detail",
  );
  const companyId = occurrence?.company_id ?? eventDetail?.event.company.id;
  const company = useData(
    companyId ? { action: "company", p: { id: companyId } } : null,
    companyDetailSchema,
  );
  const upcoming = useCalendarData(
    companyId ? { from: today, until: addDays(today, 365), companyId } : null,
  );
  const [savedState, setSaved] = useState<{
    token: string | null;
    value: boolean;
  } | null>(null);
  const [reminders, setReminders] = useState<{
    token: string | null;
    value: Set<string>;
  } | null>(null);
  const [reminderLoading, setReminderLoading] = useState(false),
    [reminderError, setReminderError] = useState(""),
    [revision, setRevision] = useState(0);
  const [reminderOpen, setReminderOpen] = useState(false),
    [alarmDays, setAlarmDays] = useState(1),
    [removeOpen, setRemoveOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    const controller = new AbortController();
    if (!token || !isCalendar) return;
    setReminderLoading(true);
    setReminderError("");
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
        const list = reminderList.parse(response.data);
        if (alive)
          setReminders({
            token,
            value: new Set(list.map((item) => item.calendar_id)),
          });
      } catch {
        if (alive) setReminderError("저장한 일정을 불러오지 못했습니다.");
      } finally {
        if (alive) setReminderLoading(false);
      }
    })();
    return () => {
      alive = false;
      controller.abort();
    };
  }, [token, isCalendar, revision]);
  useEffect(() => {
    if (token && preferences.history_enabled && resource.data)
      void workspace(
        token,
        { action: "visit", p: { kind: "event", id } },
        z.unknown(),
      ).catch(() => {});
  }, [token, preferences.history_enabled, resource.data, id]);

  const companyInfo = company.data?.company;
  const companyName =
    companyInfo?.company_name ?? eventDetail?.event.company.name;
  const ticker = companyInfo?.ticker ?? eventDetail?.event.company.ticker;
  const eventTitle = occurrence?.title ?? eventDetail?.event.headline ?? "";
  const source = safeSource(
    occurrence?.source_url ?? eventDetail?.document.source_url ?? null,
  );
  const isSaved =
    savedState?.token === token
      ? savedState.value
      : isCalendar
        ? Boolean(reminders?.token === token && reminders.value.has(id))
        : (resource.data?.is_saved ?? false);
  const canSaveDate =
    occurrence?.origin === "user" ||
    Boolean(company.data?.watching || company.data?.holding);
  const relatedAnalyses = [
    ...(company.data?.analyses ?? []),
    ...(company.data?.events ?? []),
  ]
    .filter((item) => item.id !== id)
    .slice(0, 5);
  const relatedDates = (upcoming.data?.items ?? [])
    .filter((item) => item.id !== id)
    .slice(0, 3);
  const loading = isCalendar ? scheduled.loading : published.loading,
    error = isCalendar ? scheduled.error : (published.error ?? "");
  const retry = () => {
    scheduled.reload();
    published.reload();
    resource.reload();
  };
  async function save() {
    await action.run(
      async () => {
        const enabled = !isSaved;
        if (isCalendar) {
          if (!canSaveDate && !isSaved)
            throw new Error("먼저 관심 기업에 추가한 뒤 일정을 저장해 주세요.");
          const db = await initializeSupabase();
          const result = await db
            .rpc("sb_reference_reminders", {
              p: { action: "set", calendar_id: id, enabled },
            })
            .abortSignal(AbortSignal.timeout(20000));
          if (result.error)
            throw new Error("일정을 저장하지 못했습니다. 다시 시도해 주세요.");
          reminderResult.parse(result.data);
        } else
          await workspace(
            token,
            { action: "save", p: { kind: "event", id, saved: enabled } },
            saveResult,
          );
        setSaved({ token, value: enabled });
      },
      isSaved ? "저장을 취소했습니다." : "저장했습니다.",
    );
  }
  function exportDate(item: CalendarEntry, alarm?: number) {
    void action.run(
      async () => {
        downloadText(
          calendarIcs([item], { alarmDays: alarm }),
          `signalbrief-event-${item.id}.ics`,
          "text/calendar;charset=utf-8",
        );
        setReminderOpen(false);
      },
      alarm === undefined
        ? "캘린더에 가져올 파일을 다운로드했습니다."
        : "알림이 포함된 캘린더 파일을 다운로드했습니다. 캘린더 앱에서 가져오기를 완료해 주세요.",
    );
  }
  function share() {
    void action.run(async () => {
      if (!navigator.clipboard)
        throw new Error("주소창의 링크를 직접 복사해 주세요.");
      await navigator.clipboard.writeText(window.location.href);
    }, "페이지 링크를 복사했습니다.");
  }
  function onTabKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? tabs.length - 1
          : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) %
            tabs.length;
    setTab(tabs[next][0]);
    document.getElementById(`rd-event-tab-${id}-${tabs[next][0]}`)?.focus();
  }
  const listResources = (items: Resource[]) =>
    items.length ? (
      <div className="rd-event-resources">
        {items.map((item) => (
          <Link href={resourceHref(item)} key={`${item.kind}:${item.id}`}>
            <span className="rd-event-file">
              <Icon name="file" size={20} />
            </span>
            <div>
              <strong>{item.title}</strong>
              {item.summary && <p>{item.summary}</p>}
            </div>
            <time>
              {item.published_at
                ? formatDate(item.published_at, item.publication_precision)
                : "날짜 미제공"}
            </time>
            <span aria-hidden="true">›</span>
          </Link>
        ))}
      </div>
    ) : (
      <p className="rd-calendar-empty">연결된 공개 자료가 없습니다.</p>
    );

  if (loading || error || (!occurrence && !eventDetail))
    return (
      <div className="sb-redesign rd-event">
        <DataState loading={loading} error={error} retry={retry} />
        {!loading && !error && (
          <section className="rd-calendar-card">
            <h1>일정을 확인할 수 없습니다.</h1>
            <p>삭제되었거나 현재 계정에서 볼 수 없는 항목입니다.</p>
            <Link href="/calendar">캘린더로 돌아가기</Link>
          </section>
        )}
      </div>
    );
  return (
    <article className="sb-redesign rd-event" data-screen="redesign-event">
      <nav className="rd-event-breadcrumb" aria-label="현재 위치">
        <Link href="/today">홈</Link>
        <span>›</span>
        <Link href="/calendar">이벤트</Link>
        <span>›</span>
        <span>이벤트 상세</span>
      </nav>
      <Notice action={action} />
      <div className="rd-event-columns">
        <div className="rd-event-main">
          <header className="rd-event-heading">
            <span className="rd-event-type">
              {isCalendar
                ? occurrence?.origin === "user"
                  ? "개인 일정"
                  : "공식 일정"
                : "게시된 분석"}
            </span>
            <div>
              <h1>{eventTitle}</h1>
              {occurrence && (
                <button
                  className="rd-calendar-button rd-calendar-primary"
                  type="button"
                  onClick={() => setReminderOpen(true)}
                >
                  <Icon name="bell" size={18} />
                  리마인더 설정
                </button>
              )}
            </div>
            <div className="rd-event-meta">
              {companyId && (
                <Link href={`/companies/${companyId}`}>
                  <Icon name="file" size={17} />
                  {companyName ?? "기업 정보"}
                  {ticker ? ` (${ticker})` : ""}
                </Link>
              )}
              <span>
                <Icon name="calendar" size={17} />
                {occurrence
                  ? `${formatDate(occurrence.occurs_on, "date")} · ${occurrence.origin === "user" ? "종일" : "날짜 기준"}`
                  : `공개일 ${formatDate(eventDetail!.event.published_at, eventDetail!.event.publication_precision)}`}
              </span>
              {source && (
                <a href={source} target="_blank" rel="noopener noreferrer" onClick={engageEvidence}>
                  공식 출처 ↗
                </a>
              )}
            </div>
          </header>
          <nav
            className="rd-event-tabs"
            role="tablist"
            aria-label="이벤트 정보"
          >
            {tabs.map(([key, label], index) => (
              <button
                key={key}
                id={`rd-event-tab-${id}-${key}`}
                type="button"
                role="tab"
                aria-controls={`rd-event-panel-${id}`}
                aria-selected={tab === key}
                tabIndex={tab === key ? 0 : -1}
                onKeyDown={(event) => onTabKey(event, index)}
                onClick={() => setTab(key)}
              >
                {label}
              </button>
            ))}
          </nav>
          <div
            id={`rd-event-panel-${id}`}
            role="tabpanel"
            aria-labelledby={`rd-event-tab-${id}-${tab}`}
            className="rd-event-sections"
          >
            {tab === "overview" && (
              <section className="rd-calendar-card">
                <h2>이벤트 개요</h2>
                <dl className="rd-event-overview">
                  <div>
                    <dt>이벤트명</dt>
                    <dd>{eventTitle}</dd>
                  </div>
                  <div>
                    <dt>기업명</dt>
                    <dd>
                      {companyName
                        ? `${companyName}${ticker ? ` (${ticker})` : ""}`
                        : "개인 일정"}
                    </dd>
                  </div>
                  <div>
                    <dt>{occurrence ? "일정" : "공개일"}</dt>
                    <dd>
                      {occurrence
                        ? `${formatDate(occurrence.occurs_on, "date")} · ${occurrence.origin === "user" ? "종일" : "날짜 기준"}`
                        : formatDate(
                            eventDetail!.event.published_at,
                            eventDetail!.event.publication_precision,
                          )}
                    </dd>
                  </div>
                  {occurrence && (
                    <div>
                      <dt>시간·장소</dt>
                      <dd>
                        {occurrence.origin === "user"
                          ? "시간을 지정하지 않은 개인 일정입니다."
                          : "정확한 시간·장소는 공식 원문에서 확인하세요."}
                      </dd>
                    </div>
                  )}
                  <div>
                    <dt>주요 내용</dt>
                    <dd>
                      {occurrence?.quote ??
                        eventDetail?.brief.what_happened ??
                        "추가 설명이 제공되지 않았습니다."}
                    </dd>
                  </div>
                  {occurrence?.verified_at && (
                    <div>
                      <dt>출처 확인일</dt>
                      <dd>{formatDate(occurrence.verified_at)}</dd>
                    </div>
                  )}
                </dl>
                {eventDetail?.brief.uncertainty && (
                  <p className="rd-event-uncertainty">
                    {eventDetail.brief.uncertainty}
                  </p>
                )}
              </section>
            )}
            {(tab === "overview" || tab === "agenda") && (
              <section className="rd-calendar-card">
                <h2>주요 아젠다 / 세션 목록</h2>
                <div className="rd-event-agenda-table">
                  <div>
                    <span>시간</span>
                    <span>세션명</span>
                    <span>발표자</span>
                  </div>
                  <p>공식 출처에서 확인된 세션 정보가 아직 없습니다.</p>
                </div>
                {source && (
                  <a
                    className="rd-event-source-link"
                    href={source}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={engageEvidence}
                  >
                    공식 일정 원문 확인 ↗
                  </a>
                )}
              </section>
            )}
            {(tab === "overview" || tab === "documents") && (
              <section className="rd-calendar-card">
                <h2>관련 문서</h2>
                {eventDetail ? (
                  <div className="rd-event-resources">
                    <Link
                      href={`/documents/${eventDetail.document.id}?kind=document`}
                      onClick={engageEvidence}
                    >
                      <span className="rd-event-file">
                        <Icon name="file" size={20} />
                      </span>
                      <div>
                        <strong>{eventDetail.document.title}</strong>
                        <p>
                          {eventDetail.document.provider.toUpperCase()} · 공식
                          원문
                        </p>
                      </div>
                      <time>
                        {formatDate(
                          eventDetail.document.published_at,
                          eventDetail.document.publication_precision,
                        )}
                      </time>
                      <span>›</span>
                    </Link>
                  </div>
                ) : source ? (
                  <a
                    className="rd-event-source-document"
                    href={source}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={engageEvidence}
                  >
                    <Icon name="file" size={22} />
                    <span>공식 일정 원문</span>
                    <Icon name="arrow" size={17} />
                  </a>
                ) : (
                  <p className="rd-calendar-empty">연결된 문서가 없습니다.</p>
                )}
                {eventDetail?.evidence.length
                  ? eventDetail.evidence.map((item, index) => (
                      <details
                        className="rd-event-evidence"
                        key={`${item.fact_id}:${index}`}
                        open={panel === "evidence"}
                        onToggle={(event) => { if (event.currentTarget.open) engageEvidence(); }}
                      >
                        <summary>
                          {item.source_name} · {item.location}
                        </summary>
                        <blockquote>{item.quote}</blockquote>
                        {safeSource(item.source_url) && (
                          <a
                            href={safeSource(item.source_url)}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={engageEvidence}
                          >
                            출처 확인 ↗
                          </a>
                        )}
                      </details>
                    ))
                  : null}
              </section>
            )}
            {(tab === "overview" || tab === "analysis") && (
              <section className="rd-calendar-card">
                <h2>관련 분석</h2>
                <DataState {...company} retry={company.reload} />
                {listResources(relatedAnalyses)}
                {occurrence?.event_id && (
                  <Link
                    className="rd-event-source-link"
                    href={`/events/${occurrence.event_id}`}
                  >
                    연결된 공시 분석 보기 →
                  </Link>
                )}
              </section>
            )}
          </div>
        </div>
        <aside className="rd-event-sidebar">
          <section className="rd-calendar-card">
            <header className="rd-calendar-section-head">
              <h2>회사 스냅샷</h2>
              {companyId && (
                <Link href={`/companies/${companyId}`}>기업 상세 보기 ›</Link>
              )}
            </header>
            <DataState {...company} retry={company.reload} />
            {companyId ? (
              <>
                <div className="rd-event-company">
                  {ticker && <PcLogo ticker={ticker} size={70} />}
                  <div>
                    <strong>{companyName ?? "기업 정보 확인 중"}</strong>
                    <p>
                      {ticker ?? ""}
                      {companyInfo?.market ? ` · ${companyInfo.market}` : ""}
                    </p>
                  </div>
                </div>
                <p className="rd-event-company-summary">
                  {companyInfo?.summary || "등록된 기업 설명이 없습니다."}
                </p>
                <dl className="rd-event-snapshot">
                  <div>
                    <dt>연결된 문서</dt>
                    <dd>
                      {company.data
                        ? `${company.data.documents.length}개 (최근 조회분)`
                        : "확인 중"}
                    </dd>
                  </div>
                  <div>
                    <dt>공개 분석</dt>
                    <dd>
                      {company.data
                        ? `${company.data.analyses.length + company.data.events.length}개 (최근 조회분)`
                        : "확인 중"}
                    </dd>
                  </div>
                </dl>
                {company.data && !company.data.watching && (
                  <button
                    className="rd-calendar-button"
                    type="button"
                    disabled={action.busy}
                    onClick={() =>
                      void action.run(async () => {
                        await request(
                          `/v1/watchlist/${companyId}`,
                          token,
                          emptySchema,
                          body("PUT"),
                        );
                        company.reload();
                      }, "관심 기업에 추가했습니다.")
                    }
                  >
                    <Icon name="plus" size={16} />
                    관심 기업 추가
                  </button>
                )}
              </>
            ) : (
              <p>기업과 연결되지 않은 개인 일정입니다.</p>
            )}
          </section>
          <section className="rd-calendar-card">
            <header className="rd-calendar-section-head">
              <h2>관련 예정 이벤트</h2>
              <Link href="/calendar">더보기 ›</Link>
            </header>
            <DataState {...upcoming} retry={upcoming.reload} />
            {relatedDates.map((item) => (
              <Link
                className="rd-event-related-date"
                href={calendarHref(item)}
                key={item.id}
              >
                <time className="rd-date-tile" dateTime={item.occurs_on}>
                  <span>{Number(item.occurs_on.slice(5, 7))}월</span>
                  <strong>{Number(item.occurs_on.slice(8, 10))}일</strong>
                </time>
                <div>
                  <strong>{item.title}</strong>
                  <p>{formatDate(item.occurs_on, "date")} · {item.origin === "user" ? "종일" : "날짜 기준"}</p>
                  <span>
                    {item.origin === "user" ? "개인 일정" : "공식 일정"}
                  </span>
                </div>
              </Link>
            ))}
            {!upcoming.loading && !upcoming.error && !relatedDates.length && (
              <p className="rd-calendar-empty">
                확인된 예정 이벤트가 없습니다.
              </p>
            )}
          </section>
          <section className="rd-calendar-card rd-event-actions">
            <h2>이벤트 액션</h2>
            {occurrence && (
              <>
                <button
                  className="rd-calendar-button rd-calendar-primary"
                  onClick={() => setReminderOpen(true)}
                >
                  <Icon name="bell" size={17} />
                  리마인더 설정
                </button>
                <button
                  className="rd-calendar-button"
                  disabled={action.busy}
                  onClick={() => exportDate(occurrence)}
                >
                  <Icon name="calendar" size={17} />
                  캘린더에 추가
                </button>
              </>
            )}
            <button
              className="rd-calendar-button"
              aria-pressed={isSaved}
              disabled={
                action.busy ||
                (isCalendar
                  ? reminderLoading ||
                    !!reminderError ||
                    (!canSaveDate && !isSaved)
                  : resource.loading || !!resource.error)
              }
              onClick={() => void save()}
            >
              <Icon name="star" size={17} />
              {isSaved ? "저장됨 · 취소" : "저장하기"}
            </button>
            <button
              className="rd-calendar-button"
              disabled={action.busy}
              onClick={share}
            >
              <Icon name="upload" size={17} />
              공유하기
            </button>
            {isCalendar && !canSaveDate && !isSaved && (
              <p>관심 기업에 추가한 뒤 해당 일정을 저장할 수 있습니다.</p>
            )}
            {reminderError && (
              <DataState
                loading={reminderLoading}
                error={reminderError}
                retry={() => setRevision((value) => value + 1)}
              />
            )}
            <DataState
              loading={false}
              error={resource.error}
              retry={resource.reload}
            />
            {occurrence?.origin === "user" && (
              <button
                className="rd-calendar-button rd-event-remove"
                disabled={action.busy}
                onClick={() => setRemoveOpen(true)}
              >
                개인 일정 삭제
              </button>
            )}
          </section>
        </aside>
      </div>
      {reminderOpen && occurrence && (
        <PcModal
          title="캘린더 리마인더 설정"
          onClose={() => setReminderOpen(false)}
        >
          <div className="rd-calendar-form">
            <p>
              알림이 포함된 ICS 파일을 내 캘린더 앱에 가져오면 해당 앱에서
              알림을 관리합니다. SignalBrief가 예약 이메일·푸시를 발송하는
              기능은 아닙니다.
            </p>
            <p>
              {occurrence.origin === "user"
                ? "이 일정은 시간 정보가 없는 종일 일정입니다."
                : "이 일정은 날짜 기준으로 표시하고 내보냅니다. 정확한 시간은 공식 원문에서 확인하세요."}
            </p>
            <label>
              알림 시점
              <select
                value={alarmDays}
                onChange={(event) => setAlarmDays(Number(event.target.value))}
              >
                <option value={0}>일정 당일</option>
                <option value={1}>1일 전</option>
                <option value={3}>3일 전</option>
                <option value={7}>7일 전</option>
              </select>
            </label>
            <button
              className="rd-calendar-button rd-calendar-primary"
              disabled={action.busy}
              onClick={() => exportDate(occurrence, alarmDays)}
            >
              <Icon name="download" size={17} />
              알림 포함 일정 다운로드
            </button>
            <Notice action={action} />
          </div>
        </PcModal>
      )}
      {removeOpen && occurrence?.origin === "user" && (
        <PcModal title="개인 일정 삭제" onClose={() => setRemoveOpen(false)}>
          <div className="rd-calendar-form">
            <p>‘{occurrence.title}’ 개인 일정을 삭제할까요?</p>
            <button
              className="rd-calendar-button"
              disabled={action.busy}
              onClick={() =>
                void action.run(async () => {
                  await request(
                    `/v1/calendar/${id}`,
                    token,
                    emptySchema,
                    body("DELETE"),
                  );
                  router.push("/calendar");
                }, "일정을 삭제했습니다.")
              }
            >
              일정 삭제
            </button>
            <button
              className="rd-calendar-button"
              onClick={() => setRemoveOpen(false)}
            >
              취소
            </button>
            <Notice action={action} />
          </div>
        </PcModal>
      )}
    </article>
  );
}
