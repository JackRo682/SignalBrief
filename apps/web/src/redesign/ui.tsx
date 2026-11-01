"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { Icon } from "@/components/icons";
import { useAuth } from "@/components/auth";
import { workspace } from "@/workspace/client";
import { resourceHref, safeSource, type Resource } from "@/workspace/contracts";
import { Notice, useMutation } from "@/workspace/ui";

const logos = new Set([
  "005490",
  "AAPL",
  "TSLA",
  "005930",
  "005380",
  "035720",
  "373220",
  "000660",
  "035420",
  "NVDA",
]);
export function CompanyLogo({
  ticker,
  large = false,
}: {
  ticker: string;
  large?: boolean;
}) {
  return (
    <span
      className={`rd-logo ${large ? "rd-logo-large" : ""}`}
      aria-hidden="true"
    >
      {logos.has(ticker) ? (
        <Image
          src={`/reference-assets/logos/${ticker}.webp`}
          width={large ? 96 : 52}
          height={large ? 96 : 52}
          alt=""
        />
      ) : ticker === "MSFT" ? (
        <span className="rd-msft">
          <i />
          <i />
          <i />
          <i />
        </span>
      ) : (
        <span>{ticker.slice(0, 4)}</span>
      )}
    </span>
  );
}
export function Heading({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <header className="rd-heading">
      <div>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {action}
    </header>
  );
}
export function Panel({
  title,
  action,
  children,
  className = "",
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rd-panel ${className}`}>
      <header className="rd-panel-head">
        <h2>{title}</h2>
        {action}
      </header>
      {children}
    </section>
  );
}
export function More({ href, label = '더보기' }: { href: string; label?: string }) {
  return (
    <Link className="rd-more" href={href}>
      {label} <span aria-hidden="true">›</span>
    </Link>
  );
}
export function SearchForm({
  initial = "",
  onSubmit,
  compact = false,
}: {
  initial?: string;
  onSubmit?: (q: string) => void;
  compact?: boolean;
}) {
  const [query, setQuery] = useState(initial),
    router = useRouter();
  useEffect(() => setQuery(initial), [initial]);
  return (
    <form
      className={`rd-search ${compact ? "rd-search-compact" : ""}`}
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        const q = query.trim();
        if (onSubmit) onSubmit(q);
        else router.push(`/search?${new URLSearchParams({ q })}`);
      }}
    >
      <label>
        <Icon name="search" size={22} />
        <input
          aria-label={compact ? "전체 검색" : "기업명, 티커 또는 키워드 검색"}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          maxLength={100}
          placeholder="기업명, 티커, 키워드를 검색하세요"
          autoComplete="off"
        />
        {query && (
          <button
            type="button"
            className="rd-icon"
            aria-label="검색어 지우기"
            onClick={() => setQuery("")}
          >
            <Icon name="close" size={18} />
          </button>
        )}
      </label>
      <button className="rd-btn rd-primary" type="submit">
        검색
      </button>
    </form>
  );
}
export function SourceLink({
  url,
  children,
}: {
  url: string | null;
  children: ReactNode;
}) {
  const href = safeSource(url);
  return href ? (
    <a
      className="rd-more"
      href={href}
      target="_blank"
      rel="noopener noreferrer"
    >
      {children} ↗
    </a>
  ) : (
    <span className="rd-muted">출처 미제공</span>
  );
}
export function formatSourceDate(value: string | null, precision = "date") {
  if (!value) return "날짜 미제공";
  if (precision === "date") return value.slice(0, 10).replaceAll("-", ". ");
  const d = new Date(value);
  return Number.isNaN(+d)
    ? "날짜 확인 필요"
    : new Intl.DateTimeFormat("ko-KR", {
        timeZone: "Asia/Seoul",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(d);
}
const saveResult = z.object({ saved: z.boolean() });
export function SaveButton({
  item,
  onSaved,
}: {
  item: Resource;
  onSaved?: () => void;
}) {
  const { token } = useAuth(),
    action = useMutation(),
    [selection, setSelection] = useState({
      token,
      id: item.id,
      kind: item.kind,
      value: item.is_saved,
    });
  useEffect(
    () =>
      setSelection({ token, id: item.id, kind: item.kind, value: item.is_saved }),
    [token, item.id, item.kind, item.is_saved],
  );
  const saved =
    selection.token === token &&
    selection.id === item.id &&
    selection.kind === item.kind
      ? selection.value
      : item.is_saved;
  if (item.kind === "company") return null;
  const kind = item.kind;
  return (
    <span className="rd-save-wrap">
      <button
        type="button"
        className={`rd-icon rd-save ${saved ? "is-saved" : ""}`}
        disabled={action.busy}
        aria-pressed={saved}
        aria-label={`${item.title} ${saved ? "저장 취소" : "저장"}`}
        onClick={() =>
          void action.run(async () => {
            const value = await workspace(
              token,
              { action: "save", p: { id: item.id, kind, saved: !saved } },
              saveResult,
            );
            setSelection({ token, id: item.id, kind, value: value.saved });
            onSaved?.();
          })
        }
      >
        <svg
          aria-hidden="true"
          width="21"
          height="24"
          viewBox="0 0 24 28"
          fill={saved ? "currentColor" : "none"}
          stroke="currentColor"
          strokeWidth="1.8"
        >
          <path d="M5 3h14v22l-7-5-7 5Z" />
        </svg>
      </button>
      <Notice action={action} />
    </span>
  );
}
export function ResourceRows({
  items,
  reviewDate = false,
}: {
  items: Resource[];
  reviewDate?: boolean;
}) {
  return items.length ? (
    <div className="rd-table-scroll">
      <table className="rd-table">
        <thead>
          <tr>
            <th>{reviewDate ? "승인일" : "공개일"}</th>
            <th>기업명</th>
            <th>제목</th>
            <th>
              <span className="rd-sr">열기</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={`${item.kind}:${item.id}`}>
              <td>
                <time>
                  {formatSourceDate(
                    reviewDate ? (item.reviewed_at ?? null) : item.published_at,
                    reviewDate ? "timestamp" : item.publication_precision,
                  )}
                </time>
              </td>
              <td>{item.company_name}</td>
              <td>
                <Link href={resourceHref(item)}>{item.title}</Link>
              </td>
              <td>
                <Link
                  href={resourceHref(item)}
                  aria-label={`${item.title} 열기`}
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
    <p className="rd-empty">조건에 맞는 자료가 없습니다.</p>
  );
}
