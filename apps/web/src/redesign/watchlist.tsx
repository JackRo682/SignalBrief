"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth";
import { Icon, type IconName } from "@/components/icons";
import { useResource } from "@/components/ui";
import { body, emptySchema, request } from "@/lib/api";
import { companiesSchema, watchlistSchema } from "@/lib/contracts";
import {
  resourceHref,
  sourceOverviewSchema,
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
import { CompanyLogo as Logo } from "./ui";
import "./personal.css";

function Activity({
  icon,
  tone,
  label,
  item,
  empty,
  loading,
  error,
}: {
  icon: IconName;
  tone: string;
  label: string;
  item?: Resource | null;
  empty: string;
  loading: boolean;
  error: string;
}) {
  const { date } = usePrefs();
  const contents = (
    <>
      <span className={`rd-p-tile ${tone}`}>
        <Icon name={icon} size={24} />
      </span>
      <div className="rd-p-activity-body">
        <strong>{label}</strong>
        {error ? (
          <p className="rd-p-muted">자료를 불러오지 못했습니다.</p>
        ) : loading ? (
          <p className="rd-p-muted">확인 중…</p>
        ) : item ? (
          <>
            <p>{item.title}</p>
            {item.summary && <small>{item.summary}</small>}
          </>
        ) : (
          <p className="rd-p-muted">{empty}</p>
        )}
      </div>
      {!error && !loading && item && (
        <>
          <time dateTime={item.published_at ?? undefined}>
            {date(item.published_at, item.publication_precision)}
          </time>
          <span className="rd-p-chevron" aria-hidden="true">
            ›
          </span>
        </>
      )}
    </>
  );
  return item && !error && !loading ? (
    <Link className="rd-p-activity" href={resourceHref(item)}>
      {contents}
    </Link>
  ) : (
    <div className="rd-p-activity">{contents}</div>
  );
}

export default function Watchlist() {
  const { token } = useAuth(),
    prefs = usePrefs(),
    action = useMutation();
  const list = useResource("/v1/watchlist", watchlistSchema);
  const overview = useData(
    { action: "source_overview", p: { scope: "following", days: 0 } },
    sourceOverviewSchema,
  );
  const [adding, setAdding] = useState(false),
    [draft, setDraft] = useState(""),
    [query, setQuery] = useState(""),
    [filter, setFilter] = useState(""),
    [sort, setSort] = useState("name");
  const catalog = useResource(
    adding ? `/v1/companies?q=${encodeURIComponent(query)}&limit=50` : null,
    companiesSchema,
  );
  useEffect(() => {
    const timeout = setTimeout(() => setQuery(draft.trim()), 250);
    return () => clearTimeout(timeout);
  }, [draft]);
  const companies = list.data?.items ?? [],
    ids = new Set(companies.map((company) => company.id));
  const monitoring = new Map(
    overview.data?.monitoring.map((row) => [row.company_id, row]) ?? [],
  );
  const visible = companies
    .filter((company) =>
      `${company.name} ${company.ticker}`
        .toLocaleLowerCase()
        .includes(filter.trim().toLocaleLowerCase()),
    )
    .sort((a, b) =>
      sort === "latest"
        ? (
            monitoring.get(b.id)?.latest_filing?.published_at ?? ""
          ).localeCompare(
            monitoring.get(a.id)?.latest_filing?.published_at ?? "",
          ) || a.name.localeCompare(b.name, "ko")
        : a.name.localeCompare(b.name, "ko"),
    );
  const reload = () => {
    list.reload();
    overview.reload();
    window.dispatchEvent(new Event("signalbrief:content-updated"));
  };
  const follow = async (id: string, enabled: boolean) => {
    await request(
      `/v1/watchlist/${encodeURIComponent(id)}`,
      token,
      emptySchema,
      body(enabled ? "PUT" : "DELETE"),
    );
    reload();
  };

  return (
    <div className="rd-p-page" data-screen="redesign-watchlist">
      <header className="rd-p-heading">
        <div>
          <h1>관심 기업</h1>
          <p>관심 있는 기업의 주요 소식과 일정을 한눈에 확인하세요.</p>
        </div>
        <button className="rd-p-button primary" onClick={() => setAdding(true)}>
          <Icon name="plus" />
          기업 추가
        </button>
      </header>
      <Notice action={action} />
      <DataState
        loading={list.loading}
        error={list.error ?? ""}
        retry={list.reload}
      />
      <DataState {...overview} retry={overview.reload} />
      <DataState loading={false} error={prefs.error} retry={prefs.reload} />
      <div className="rd-p-watch-filter">
        <label className="rd-p-search">
          <Icon name="search" />
          <input
            aria-label="관심 기업 검색"
            value={filter}
            maxLength={100}
            placeholder="관심 기업 검색 (기업명 또는 티커)"
            onChange={(event) => setFilter(event.target.value)}
          />
        </label>
        <label>
          정렬 기준
          <select
            aria-label="관심 기업 정렬"
            value={sort}
            onChange={(event) => setSort(event.target.value)}
          >
            <option value="name">기업명 순</option>
            <option value="latest">최근 공시 순</option>
          </select>
        </label>
      </div>
      <div className="rd-p-watch-grid">
        {visible.map((company) => {
          const row = monitoring.get(company.id),
            muted = prefs.value.muted_companies.includes(company.id);
          return (
            <article className="rd-p-watch-card" key={company.id}>
              <header className="rd-p-watch-card-head">
                <Link
                  className="rd-p-company-identity"
                  href={`/companies/${company.id}`}
                >
                  <Logo ticker={company.ticker} />
                  <span>
                    <strong>{company.name}</strong>
                    <small>
                      {company.ticker} <span aria-hidden="true">｜</span>{" "}
                      {company.market}
                    </small>
                  </span>
                </Link>
                <div className="rd-p-watch-actions">
                  <span>알림 설정</span>
                  <button
                    role="switch"
                    className="rd-p-switch"
                    aria-label={`${company.name} 알림`}
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
                  <details className="rd-p-overflow">
                    <summary aria-label={`${company.name} 메뉴`}>⋮</summary>
                    <div>
                      <button
                        disabled={action.busy}
                        onClick={() =>
                          void action.run(
                            () => follow(company.id, false),
                            "관심 기업에서 삭제했습니다.",
                          )
                        }
                        aria-label={`${company.name} 팔로우 취소`}
                      >
                        팔로우 취소
                      </button>
                    </div>
                  </details>
                </div>
              </header>
              <div className="rd-p-watch-activities">
                <Activity
                  icon="file"
                  tone="blue"
                  label="최신 공시"
                  item={row?.latest_filing}
                  empty="아직 수집된 공시가 없습니다."
                  loading={overview.loading}
                  error={overview.error}
                />
                <Activity
                  icon="timeline"
                  tone="purple"
                  label="최신 분석"
                  item={row?.latest_analysis}
                  empty="아직 승인된 분석이 없습니다."
                  loading={overview.loading}
                  error={overview.error}
                />
                {row?.next_event && !overview.error && !overview.loading ? (
                  <Link
                    className="rd-p-activity"
                    href={`/companies/${company.id}?tab=events`}
                  >
                    <span className="rd-p-tile green">
                      <Icon name="calendar" size={24} />
                    </span>
                    <div className="rd-p-activity-body">
                      <strong>다음 일정</strong>
                      <p>{row.next_event.title}</p>
                    </div>
                    <time dateTime={row.next_event.occurs_on}>
                      {prefs.date(row.next_event.occurs_on, "date")}
                    </time>
                    <span className="rd-p-chevron" aria-hidden="true">
                      ›
                    </span>
                  </Link>
                ) : (
                  <div className="rd-p-activity">
                    <span className="rd-p-tile green">
                      <Icon name="calendar" size={24} />
                    </span>
                    <div className="rd-p-activity-body">
                      <strong>다음 일정</strong>
                      <p className="rd-p-muted">
                        {overview.loading
                          ? "확인 중…"
                          : overview.error
                            ? "일정을 불러오지 못했습니다."
                            : "확인된 예정 일정이 없습니다."}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </article>
          );
        })}
      </div>
      {list.data && !companies.length && !list.error && (
        <Empty
          title="첫 관심 기업을 추가해 보세요."
          description="기업을 팔로우하면 수집된 공시와 승인된 분석을 한곳에서 확인할 수 있습니다."
        />
      )}
      {list.data && companies.length > 0 && !visible.length && !list.error && (
        <Empty title="검색 조건에 맞는 관심 기업이 없습니다." />
      )}
      {adding && (
        <Modal title="관심 기업 추가" onClose={() => setAdding(false)}>
          <Notice action={action} />
          <label className="rd-p-search">
            <Icon name="search" />
            <input
              autoFocus
              aria-label="추가할 기업 검색"
              value={draft}
              maxLength={100}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="기업명 또는 티커를 입력하세요."
            />
          </label>
          <DataState
            loading={catalog.loading}
            error={catalog.error ?? ""}
            retry={catalog.reload}
          />
          <div className="rd-p-company-picker">
            {catalog.data?.map((company) => (
              <div key={company.id}>
                <Link
                  className="rd-p-company-identity"
                  href={`/companies/${company.id}`}
                >
                  <Logo ticker={company.ticker} />
                  <span>
                    <strong>{company.name}</strong>
                    <small>
                      {company.ticker} · {company.market}
                    </small>
                  </span>
                </Link>
                <button
                  className="rd-p-button"
                  disabled={action.busy || ids.has(company.id)}
                  onClick={() =>
                    void action.run(
                      () => follow(company.id, true),
                      "관심 기업에 추가했습니다.",
                    )
                  }
                >
                  {ids.has(company.id) ? "추가됨" : "추가"}
                </button>
              </div>
            ))}
          </div>
          {catalog.data && !catalog.data.length && !catalog.error && (
            <Empty title="지원하는 기업을 찾지 못했습니다." />
          )}
        </Modal>
      )}
    </div>
  );
}
