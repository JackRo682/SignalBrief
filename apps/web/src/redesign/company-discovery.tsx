"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { useAuth } from "@/components/auth";
import { pageDataCache } from "@/lib/page-data-cache";
import { usePrefs } from "@/workspace/preferences";
import { CompanyLogo, Panel } from "./ui";
import { discoveredCompanyHref, marketCategory, normalizeCompanyQuery, type MarketGroup } from "./company-search";
import "./company-discovery.css";

const issuerSchema = z.object({
  provider: z.enum(["sec", "dart"]),
  provider_company_id: z.string().min(1).max(30),
  ticker: z.string().regex(/^[A-Z0-9][A-Z0-9.-]{0,14}$/),
  name: z.string().min(1).max(500),
  market: z.string().max(32),
  company_id: z.string().uuid().nullable(),
});
const discoverySchema = z.object({
  items: z.array(issuerSchema),
  total: z.number().int().nonnegative(),
  source_status: z.enum(["ready", "partial", "unavailable"]),
});
const resolvedSchema = z.object({
  company_id: z.string().uuid(),
  hydration_status: z.enum(["ready", "pending", "unavailable"]),
});
type Issuer = z.infer<typeof issuerSchema>;
type Discovery = z.infer<typeof discoverySchema>;
type Props = {
  query: string;
  existingCompanies?: readonly { id: string; ticker: string }[];
  provider?: "" | "sec" | "dart";
  market?: string;
  marketGroup?: MarketGroup;
};

class DiscoveryError extends Error {
  constructor(readonly status: number, readonly code = "") { super("company_discovery_failed"); }
}
async function responseError(response: Response): Promise<DiscoveryError> {
  const body: unknown = await response.json().catch(() => null);
  const parsed = z.object({ error: z.object({ code: z.string() }) }).safeParse(body);
  return new DiscoveryError(response.status, parsed.success && ["daily_company_limit", "mfa_required"].includes(parsed.data.error.code) ? parsed.data.error.code : "");
}

export default function CompanyDiscovery(props: Props) {
  const { token } = useAuth();
  const query = normalizeCompanyQuery(props.query);
  if (!query || !token) return null;
  // Navigation and account changes discard the previous request and its rows.
  return <DiscoveryResults key={`${token}:${query}`} {...props} query={query} token={token} />;
}

function DiscoveryResults({
  query, token, existingCompanies = [], provider = "", market = "", marketGroup = "all",
}: Props & { token: string }) {
  const router = useRouter();
  const { text: t } = usePrefs();
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{ data: Discovery | null; error: number | null; code?: string; loading: boolean }>({ data: null, error: null, loading: true });
  const [opening, setOpening] = useState("");
  const [openError, setOpenError] = useState<{ key: string; status: number; code?: string } | null>(null);
  const active = useRef(true);
  const openController = useRef<AbortController | null>(null);
  const openLock = useRef(false);

  useEffect(() => {
    active.current = true;
    return () => { active.current = false; openController.current?.abort(); };
  }, []);

  useEffect(() => {
    let live = true;
    const controller = new AbortController();
    setState({ data: null, error: null, loading: true });
    void fetch(`/api/company-discovery?${new URLSearchParams({ q: query })}`, {
      headers: { Authorization: `Bearer ${token}` },
      credentials: "omit", cache: "no-store",
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(60000)]),
    }).then(async response => {
      if (!response.ok) throw await responseError(response);
      const data = discoverySchema.parse(await response.json());
      if (live) setState({ data, error: null, loading: false });
    }).catch((error: unknown) => {
      if (live) setState({ data: null, error: error instanceof DiscoveryError ? error.status : 502, code: error instanceof DiscoveryError ? error.code : "", loading: false });
    });
    return () => { live = false; controller.abort(); };
  }, [query, token, revision]);

  const message = (status: number, code = "") => code === "daily_company_limit"
    ? t("오늘 신규 기업 연결 한도에 도달했습니다. 이미 등록된 기업은 계속 열 수 있습니다.", "Today's new-company connection limit has been reached. Existing company pages remain available.")
    : code === "mfa_required"
      ? t("계정의 추가 인증을 완료한 뒤 다시 시도해 주세요.", "Complete your account verification, then retry.")
    : status === 401
    ? t("로그인이 만료되었습니다. 다시 로그인해 주세요.", "Your session expired. Sign in again.")
    : status === 429
      ? t("검색 요청이 많습니다. 잠시 후 다시 시도해 주세요.", "Too many requests. Please try again shortly.")
      : t("공식 기업목록에 연결하지 못했습니다. 다시 시도해 주세요.", "The official company directory could not be reached. Please retry.");

  async function openCompany(item: Issuer) {
    if (openLock.current) return;
    openLock.current = true;
    const key = `${item.provider}:${item.provider_company_id}:${item.ticker}`;
    const controller = new AbortController();
    openController.current = controller;
    setOpening(key); setOpenError(null);
    try {
      const response = await fetch("/api/company-discovery", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        credentials: "omit", cache: "no-store",
        body: JSON.stringify({ provider: item.provider, provider_company_id: item.provider_company_id, ticker: item.ticker }),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(60000)]),
      });
      if (!response.ok) throw await responseError(response);
      const data = resolvedSchema.parse(await response.json());
      if (!active.current) return;
      pageDataCache.reset(token);
      router.push(discoveredCompanyHref(data.company_id, item.ticker, data.hydration_status));
    } catch (error: unknown) {
      if (active.current) setOpenError({ key, status: error instanceof DiscoveryError ? error.status : 502, code: error instanceof DiscoveryError ? error.code : "" });
    } finally {
      openLock.current = false;
      if (active.current) setOpening("");
    }
  }

  const excluded = new Set(existingCompanies.map(item => `${item.id}:${item.ticker.toUpperCase()}`));
  const alreadyShown = (item: Issuer) => !!item.company_id && excluded.has(`${item.company_id}:${item.ticker}`);
  const items = state.data?.items.filter(item =>
    !alreadyShown(item) &&
    (!provider || item.provider === provider) &&
    (!market || item.market.toUpperCase() === market.toUpperCase()) &&
    (marketGroup === "all" || marketCategory(item.market) === marketGroup),
  ) ?? [];
  // Avoid repeating a second empty section when all directory matches are already shown.
  if (state.data?.source_status === "ready" && state.data.items.length > 0 && !items.length &&
      state.data.total <= state.data.items.length &&
      state.data.items.every(alreadyShown)) return null;

  return (
    <Panel title={t("공식 기업목록 검색", "Official company directory")} className="rd-discovery">
      {state.loading && <p role="status" className="rd-muted">{t("공식 기업목록을 검색하고 있습니다.", "Searching the official company directory.")}</p>}
      {state.error !== null && <div role="alert" className="rd-discovery-notice">
        <p>{message(state.error, state.code)}</p>
        <button className="rd-btn" onClick={() => setRevision(value => value + 1)}>{t("기업목록 다시 시도", "Retry company directory")}</button>
      </div>}
      {state.data && state.data.source_status !== "ready" && <div role="status" className="rd-discovery-notice">
        <p>{state.data.source_status === "partial"
          ? t("일부 출처의 기업목록을 확인하지 못했습니다. 확인된 결과를 표시합니다.", "Some directory sources are unavailable. Available results are shown.")
          : t("공식 기업목록을 확인하지 못했습니다. 검색 결과가 없다는 뜻은 아닙니다.", "The company directory is unavailable. This does not mean there are no matching companies.")}</p>
        <button className="rd-btn" onClick={() => setRevision(value => value + 1)}>{t("기업목록 다시 시도", "Retry company directory")}</button>
      </div>}
      {items.length > 0 && <ul className="rd-discovery-list">
        {items.map(item => {
          const key = `${item.provider}:${item.provider_company_id}:${item.ticker}`;
          const identity = <><CompanyLogo ticker={item.ticker} /><span className="rd-discovery-identity"><strong>{item.name}</strong><small>{item.ticker} · {item.market || t("시장 미분류", "Unclassified market")} · {item.provider === "sec" ? "SEC" : "DART"}</small></span></>;
          return <li key={key}>
            {item.company_id ? <Link className="rd-discovery-result" href={discoveredCompanyHref(item.company_id, item.ticker)}>{identity}<span aria-hidden="true">›</span></Link> :
              <button type="button" className="rd-discovery-result" disabled={!!opening} onClick={() => void openCompany(item)} aria-label={`${item.name} ${t("기업정보 열기", "Open company information")}`}>
                {identity}<span className="rd-discovery-action">{opening === key ? t("정보 연결 중", "Loading information") : t("기업정보 열기", "Open company information")}</span>
              </button>}
            {openError?.key === key && <p role="alert" className="rd-discovery-open-error">{message(openError.status, openError.code)} {openError.code !== "daily_company_limit" && <button className="rd-btn" disabled={!!opening} onClick={() => void openCompany(item)}>{t("기업정보 다시 시도", "Retry company information")}</button>}</p>}
          </li>;
        })}
      </ul>}
      {state.data?.source_status === "ready" && !items.length && <p className="rd-empty">{state.data.items.length
        ? t("현재 조건에서 추가로 표시할 기업이 없습니다. 등록 기업 결과를 확인하거나 검색 조건을 넓혀 주세요.", "There are no additional companies to show under these filters. Check the registered results or broaden the search.")
        : t("공식 기업목록에 일치하는 결과가 없습니다. 회사명 또는 종목코드를 확인해 주세요.", "No matching company was found in the official directory. Check the company name or ticker.")}</p>}
      {items.some(item => !item.company_id) && <p className="rd-discovery-footnote">{t("기업을 열면 공식 기업정보와 수집 가능한 공시를 연결합니다. 승인 분석과 확정 일정의 제공 범위는 기업별로 다릅니다.", "Opening a company connects its official profile and available disclosures. Approved analyses and confirmed event coverage vary by company.")}</p>}
      {state.data && state.data.total > state.data.items.length && <p className="rd-discovery-footnote">{t("검색 결과가 많습니다. 회사명 또는 종목코드를 더 구체적으로 입력해 주세요.", "More companies match this search. Enter a more specific name or ticker.")}</p>}
    </Panel>
  );
}
