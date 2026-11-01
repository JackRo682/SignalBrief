"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { z } from "zod";
import { useAuth } from "@/components/auth";
import { Icon } from "@/components/icons";
import { useResource } from "@/components/ui";
import { body, emptySchema, request } from "@/lib/api";
import { alertSchema, alertsSchema } from "@/lib/contracts";
import { typeLabels } from "@/lib/format";
import { workspace } from "@/workspace/client";
import {
  catalogSchema,
  contentNotificationsSchema,
  notificationsSettingsSchema,
  resourceHref,
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
import { CompanyLogo as Logo } from "./ui";
import "./personal.css";

const emailSchema = z.object({ available: z.boolean(), enabled: z.boolean() });
type Rule = z.infer<typeof alertSchema>;

function EventRules() {
  const { token } = useAuth(),
    rules = useResource("/v1/alerts", alertsSchema),
    action = useMutation();
  const [editing, setEditing] = useState<Rule | "new" | null>(null),
    [name, setName] = useState(""),
    [types, setTypes] = useState<string[]>([]),
    [threshold, setThreshold] = useState(0.4),
    [enabled, setEnabled] = useState(true);
  const edit = (rule?: Rule) => {
    setEditing(rule ?? "new");
    setName(rule?.name ?? "");
    setTypes(rule?.event_types ?? []);
    setThreshold(rule?.min_score ?? 0.4);
    setEnabled(rule?.enabled ?? true);
  };
  return (
    <section className="rd-p-rule-section">
      <header className="rd-p-section-head">
        <h3>이벤트별 알림 설정</h3>
        <button
          className="rd-p-link"
          disabled={rules.loading || !rules.data || rules.data.length >= 20}
          onClick={() => edit()}
        >
          <Icon name="plus" size={16} />
          규칙 추가
        </button>
      </header>
      <p className="rd-p-muted">
        검토된 이벤트의 유형과 중요도 기준을 설정합니다.
      </p>
      <Notice action={action} />
      <DataState
        loading={rules.loading}
        error={rules.error ?? ""}
        retry={rules.reload}
      />
      <div className="rd-p-setting-rows">
        {rules.data?.map((rule) => (
          <div key={rule.id} className="rd-p-setting-row">
            <span className="rd-p-tile purple">
              <Icon name="timeline" />
            </span>
            <div>
              <button className="rd-p-rule-title" onClick={() => edit(rule)}>
                {rule.name}
              </button>
              <p>
                {rule.event_types.length
                  ? rule.event_types
                      .map((type) => typeLabels[type] ?? type)
                      .join(", ")
                  : "전체 이벤트"}{" "}
                · 기준 {Math.round(rule.min_score * 100)}
              </p>
              <button
                className="rd-p-link rd-p-small"
                disabled={action.busy}
                aria-label={`${rule.name} 규칙 삭제`}
                onClick={() =>
                  void action.run(async () => {
                    await request(
                      `/v1/alerts/${rule.id}`,
                      token,
                      emptySchema,
                      body("DELETE"),
                    );
                    rules.reload();
                  })
                }
              >
                삭제
              </button>
            </div>
            <button
              className="rd-p-switch"
              role="switch"
              aria-label={`${rule.name} 사용`}
              aria-checked={rule.enabled}
              disabled={action.busy}
              onClick={() =>
                void action.run(async () => {
                  await request(
                    `/v1/alerts/${rule.id}`,
                    token,
                    alertSchema,
                    body("PUT", {
                      name: rule.name,
                      event_types: rule.event_types,
                      min_score: rule.min_score,
                      enabled: !rule.enabled,
                    }),
                  );
                  rules.reload();
                })
              }
            >
              <span />
            </button>
          </div>
        ))}
      </div>
      {rules.data && !rules.data.length && !rules.error && (
        <p className="rd-p-muted rd-p-empty-line">
          등록된 이벤트 규칙이 없습니다.
        </p>
      )}
      {editing && (
        <Modal
          title={
            editing === "new"
              ? "이벤트 알림 규칙 추가"
              : "이벤트 알림 규칙 수정"
          }
          onClose={() => setEditing(null)}
        >
          <Notice action={action} />
          <form
            className="rd-p-rule-form"
            onSubmit={(event) => {
              event.preventDefault();
              void action.run(async () => {
                await request(
                  editing === "new" ? "/v1/alerts" : `/v1/alerts/${editing.id}`,
                  token,
                  alertSchema,
                  body(editing === "new" ? "POST" : "PUT", {
                    name: name.trim(),
                    event_types: types,
                    min_score: threshold,
                    enabled,
                  }),
                );
                setEditing(null);
                rules.reload();
              }, "알림 규칙을 저장했습니다.");
            }}
          >
            <label>
              규칙 이름
              <input
                required
                maxLength={100}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <label>
              중요도 기준 · {Math.round(threshold * 100)} / 100
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={threshold}
                onChange={(event) => setThreshold(Number(event.target.value))}
              />
            </label>
            <fieldset>
              <legend>이벤트 유형</legend>
              {Object.entries(typeLabels).map(([key, label]) => (
                <label key={key}>
                  <input
                    type="checkbox"
                    checked={types.includes(key)}
                    onChange={(event) =>
                      setTypes((current) =>
                        event.target.checked
                          ? [...current, key]
                          : current.filter((type) => type !== key),
                      )
                    }
                  />
                  {label}
                </label>
              ))}
            </fieldset>
            <p className="rd-p-muted">
              선택하지 않으면 모든 유형에 적용합니다. 중요도는 서버가 계산한
              관련도입니다.
            </p>
            <label className="rd-p-check-label">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(event) => setEnabled(event.target.checked)}
              />
              규칙 사용
            </label>
            <button
              className="rd-p-button primary"
              disabled={action.busy || !name.trim()}
            >
              규칙 저장
            </button>
          </form>
        </Modal>
      )}
    </section>
  );
}

function NotificationPreferences() {
  const { token } = useAuth(),
    prefs = usePrefs(),
    action = useMutation();
  const settings = useData(
    { action: "notifications", p: {} },
    notificationsSettingsSchema,
  );
  const [tab, setTab] = useState<"events" | "companies">("events");
  const companies = useData(
    tab === "companies"
      ? { action: "catalog", p: { kind: "company", limit: 50 } }
      : null,
    catalogSchema,
  );
  const [email, setEmail] = useState<z.infer<typeof emailSchema> | null>(null),
    [emailError, setEmailError] = useState(""),
    [emailRevision, setEmailRevision] = useState(0);
  useEffect(() => {
    setEmail(null);
    setEmailError("");
    if (!token) return;
    const controller = new AbortController();
    let active = true;
    fetch("/api/us/email-preferences", {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok)
          throw new Error("이메일 알림 연결 상태를 불러오지 못했습니다.");
        return emailSchema.parse(await response.json());
      })
      .then((value) => {
        if (active) setEmail(value);
      })
      .catch((error) => {
        if (active)
          setEmailError(
            error instanceof Error
              ? error.message
              : "이메일 알림 연결 상태를 불러오지 못했습니다.",
          );
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [token, emailRevision]);

  return (
    <aside className="rd-p-panel rd-p-notification-settings">
      <h2>알림 설정</h2>
      <p className="rd-p-muted">필요한 알림을 선택하여 받을 수 있습니다.</p>
      <Notice action={action} />
      <DataState {...settings} retry={settings.reload} />
      <DataState loading={false} error={prefs.error} retry={prefs.reload} />
      <div
        className="rd-p-settings-tabs"
        role="tablist"
        aria-label="알림 설정 유형"
      >
        <button
          role="tab"
          id="rd-alert-events-tab"
          aria-controls="rd-alert-events-panel"
          aria-selected={tab === "events"}
          onClick={() => setTab("events")}
        >
          이벤트 규칙
        </button>
        <button
          role="tab"
          id="rd-alert-companies-tab"
          aria-controls="rd-alert-companies-panel"
          aria-selected={tab === "companies"}
          onClick={() => setTab("companies")}
        >
          회사 알림 관리
        </button>
      </div>
      {tab === "events" ? (
        <div
          role="tabpanel"
          id="rd-alert-events-panel"
          aria-labelledby="rd-alert-events-tab"
        >
          <h3>알림 채널</h3>
          <p className="rd-p-muted">설정된 채널로 새 알림을 받습니다.</p>
          <div className="rd-p-setting-rows">
            <div className="rd-p-setting-row">
              <span className="rd-p-setting-icon">
                <Icon name="bell" size={24} />
              </span>
              <div>
                <strong>앱 내 알림</strong>
                <p>게시된 분석과 검토된 이벤트를 확인합니다.</p>
              </div>
              <button
                role="switch"
                className="rd-p-switch"
                aria-label="앱 내 알림"
                aria-checked={settings.data?.realtime_enabled ?? false}
                disabled={!settings.data || action.busy}
                onClick={() =>
                  void action.run(async () => {
                    await workspace(
                      token,
                      {
                        action: "notification_save",
                        p: {
                          realtime_enabled: !settings.data?.realtime_enabled,
                        },
                      },
                      notificationsSettingsSchema,
                    );
                    settings.reload();
                  }, "앱 내 알림 설정을 저장했습니다.")
                }
              >
                <span />
              </button>
            </div>
            <div className="rd-p-setting-row">
              <span className="rd-p-setting-icon">
                <svg
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  aria-hidden="true"
                >
                  <rect x="3" y="5" width="18" height="14" rx="2" />
                  <path d="m3 6 9 7 9-7" />
                </svg>
              </span>
              <div>
                <strong>이메일 알림</strong>
                <p>
                  {email === null
                    ? emailError
                      ? "연결 상태를 확인해 주세요."
                      : "연결 상태 확인 중…"
                    : email.available
                      ? "검토된 앱 알림을 이메일로 받습니다."
                      : "현재 이메일 발송이 연결되지 않았습니다."}
                </p>
              </div>
              <button
                role="switch"
                className="rd-p-switch"
                aria-label="이메일 알림"
                aria-checked={email?.enabled ?? false}
                disabled={!email?.available || action.busy}
                onClick={() =>
                  void action.run(async () => {
                    const response = await fetch("/api/us/email-preferences", {
                      method: "POST",
                      headers: {
                        Authorization: `Bearer ${token}`,
                        "Content-Type": "application/json",
                      },
                      body: JSON.stringify({ enabled: !email?.enabled }),
                    });
                    if (!response.ok)
                      throw new Error(
                        "이메일 알림 설정을 저장하지 못했습니다.",
                      );
                    setEmail(emailSchema.parse(await response.json()));
                  }, "이메일 알림 설정을 저장했습니다.")
                }
              >
                <span />
              </button>
            </div>
          </div>
          {emailError && (
            <div role="alert" className="rd-p-inline-error">
              {emailError}
              <button
                className="rd-p-link"
                onClick={() => setEmailRevision((value) => value + 1)}
              >
                다시 시도
              </button>
            </div>
          )}
          <EventRules />
        </div>
      ) : (
        <div
          role="tabpanel"
          id="rd-alert-companies-panel"
          aria-labelledby="rd-alert-companies-tab"
        >
          <h3>기업별 알림</h3>
          <p className="rd-p-muted">
            관심 기업의 새 일반 알림을 켜거나 끕니다.
          </p>
          <DataState {...companies} retry={companies.reload} />
          <div className="rd-p-setting-rows">
            {companies.data?.items.map((company) => {
              const muted = prefs.value.muted_companies.includes(company.id);
              return (
                <div key={company.id} className="rd-p-setting-row">
                  <Logo ticker={company.ticker} />
                  <div>
                    <strong>{company.title}</strong>
                    <p>{company.ticker}</p>
                  </div>
                  <button
                    className="rd-p-switch"
                    role="switch"
                    aria-label={`${company.title} 알림`}
                    aria-checked={!muted}
                    disabled={!prefs.loaded || prefs.busy || action.busy}
                    onClick={() =>
                      void action.run(
                        () =>
                          prefs.save({
                            muted_companies: muted
                              ? prefs.value.muted_companies.filter(
                                  (id) => id !== company.id,
                                )
                              : [...prefs.value.muted_companies, company.id],
                          }),
                        "기업 알림 설정을 저장했습니다.",
                      )
                    }
                  >
                    <span />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
      <Link className="rd-p-settings-more" href="/settings/notifications">
        방해 금지·발송 시간 등 상세 설정 <Icon name="arrow" size={16} />
      </Link>
    </aside>
  );
}

export default function Notifications() {
  const { token } = useAuth(),
    { date } = usePrefs(),
    router = useRouter(),
    action = useMutation();
  const data = useData(
    { action: "content_notifications", p: {} },
    contentNotificationsSchema,
  );
  const [unread, setUnread] = useState(false),
    [company, setCompany] = useState(""),
    [kind, setKind] = useState("");
  const reload = data.reload;
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") reload();
    };
    const timer = setInterval(refresh, 60000);
    window.addEventListener("focus", refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [reload]);
  const companies = [
    ...new Map(
      data.data?.items.map((item) => [
        item.resource.company_id,
        item.resource.company_name,
      ]) ?? [],
    ),
  ];
  const shown =
    data.data?.items.filter(
      (item) =>
        (!unread || !item.read_at) &&
        (!company || item.resource.company_id === company) &&
        (!kind ||
          (kind === "analysis"
            ? item.resource.kind === "us_analysis" ||
              item.resource.kind === "dart_analysis"
            : item.resource.kind === "event")),
    ) ?? [];
  const mark = async (id?: string) => {
    await workspace(
      token,
      { action: "content_notification_read", p: id ? { id } : { all: true } },
      z.unknown(),
    );
    reload();
    window.dispatchEvent(new Event("signalbrief:content-updated"));
  };

  return (
    <div className="rd-p-page" data-screen="redesign-notifications">
      <header className="rd-p-heading">
        <div>
          <h1>알림</h1>
          <p>
            중요한 소식을 한눈에 확인하고, 원하는 알림을 설정할 수 있습니다.
          </p>
        </div>
      </header>
      <Notice action={action} />
      <div className="rd-p-notifications-grid">
        <section
          className="rd-p-panel rd-p-notification-stream"
          aria-label="알림 목록"
        >
          <div className="rd-p-notification-filter">
            <div className="rd-p-filter-tabs">
              <button aria-pressed={!unread} onClick={() => setUnread(false)}>
                전체
              </button>
              <button aria-pressed={unread} onClick={() => setUnread(true)}>
                읽지 않음{data.data ? ` (${data.data.unread_count})` : ""}
              </button>
            </div>
            <label className="rd-p-sr-only" htmlFor="rd-notification-company">
              알림 회사
            </label>
            <select
              id="rd-notification-company"
              value={company}
              onChange={(event) => setCompany(event.target.value)}
            >
              <option value="">전체 회사</option>
              {companies.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
            <label className="rd-p-sr-only" htmlFor="rd-notification-kind">
              알림 유형
            </label>
            <select
              id="rd-notification-kind"
              value={kind}
              onChange={(event) => setKind(event.target.value)}
            >
              <option value="">전체 유형</option>
              <option value="analysis">승인된 분석</option>
              <option value="event">검토된 이벤트</option>
            </select>
          </div>
          <DataState {...data} retry={reload} />
          <div>
            {shown.map((item) => (
              <article
                className={`rd-p-notification ${item.read_at ? "" : "unread"}`}
                key={item.id}
              >
                <span
                  className="rd-p-unread-dot"
                  aria-label={item.read_at ? undefined : "읽지 않음"}
                />
                <span
                  className={`rd-p-tile ${item.resource.kind === "event" ? "green" : "blue"}`}
                >
                  <Icon
                    name={item.resource.kind === "event" ? "calendar" : "file"}
                    size={23}
                  />
                </span>
                <div className="rd-p-notification-body">
                  <Link
                    href={resourceHref(item.resource)}
                    onClick={(event) => {
                      if (
                        event.ctrlKey ||
                        event.metaKey ||
                        event.shiftKey ||
                        event.altKey
                      )
                        return;
                      if (!item.read_at) {
                        event.preventDefault();
                        void action.run(async () => {
                          await mark(item.id);
                          router.push(resourceHref(item.resource));
                        });
                      }
                    }}
                  >
                    <strong>{item.resource.title}</strong>
                  </Link>
                  <p>
                    {item.resource.company_name}
                    {item.resource.summary ? ` · ${item.resource.summary}` : ""}
                  </p>
                  <small>
                    {item.resource.kind === "event"
                      ? "검토된 이벤트"
                      : "승인된 분석"}
                  </small>
                </div>
                <div className="rd-p-notification-time">
                  <time dateTime={item.created_at}>
                    {date(item.created_at)}
                  </time>
                  <button
                    className="rd-p-link"
                    disabled={action.busy || !!item.read_at}
                    aria-label={`${item.resource.title} ${item.read_at ? "읽음" : "읽음으로 표시"}`}
                    onClick={() => void action.run(() => mark(item.id))}
                  >
                    {item.read_at ? "읽음" : "읽음으로 표시"}
                  </button>
                </div>
              </article>
            ))}
          </div>
          {data.data && !shown.length && !data.loading && !data.error && (
            <Empty
              title={
                unread
                  ? "읽지 않은 알림이 없습니다."
                  : "조건에 맞는 알림이 없습니다."
              }
              description="관심 기업의 새 분석이나 이벤트가 게시되면 알림 설정에 따라 표시됩니다."
            />
          )}
          <footer className="rd-p-notification-footer">
            <button
              className="rd-p-link"
              disabled={action.busy || !data.data?.unread_count}
              onClick={() =>
                void action.run(
                  () => mark(),
                  "모든 알림을 읽음으로 표시했습니다.",
                )
              }
            >
              모두 읽음으로 표시
            </button>
            <button
              className="rd-p-link"
              disabled={data.loading}
              onClick={reload}
            >
              새로고침
            </button>
            {data.data?.items.length === 100 && (
              <small>최근 알림 최대 100개를 표시합니다.</small>
            )}
          </footer>
        </section>
        <NotificationPreferences />
      </div>
    </div>
  );
}
