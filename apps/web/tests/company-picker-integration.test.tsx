import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Watchlist from "../src/redesign/watchlist";
import Calendar from "../src/redesign/calendar";
import Companies from "../src/redesign/companies";
import { defaults, type Resource } from "../src/workspace/contracts";
import { companyBusinessProfiles } from "../src/lib/company-business-profiles";
import { pageDataCache } from "../src/lib/page-data-cache";
import type { Company } from "../src/lib/contracts";

// Named user journeys with synthetic identities/transports, not provider accuracy claims.
const mocks = vi.hoisted(() => ({ request: vi.fn(), workspace: vi.fn(), push: vi.fn(), coverage: vi.fn(), dates: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }), usePathname: () => "/calendar" }));
vi.mock("@/components/auth", () => ({ useAuth: () => ({ token: "synthetic-picker-token", me: { id: "synthetic-user" } }) }));
vi.mock("@/lib/api", async original => ({ ...await original<typeof import("../src/lib/api")>(), request: mocks.request }));
vi.mock("@/workspace/client", async original => ({ ...await original<typeof import("../src/workspace/client")>(), workspace: mocks.workspace }));
vi.mock("@/workspace/preferences", () => ({ usePrefs: () => ({ value: defaults, loaded: true, busy: false, error: "", reload: vi.fn(), text: (ko: string) => ko, date: (date: string) => date }) }));
vi.mock("@/redesign/calendar-data", () => ({ useCalendarCoverage: (...args: unknown[]) => mocks.coverage(...args), useCalendarData: (...args: unknown[]) => mocks.dates(...args) }));
const lsId = "21000000-0000-4000-8000-000000000001", muId = "21000000-0000-4000-8000-000000000002";
const issuers = [
  { provider: "dart", provider_company_id: "00000042", ticker: "006260", name: "LS", market: "KR", company_id: null },
  { provider: "sec", provider_company_id: "0000000043", ticker: "MU", name: "MICRON TECHNOLOGY INC", market: "NASDAQ", company_id: null },
];
let registered: Company[], watched: Company[], failActivation: boolean, unavailable: boolean;
let directoryRows: Resource[];
const matches = (name: string, ticker: string, query: string) => `${name} ${ticker}`.toLowerCase().includes(query.toLowerCase());
beforeEach(() => {
  vi.clearAllMocks(); pageDataCache.reset(); registered = []; watched = []; directoryRows = []; failActivation = unavailable = false;
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  mocks.request.mockImplementation(async (path: string, _token: string, _schema: unknown, init?: RequestInit) => {
    if (path.startsWith("/v1/companies")) { const query = new URL(path, "https://synthetic.test").searchParams.get("q") ?? ""; return registered.filter(company => matches(company.name, company.ticker, query)); }
    if (path === "/v1/watchlist") return { id: "synthetic-watchlist", name: "Watchlist", items: [...watched] };
    if (path.startsWith("/v1/watchlist/") && init?.method === "PUT") { const company = registered.find(company => path.endsWith(company.id)); if (!company) throw new Error("Company not registered"); watched = [...watched.filter(row => row.id !== company.id), company]; return null; }
    if (path === "/v1/calendar" && init?.method === "POST") return { id: "31000000-0000-4000-8000-000000000001", ...JSON.parse(String(init.body)), event_id: null, origin: "user", quote: null, source_url: null, is_demo: true };
    throw new Error(`Unexpected synthetic request: ${path}`);
  });
  mocks.workspace.mockImplementation(async (_token: string, req: { action: string }) => req.action === "design_directory"
    ? { items: directoryRows, total: directoryRows.length, counts: { company: directoryRows.length }, markets: ["NASDAQ", "KR"], categories: [], next_offset: null }
    : { companies: registered.length, filing_count: 0, published_count: 0, filings: [], historical_events: [], calendar: [], monitoring: [], scope: "all" });
  mocks.coverage.mockImplementation((id: string | null) => ({ data: { registered_companies: registered.length, covered_companies: 0, selected: id ? { company_id: id, source_count: 0, last_success_at: null, has_error: false } : null }, loading: false, error: "", reload: vi.fn() }));
  mocks.dates.mockReturnValue({ data: { items: [], truncated: false }, loading: false, error: "", reload: vi.fn() });
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      if (failActivation) return Response.json({ error: { code: "upstream_unavailable" } }, { status: 502 });
      const body = JSON.parse(String(init.body)), issuer = issuers.find(row => row.ticker === body.ticker)!;
      const id = issuer.provider === "dart" ? lsId : muId;
      registered.push({ id, name: issuer.name, ticker: issuer.ticker, market: issuer.market, provider: issuer.provider, is_demo: true, last_ingested_at: null });
      return Response.json({ company_id: id, hydration_status: unavailable ? "unavailable" : "ready" });
    }
    const params = new URL(input, "https://synthetic.test").searchParams, query = params.get("q") ?? "";
    const items = issuers.filter(row => matches(row.name, row.ticker, query)).map(row => ({ ...row, company_id: registered.find(company => company.ticker === row.ticker)?.id ?? null }));
    return Response.json({ items, total: items.length, source_status: "ready" });
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const writes = () => mocks.request.mock.calls.filter(([, , , init]) => ["POST", "PUT", "DELETE"].includes(init?.method));

describe("official company selection in each product surface", () => {
  it("distinguishes official date-based entries from all-day personal entries in calendar lists", async () => {
    mocks.dates.mockReturnValue({
      data: { items: [
        { id: "31000000-0000-4000-8000-000000000011", company_id: null, event_id: null, title: "Synthetic official timed webcast", occurs_on: "2026-11-11", origin: "official", quote: "The official source states 9:00 a.m. Pacific Time.", source_url: "https://example.org/official-webcast" },
        { id: "31000000-0000-4000-8000-000000000012", company_id: null, event_id: null, title: "Synthetic personal reminder", occurs_on: "2026-11-11", origin: "user", quote: null, source_url: null },
      ], truncated: false }, loading: false, error: "", reload: vi.fn(),
    });
    render(<Calendar />);
    const upcoming = within(screen.getByRole("heading", { name: /^다가오는 일정/ }).closest("section")!);
    const official = upcoming.getByRole("link", { name: /Synthetic official timed webcast/ });
    const personal = upcoming.getByRole("link", { name: /Synthetic personal reminder/ });
    expect(official).toHaveTextContent("2026-11-11 · 날짜 기준");
    expect(official).not.toHaveTextContent("종일");
    expect(personal).toHaveTextContent("2026-11-11 · 종일");
    expect(personal).not.toHaveTextContent("날짜 기준");
    await waitFor(() => expect(mocks.request).toHaveBeenCalled());
    expect(writes()).toHaveLength(0);
  });

  it("renders source-backed facts for uncurated directory cards while curated descriptions retain priority", async () => {
    const profile: Resource = {
      id: lsId, company_id: lsId, kind: "company", title: "Registered synthetic issuer", company_name: "Registered synthetic issuer",
      ticker: "SYNTH", market: "NASDAQ", summary: "", source_url: null, published_at: null,
      publication_precision: "timestamp", category: "company", is_saved: false,
      official_overview: {
        kind: "profile", provider: "SEC EDGAR", company_id: lsId, provider_company_id: "0000000042", ticker: "SYNTH",
        name: "Verified synthetic legal name", english_name: null, industry_description: "Synthetic official industry", industry_code: null,
        established_on: null, ceo: null, website: null, source_url: "https://www.sec.gov/edgar/browse/?CIK=0000000042",
        source_sha256: "a".repeat(64), fetched_at: "2026-11-01T06:00:00Z",
      },
    };
    directoryRows = [profile, { ...profile, id: muId, company_id: muId, ticker: "AAPL", title: "Curated fixture", company_name: "Curated fixture", official_overview: { ...profile.official_overview!, company_id: muId, ticker: "AAPL" } }];
    render(<Companies />);
    const uncurated = (await screen.findByRole("heading", { name: "Registered synthetic issuer" })).closest("article")!;
    expect(within(uncurated).getByText(/Verified synthetic legal name/)).toBeVisible();
    expect(within(uncurated).getByRole("link", { name: "공식 기업 기본정보 · SEC EDGAR" })).toHaveAttribute("href", profile.official_overview!.source_url);
    expect(within(uncurated).getByText(/2026-11-01T06:00:00Z/)).toBeVisible();
    const curated = screen.getByRole("heading", { name: "Curated fixture" }).closest("article")!;
    expect(within(curated).getByText(companyBusinessProfiles.AAPL.description[0])).toBeVisible();
    expect(within(curated).queryByText(/Verified synthetic legal name/)).not.toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([false, true])("finds LS from the watchlist %s modal/main search and follows only after explicit selection", async modal => {
    render(<Watchlist />);
    if (modal) fireEvent.click(screen.getByRole("button", { name: "기업 추가" }));
    fireEvent.change(screen.getByLabelText(modal ? "추가할 기업 검색" : "관심 기업 검색"), { target: { value: "LS" } });
    const add = await screen.findByRole("button", { name: "LS 관심 기업에 추가" });
    expect(writes()).toHaveLength(0);
    expect(vi.mocked(fetch).mock.calls.every(([, init]) => init?.method !== "POST")).toBe(true);
    fireEvent.click(add);
    await waitFor(() => expect(watched.map(company => company.id)).toEqual([lsId]));
    expect(writes()).toEqual([expect.arrayContaining([`/v1/watchlist/${lsId}`, expect.any(String), expect.anything(), expect.objectContaining({ method: "PUT" })])]);
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("retains LS search and retries activation without following on failure", async () => {
    failActivation = true; render(<Watchlist />);
    fireEvent.change(screen.getByLabelText("관심 기업 검색"), { target: { value: "LS" } });
    fireEvent.click(await screen.findByRole("button", { name: "LS 관심 기업에 추가" }));
    const retry = await screen.findByRole("button", { name: "기업정보 다시 시도" });
    expect(writes()).toHaveLength(0); expect(watched).toHaveLength(0);
    failActivation = false; fireEvent.click(retry);
    await waitFor(() => expect(watched).toHaveLength(1));
  });

  it.each(["LS", "micron"])("finds %s in the calendar and selects its scope without creating an event or follow", async query => {
    render(<Calendar />);
    fireEvent.change(screen.getByLabelText("기업명 또는 티커 검색"), { target: { value: query } });
    const issuer = query === "LS" ? issuers[0] : issuers[1], id = query === "LS" ? lsId : muId;
    const choose = await screen.findByRole("button", { name: `${issuer.name} 일정 조회 기업으로 선택` });
    expect(writes()).toHaveLength(0); expect(mocks.coverage).not.toHaveBeenCalledWith(id);
    fireEvent.click(choose);
    expect(await screen.findByRole("checkbox", { name: `${issuer.name} (${issuer.ticker})` })).toBeChecked();
    expect(mocks.coverage).toHaveBeenCalledWith(id);
    expect(mocks.dates).toHaveBeenCalledWith(expect.objectContaining({ companyIds: [id] }));
    expect(writes()).toHaveLength(0); expect(mocks.push).not.toHaveBeenCalled();
    expect(screen.getByText(/이 기업은 공식 일정 수집이 아직 연결되지 않았습니다/)).toBeVisible();
  });

  it("can bind a newly discovered company to a personal event but writes only on Save", async () => {
    render(<Calendar />);
    fireEvent.click(screen.getByRole("button", { name: "개인 일정 추가" }));
    const modal = screen.getByRole("dialog"), form = within(modal);
    fireEvent.change(form.getByLabelText("제목"), { target: { value: "Synthetic personal reminder" } });
    fireEvent.change(form.getByLabelText("관련 기업 검색"), { target: { value: "micron" } });
    fireEvent.click(await form.findByRole("button", { name: "MICRON TECHNOLOGY INC 관련 기업으로 선택" }));
    await waitFor(() => expect(form.getByLabelText("관련 기업 (선택)")).toHaveValue(muId));
    expect(writes()).toHaveLength(0);
    fireEvent.click(form.getByRole("button", { name: "일정 저장" }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0][0]).toBe("/v1/calendar");
    expect(JSON.parse(writes()[0][3].body)).toMatchObject({ company_id: muId, title: "Synthetic personal reminder" });
  });

  it("shows Micron in overseas discovery without a contradictory registered-company empty message", async () => {
    render(<Companies />);
    fireEvent.click(screen.getByRole("button", { name: "해외주식" }));
    fireEvent.change(screen.getByLabelText("기업명, 티커 또는 키워드 검색"), { target: { value: "micron" } });
    fireEvent.submit(screen.getByRole("search"));
    expect(await screen.findByRole("button", { name: "MICRON TECHNOLOGY INC 기업정보 열기" })).toBeVisible();
    expect(screen.queryByText("조건에 맞는 등록 기업이 없습니다.")).not.toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith("/api/company-discovery?q=micron&market_group=overseas", expect.any(Object));
    expect(writes()).toHaveLength(0);
  });
});
