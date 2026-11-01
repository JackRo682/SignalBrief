"use client";
import Link from "next/link";
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { useAuth } from "@/components/auth";
import { Icon } from "@/components/icons";
import { workspace } from "@/workspace/client";
import {
  catalogSchema,
  resourceHref,
  resourceKind,
  type Resource,
} from "@/workspace/contracts";
import { usePrefs } from "@/workspace/preferences";
import { DataState, useData } from "@/workspace/ui";
import type { ResearchSearchProps } from "@/workspace/research-search";
import {
  CompanyLogo,
  Heading,
  Panel,
  SaveButton,
  SearchForm,
  formatSourceDate,
} from "./ui";

const searchKind = resourceKind.or(z.literal("analysis")).or(z.literal(""));
function ResultRow({ item }: { item: Resource }) {
  return (
    <div className="rd-result">
      <Link href={resourceHref(item)}>
        {item.kind === "company" ? (
          <CompanyLogo ticker={item.ticker} />
        ) : (
          <span className="rd-file-icon">
            <Icon name="file" size={26} />
          </span>
        )}
        <span className="rd-result-text">
          <strong>{item.title}</strong>
          <small>
            {item.kind === "company"
              ? `${item.ticker} · ${item.market}`
              : `${item.company_name} · ${item.category} · ${formatSourceDate(item.published_at, item.publication_precision)}`}
            {["event", "us_analysis", "dart_analysis"].includes(item.kind) &&
              " · 승인된 자료"}
          </small>
        </span>
        {item.kind === "company" && (
          <span className="rd-result-description">{item.summary}</span>
        )}
        <span aria-hidden="true">›</span>
      </Link>
      {item.kind !== "company" && <SaveButton item={item} />}
    </div>
  );
}
export default function Search({
  initial,
  initialKind,
  initialMarket = "",
  initialDays = 0,
  initialOffset = 0,
  initialSort = "relevance",
  initialSource = "",
  initialCompany = "",
  initialCategory = "",
}: ResearchSearchProps) {
  const { token } = useAuth(),
    prefs = usePrefs(),
    router = useRouter(),
    recorded = useRef("");
  const kind = searchKind.safeParse(initialKind).success
    ? searchKind.parse(initialKind)
    : "";
  const source =
    initialSource === "sec" || initialSource === "dart" ? initialSource : "";
  const company = z.string().uuid().safeParse(initialCompany).success
    ? initialCompany
    : "";
  const filters = {
    q: initial,
    market: initialMarket,
    days: initialDays,
    sort: initialSort,
    source: source as "" | "sec" | "dart",
    company_id: company,
    category: initialCategory,
  };
  const grouped = kind === "";
  const result = useData(
    {
      action: "catalog",
      p: { ...filters, kind, limit: 20, offset: initialOffset },
    },
    catalogSchema,
  );
  // Independent category queries retain exact totals; a mixed first page cannot
  // provide correct per-category previews when one category dominates the result.
  const companies = useData(
    grouped
      ? { action: "catalog", p: { ...filters, kind: "company", limit: 3 } }
      : null,
    catalogSchema,
  );
  const filings = useData(
    grouped
      ? { action: "catalog", p: { ...filters, kind: "document", limit: 3 } }
      : null,
    catalogSchema,
  );
  const analyses = useData(
    grouped
      ? { action: "catalog", p: { ...filters, kind: "analysis", limit: 3 } }
      : null,
    catalogSchema,
  );
  useEffect(() => {
    const q = initial.trim(),
      key = `${token}:${q}`;
    if (
      token &&
      prefs.loaded &&
      prefs.value.history_enabled &&
      q &&
      recorded.current !== key
    ) {
      recorded.current = key;
      void workspace(
        token,
        { action: "search_record", p: { query: q } },
        z.unknown(),
      ).catch(() => {
        recorded.current = "";
      });
    }
  }, [token, initial, prefs.loaded, prefs.value.history_enabled]);
  function change(patch: Record<string, string | number>) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries({
      ...filters,
      kind,
      offset: 0,
      ...patch,
    }))
      if (v !== "" && v !== 0) params.set(k, String(v));
    router.push(`/search?${params}`);
  }
  const counts = result.data?.counts;
  const count = (keys: string[]) =>
    counts ? keys.reduce((sum, key) => sum + (counts[key] ?? 0), 0) : null;
  const tabs = [
    [
      "",
      "전체",
      counts ? Object.values(counts).reduce((a, b) => a + b, 0) : null,
    ],
    ["company", "기업", count(["company"])],
    ["document", "공시", count(["filing", "document"])],
    ["analysis", "승인 분석", count(["event", "us_analysis", "dart_analysis"])],
  ] as const;
  return (
    <div data-screen="redesign-search">
      <Heading title="검색" />
      <SearchForm initial={initial} onSubmit={(q) => change({ q })} />
      <nav className="rd-tabs" aria-label="검색 유형">
        {tabs.map(([key, title, n]) => (
          <button
            type="button"
            key={key}
            aria-pressed={
              kind === key ||
              (key === "document" && kind === "filing") ||
              (key === "analysis" &&
                ["event", "dart_analysis", "us_analysis"].includes(kind))
            }
            onClick={() => change({ kind: key })}
          >
            {title}
            {n !== null && ` (${n.toLocaleString("ko-KR")})`}
          </button>
        ))}
      </nav>
      <div className="rd-filterbar">
        <label>
          출처
          <select
            value={source}
            onChange={(e) => change({ source: e.target.value })}
          >
            <option value="">전체 출처</option>
            <option value="sec">SEC</option>
            <option value="dart">DART</option>
          </select>
        </label>
        <label>
          기간
          <select
            value={initialDays}
            onChange={(e) => change({ days: Number(e.target.value) })}
          >
            <option value={0}>전체 기간</option>
            <option value={30}>최근 30일</option>
            <option value={90}>최근 90일</option>
            <option value={365}>최근 1년</option>
            {![0, 30, 90, 365].includes(initialDays) && (
              <option value={initialDays}>최근 {initialDays}일</option>
            )}
          </select>
        </label>
        <label>
          정렬
          <select
            value={initialSort}
            onChange={(e) => change({ sort: e.target.value })}
          >
            <option value="relevance">관련도</option>
            <option value="newest">공개일 최신순</option>
          </select>
        </label>
        {company ||
        initialMarket ||
        initialCategory ||
        source ||
        initialDays ? (
          <button
            className="rd-btn"
            onClick={() =>
              change({
                company_id: "",
                market: "",
                category: "",
                source: "",
                days: 0,
              })
            }
          >
            필터 초기화
          </button>
        ) : null}
      </div>
      <DataState {...result} retry={result.reload} />
      {grouped ? (
        <>
          {[
            { key: "company", title: "기업 검색 결과", data: companies },
            { key: "document", title: "전체 공시 결과", data: filings },
            { key: "analysis", title: "승인된 분석 결과", data: analyses },
          ].map((group) => (
            <Panel
              key={group.key}
              title={`${group.title}${group.data.data ? ` · ${group.data.data.total.toLocaleString("ko-KR")}개` : ""}`}
              className="rd-search-section"
              action={
                <button
                  className="rd-more rd-icon"
                  onClick={() => change({ kind: group.key })}
                >
                  전체보기 ›
                </button>
              }
            >
              <DataState {...group.data} retry={group.data.reload} />
              <div className="rd-results">
                {group.data.data?.items.map((item) => (
                  <ResultRow key={`${item.kind}:${item.id}`} item={item} />
                ))}
              </div>
              {group.data.data && !group.data.data.items.length && (
                <p className="rd-empty">검색 결과가 없습니다.</p>
              )}
            </Panel>
          ))}
        </>
      ) : (
        <Panel title="검색 결과">
          <div className="rd-results">
            {result.data?.items.map((item) => (
              <ResultRow key={`${item.kind}:${item.id}`} item={item} />
            ))}
          </div>
          {result.data && !result.data.items.length && (
            <p className="rd-empty">검색 조건에 맞는 자료가 없습니다.</p>
          )}
        </Panel>
      )}
      {!grouped && (initialOffset > 0 || result.data?.next_offset != null) && (
        <div className="rd-pagination">
          <button
            className="rd-btn"
            disabled={result.loading || initialOffset === 0}
            onClick={() => change({ offset: Math.max(0, initialOffset - 20) })}
          >
            이전
          </button>
          <span>{Math.floor(initialOffset / 20) + 1}</span>
          <button
            className="rd-btn"
            disabled={result.loading || result.data?.next_offset == null}
            onClick={() =>
              change({ offset: result.data?.next_offset ?? initialOffset })
            }
          >
            다음
          </button>
        </div>
      )}
    </div>
  );
}
