"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth";
import { Icon, type IconName } from "@/components/icons";
import { newsResponse, type NewsResponse } from "@/lib/news-contract";
import { catalogSchema } from "@/workspace/contracts";
import { DataState, useData } from "@/workspace/ui";
import {
  dashboardSchema,
  koreaDate,
  rangeStart,
  validRange,
} from "./dashboard-contract";
import {
  Heading,
  More,
  Panel,
  ResourceRows,
  SearchForm,
  formatSourceDate,
} from "./ui";

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
export default function Home() {
  const [today] = useState(() => koreaDate()),
    [company, setCompany] = useState(""),
    [range, setRange] = useState({ start: today, end: today }),
    [draft, setDraft] = useState(range),
    [rangeError, setRangeError] = useState("");
  const directory = useData(
    { action: "catalog", p: { kind: "company", limit: 50 } },
    catalogSchema,
  );
  const data = useData(
    {
      action: "design_dashboard",
      p: { start_date: range.start, end_date: range.end, company_id: company },
    },
    dashboardSchema,
  );
  const selected =
    directory.data?.items.find((c) => c.id === company) ??
    directory.data?.items[0];
  const news = useNews(selected?.id ?? "");
  const metrics: {
    title: string;
    count: number | null;
    icon: IconName;
    href: string;
    error: string;
    loading: boolean;
  }[] = [
    {
      title: "기간 내 공개 공시",
      count: data.data?.filing_count ?? null,
      icon: "file",
      href: "#disclosures",
      error: data.error,
      loading: data.loading,
    },
    {
      title: "기간 내 승인 분석",
      count: data.data?.analysis_count ?? null,
      icon: "file",
      href: "#analyses",
      error: data.error,
      loading: data.loading,
    },
    {
      title: "기간 내 확정 일정",
      count: data.data?.event_count ?? null,
      icon: "calendar",
      href: "#calendar",
      error: data.error,
      loading: data.loading,
    },
    {
      title: selected ? `${selected.company_name} 뉴스` : "최신 뉴스 검색결과",
      count: news.data?.items.length ?? null,
      icon: "timeline",
      href: "#news",
      error: news.error,
      loading: news.loading,
    },
  ];
  const companyQuery = company
    ? `&company_id=${encodeURIComponent(company)}`
    : "";
  return (
    <div data-screen="redesign-home">
      <Heading
        title="홈"
        description="공시, 분석, 일정, 뉴스를 한눈에 확인합니다."
      />
      <SearchForm />
      <div className="rd-kpis">
        {metrics.map((m) => (
          <Link className="rd-kpi" href={m.href} key={m.title}>
            <span className="rd-kpi-icon">
              <Icon name={m.icon} size={28} />
            </span>
            <div>
              <div className="rd-kpi-title">{m.title}</div>
              <strong
                className={
                  m.error || m.loading || m.count === null
                    ? "rd-kpi-status"
                    : ""
                }
              >
                {m.error ? (
                  "조회 불가"
                ) : m.loading ? (
                  "불러오는 중"
                ) : m.count === null ? (
                  "미제공"
                ) : (
                  <>
                    {m.count.toLocaleString("ko-KR")}
                    <small>건</small>
                  </>
                )}
              </strong>
            </div>
            <span aria-hidden="true">›</span>
          </Link>
        ))}
      </div>
      <div className="rd-filterbar">
        <label>
          기업 필터
          <select value={company} onChange={(e) => setCompany(e.target.value)}>
            <option value="">전체 기업</option>
            {directory.data?.items.map((c) => (
              <option key={c.id} value={c.id}>
                {c.company_name}
              </option>
            ))}
          </select>
        </label>
        <div className="rd-range">
          <strong>날짜 필터</strong>
          {[
            [1, "오늘"],
            [3, "최근 3일"],
            [7, "최근 1주"],
            [30, "최근 1개월"],
          ].map(([days, label]) => (
            <button
              key={days}
              type="button"
              aria-pressed={
                range.start === rangeStart(today, Number(days)) &&
                range.end === today
              }
              onClick={() => {
                const next = {
                  start: rangeStart(today, Number(days)),
                  end: today,
                };
                setDraft(next);
                setRange(next);
                setRangeError("");
              }}
            >
              {label}
            </button>
          ))}
          <input
            type="date"
            aria-label="시작일"
            value={draft.start}
            max={draft.end}
            onChange={(e) => setDraft({ ...draft, start: e.target.value })}
          />
          <span>~</span>
          <input
            type="date"
            aria-label="종료일"
            value={draft.end}
            min={draft.start}
            onChange={(e) => setDraft({ ...draft, end: e.target.value })}
          />
          <button
            type="button"
            onClick={() => {
              if (!validRange(draft.start, draft.end)) {
                setRangeError(
                  "시작일과 종료일을 확인해 주세요. 최대 366일까지 조회할 수 있습니다.",
                );
                return;
              }
              setRange(draft);
              setRangeError("");
            }}
          >
            적용
          </button>
        </div>
      </div>
      {rangeError && (
        <p role="alert" className="rd-note">
          {rangeError}
        </p>
      )}
      <DataState {...directory} retry={directory.reload} />
      <DataState {...data} retry={data.reload} />
      <div className="rd-grid-two">
        <div id="disclosures">
          <Panel
            title="최근 공시"
            action={
              <More href={`/search?kind=document&sort=newest${companyQuery}`} label="전체 이력" />
            }
          >
            {data.data && <ResourceRows items={data.data.filings} />}
          </Panel>
        </div>
        <div id="analyses">
          <Panel
            title="최근 승인 분석"
            action={
              <More href={`/search?kind=analysis&sort=newest${companyQuery}`} label="전체 이력" />
            }
          >
            {data.data && (
              <ResourceRows items={data.data.analyses} reviewDate />
            )}
          </Panel>
        </div>
        <div id="calendar">
          <Panel title="확정 일정" action={<More href="/calendar" />}>
            {data.data?.events.length ? (
              <div className="rd-table-scroll rd-calendar-rows">
                <table className="rd-table">
                  <thead>
                    <tr>
                      <th>날짜</th>
                      <th>기업명</th>
                      <th>제목</th>
                      <th>
                        <span className="rd-sr">열기</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.data.events.map((e) => (
                      <tr key={e.id}>
                        <td>{formatSourceDate(e.occurs_on)}</td>
                        <td>{e.company_name}</td>
                        <td>
                          <Link
                            href={`/events/${encodeURIComponent(e.id)}?kind=calendar`}
                          >
                            {e.title}
                          </Link>
                        </td>
                        <td>
                          <Link
                            href={`/events/${encodeURIComponent(e.id)}?kind=calendar`}
                            aria-label={`${e.title} 열기`}
                          >
                            ›
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              data.data && (
                <p className="rd-empty">
                  선택한 기간에 확인된 일정이 없습니다.
                </p>
              )
            )}
          </Panel>
        </div>
        <div id="news">
          <Panel
            title="기업 뉴스"
            action={
              selected ? (
                <span className="rd-muted">
                  {selected.company_name} · 최신 검색
                </span>
              ) : null
            }
          >
            <div className="rd-home-news">
              <DataState {...news} retry={news.reload} />
              {news.data && (
                <>
                  <div className="rd-table-scroll">
                    <table className="rd-table">
                      <thead>
                        <tr>
                          <th>공개일</th>
                          <th>제목</th>
                          <th>출처</th>
                        </tr>
                      </thead>
                      <tbody>
                        {news.data.items.slice(0, 5).map((n, i) => (
                          <tr key={`${n.link}:${i}`}>
                            <td>{formatSourceDate(n.publishedAt)}</td>
                            <td>
                              <a
                                href={n.originalLink ?? n.link}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                {n.title}
                              </a>
                            </td>
                            <td>
                              <a
                                href={n.link}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                NAVER
                              </a>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <footer>
                    선택 기업의 최신 검색결과 {news.data.items.length}건입니다.
                    공시 날짜 필터와 별도로 제공합니다.{" "}
                    <a
                      href="https://www.ncloud.com/product/applicationService/NAVERAPIHUB"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      NAVER™ API HUB
                    </a>
                  </footer>
                  <button className="rd-more rd-icon" onClick={news.reload}>
                    새로고침
                  </button>
                </>
              )}
              {!selected && !directory.loading && (
                <p className="rd-empty">뉴스를 조회할 등록 기업이 없습니다.</p>
              )}
            </div>
          </Panel>
        </div>
      </div>
      <p className="rd-muted" style={{ marginTop: 18 }}>
        공시는 원문 공개일, 분석은 승인일, 일정은 개최일 기준입니다. 시간 기준:
        한국시간.
      </p>
    </div>
  );
}
