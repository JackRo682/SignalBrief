import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { z } from "zod";
import Watchlist from "../src/redesign/watchlist";
import type { Company } from "../src/lib/contracts";
import { pageDataCache } from "../src/lib/page-data-cache";
import { defaults, resourceSchema, sourceOverviewSchema, type Resource } from "../src/workspace/contracts";
import type { CalendarEntry } from "../src/redesign/calendar-utils";
import type { CompanyMonitoring } from "../src/redesign/watchlist-data";

// Real component/hooks with synthetic transports; no provider availability claim.
const mocks = vi.hoisted(() => ({
  request: vi.fn(), workspace: vi.fn(), from: vi.fn(), savePrefs: vi.fn(), push: vi.fn(),
  token: "synthetic-watchlist-owner-a", muted: [] as string[],
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }), usePathname: () => "/watchlist" }));
vi.mock("@/components/auth", () => ({ useAuth: () => ({ token: mocks.token, me: { id: mocks.token }, loading: false }) }));
vi.mock("@/lib/api", async original => ({ ...await original<typeof import("../src/lib/api")>(), request: mocks.request }));
vi.mock("@/workspace/client", async original => ({ ...await original<typeof import("../src/workspace/client")>(), workspace: mocks.workspace }));
vi.mock("@/lib/supabase", () => ({ initializeSupabase: async () => ({ from: mocks.from }) }));
vi.mock("@/workspace/preferences", () => ({ usePrefs: () => ({
  value: { ...defaults, muted_companies: mocks.muted },
  loaded: true, busy: false, error: "", reload: vi.fn(), save: mocks.savePrefs,
  text: (ko: string) => ko, date: (value: string | null) => value ?? "날짜 미제공",
}) }));

const alpha: Company = {
  id: "22000000-0000-4000-8000-000000000001", name: "Alpha Fixture", ticker: "ALPH",
  market: "NASDAQ", provider: "sec", is_demo: true, last_ingested_at: null,
};
const beta: Company = { ...alpha, id: "22000000-0000-4000-8000-000000000002", name: "Beta Fixture", ticker: "BETA", market: "NYSE" };
const korean: Company = { ...alpha, id: "22000000-0000-4000-8000-000000000003", name: "Gamma Korean Fixture", ticker: "123450", market: "KRX", provider: "dart" };
const london: Company = { ...alpha, id: "22000000-0000-4000-8000-000000000004", name: "Delta London Fixture", ticker: "LOND", market: "LSE" };
const outside: Company = { ...alpha, id: "22000000-0000-4000-8000-000000000005", name: "Outside Watchlist Fixture", ticker: "OUT" };
const ownCompanies = [alpha, beta, korean, london];
const filing: Resource = resourceSchema.parse({
  id: "32000000-0000-4000-8000-000000000001", kind: "filing", title: "Alpha synthetic filing", summary: "",
  company_id: alpha.id, company_name: alpha.name, ticker: alpha.ticker, market: alpha.market,
  source_url: "https://example.org/synthetic-alpha-filing", published_at: "2026-10-01T00:00:00Z",
  publication_precision: "timestamp", category: "10-Q", is_saved: false,
});
const analysis: Resource = { ...filing, kind: "us_analysis", title: "Alpha synthetic approved analysis", reviewed_at: "2026-11-04T02:00:00Z" };
const alphaEvent: CalendarEntry = {
  id: "42000000-0000-4000-8000-000000000001", title: "Alpha confirmed meeting", occurs_on: "2026-11-10",
  company_id: alpha.id, event_id: "52000000-0000-4000-8000-000000000001", origin: "official_ir", quote: null,
  source_url: "https://example.org/synthetic-alpha-event", source_timezone: "America/New_York", verified_at: "2026-11-01T00:00:00Z",
};
const betaEvent: CalendarEntry = { ...alphaEvent, id: "42000000-0000-4000-8000-000000000002", company_id: beta.id, title: "Beta confirmed meeting", occurs_on: "2026-11-06" };
const koreanEvent: CalendarEntry = { ...alphaEvent, id: "42000000-0000-4000-8000-000000000003", company_id: korean.id, title: "Korean confirmed meeting", occurs_on: "2026-11-12" };
const foreignEvent: CalendarEntry = { ...alphaEvent, id: "42000000-0000-4000-8000-000000000004", company_id: outside.id, title: "Outside confirmed meeting", occurs_on: "2026-11-05" };

let watched: Company[], monitoring: CompanyMonitoring[], calendarItems: CalendarEntry[];
let calendarFailure: boolean, overviewFailure: boolean, listFailure: boolean;
let calendarQueries: unknown[][][];
function monitor(company: Company, patch: Partial<CompanyMonitoring> = {}): CompanyMonitoring {
  return { company_id: company.id, latest_filing: null, latest_analysis: null, next_event: null,
    last_collected_at: null, filing_count: 0, analysis_count: 0, ...patch };
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-04T03:00:00Z"));
  pageDataCache.reset();
  mocks.token = "synthetic-watchlist-owner-a";
  mocks.muted = [beta.id];
  watched = [...ownCompanies];
  calendarFailure = overviewFailure = listFailure = false;
  calendarQueries = [];
  monitoring = [
    monitor(alpha, { latest_filing: filing, latest_analysis: analysis, filing_count: 2, analysis_count: 1 }),
    monitor(beta, { latest_filing: { ...filing, company_id: beta.id, company_name: beta.name, title: "Beta synthetic filing", published_at: "2026-11-03T02:00:00Z" }, filing_count: 100, analysis_count: 50 }),
    monitor(korean, { latest_filing: { ...filing, company_id: korean.id, company_name: korean.name, title: "Korean synthetic filing", published_at: "2026-11-02T02:00:00Z" }, filing_count: 30 }),
    monitor(london),
    monitor(outside, { latest_filing: { ...filing, company_id: outside.id, company_name: outside.name, title: "Outside synthetic filing", published_at: "2026-11-04T02:59:00Z" }, filing_count: 9999 }),
  ];
  calendarItems = [alphaEvent, foreignEvent, koreanEvent, betaEvent,
    { ...alphaEvent, id: "42000000-0000-4000-8000-000000000005", origin: "user", title: "Private personal reminder", occurs_on: "2026-11-04" },
    { ...alphaEvent, id: "42000000-0000-4000-8000-000000000006", company_id: null, title: "Unassigned date" },
    { ...alphaEvent, id: "42000000-0000-4000-8000-000000000007", occurs_on: "2026-11-03", title: "Past date" },
    { ...alphaEvent, id: "42000000-0000-4000-8000-000000000008", occurs_on: "2027-11-05", title: "Out-of-range date" },
  ];
  mocks.request.mockImplementation(async (path: string, _token: string, schema: z.ZodType, init?: RequestInit) => {
    if (path === "/v1/watchlist") {
      if (listFailure) throw new Error("Synthetic personal watchlist read failed");
      return schema.parse({ id: "synthetic-list", name: "Watchlist", items: [...watched] });
    }
    if (path.startsWith("/v1/companies?")) {
      const q = new URL(path, "https://example.org").searchParams.get("q")!.toLowerCase();
      return schema.parse([...ownCompanies, outside].filter(company => `${company.name} ${company.ticker}`.toLowerCase().includes(q)));
    }
    if (path.startsWith("/v1/watchlist/") && init?.method === "DELETE") {
      watched = watched.filter(company => !path.endsWith(company.id));
      return undefined;
    }
    throw new Error(`Unexpected synthetic request: ${path}`);
  });
  mocks.workspace.mockImplementation(async (_token: string, req: { action: string }) => {
    if (req.action !== "source_overview") throw new Error(`Unexpected workspace action: ${req.action}`);
    if (overviewFailure) throw new Error("Synthetic source overview failed");
    return sourceOverviewSchema.parse({ companies: 5, filing_count: 10131, published_count: 51,
      filings: [], historical_events: [], calendar: [], monitoring, scope: "all", fallback_to_all: true });
  });
  mocks.from.mockImplementation(() => {
    const steps: unknown[][] = [];
    calendarQueries.push(steps);
    const record = (method: string) => (...args: unknown[]) => { steps.push([method, ...args]); return query; };
    const query = {
      select: record("select"), eq: record("eq"), gte: record("gte"), lte: record("lte"),
      in: record("in"), neq: record("neq"), order: record("order"), limit: record("limit"),
      abortSignal: async () => ({ data: calendarFailure ? null : [...calendarItems], error: calendarFailure ? { message: "Synthetic calendar outage" } : null }),
    };
    return query;
  });
  mocks.savePrefs.mockImplementation(async (patch: { muted_companies: string[] }) => { mocks.muted = patch.muted_companies; });
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ items: [], total: 0, source_status: "ready" })));
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

const cardNames = () => screen.queryAllByRole("article").map(card => card.getAttribute("aria-label"));
const names = (...companies: Company[]) => companies.map(company => `${company.name} 관심 기업`);
const upcomingPanel = () => within(screen.getByRole("region", { name: "다가오는 일정" }));
const recentPanel = () => within(screen.getByRole("region", { name: "최근 업데이트된 기업" }));

describe("Watchlist reference layout", () => {
  it("keeps cards and both panels owner scoped even when transports return an all-company fallback", async () => {
    render(<Watchlist />);
    const upcoming = upcomingPanel();
    await upcoming.findByRole("link", { name: /Alpha Fixture Alpha confirmed meeting/ });
    expect(cardNames()).toEqual(names(alpha, beta, korean, london));
    expect(screen.getByRole("heading", { name: "관심 기업", level: 1 })).toBeVisible();
    expect(screen.queryByText(outside.name)).not.toBeInTheDocument();
    for (const title of ["Outside synthetic filing", "Outside confirmed meeting", "Private personal reminder", "Unassigned date", "Past date", "Out-of-range date"])
      expect(screen.queryByText(title)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: `최신 공시 ${filing.title}` })).toHaveAttribute("href", `/documents/${filing.id}?kind=filing`);
    expect(screen.getByRole("link", { name: `최신 분석 ${analysis.title}` })).toHaveAttribute("href", `/documents/${filing.id}?kind=filing&analysis=us`);
    expect(screen.getByRole("link", { name: `다음 일정 ${alphaEvent.title}` })).toHaveAttribute("href", `/events/${alphaEvent.id}?kind=calendar`);
    expect(upcoming.getAllByRole("link").filter(link => link.getAttribute("href")?.startsWith("/events/"))
      .map(link => link.getAttribute("href"))).toEqual([betaEvent, alphaEvent, koreanEvent].map(event => `/events/${event.id}?kind=calendar`));
    expect(upcoming.getByRole("link", { name: /Alpha Fixture Alpha confirmed meeting/ })).not.toHaveTextContent("종일");
    expect(calendarQueries.at(-1)).toEqual(expect.arrayContaining([
      ["eq", "calendar_status", "confirmed"], ["gte", "occurs_on", "2026-11-04"], ["lte", "occurs_on", "2027-11-04"],
      ["in", "company_id", ownCompanies.map(company => company.id).sort()], ["neq", "origin", "user"],
    ]));
    expect(mocks.workspace).toHaveBeenCalledWith(mocks.token,
      { action: "source_overview", p: { scope: "following", days: 0 } }, expect.anything(), expect.anything());
    const recent = recentPanel();
    expect(recent.getAllByRole("link").map(link => link.getAttribute("href"))).toEqual([alpha, beta, korean].map(company => `/companies/${company.id}`));
    expect(recent.getByRole("link", { name: /Alpha Fixture/ })).toHaveTextContent("공시 2건 · 분석 1건");
    expect(recent.getByRole("link", { name: /Beta Fixture/ })).toHaveTextContent("공시 100건 · 분석 50건");
    expect(recent.getByText("최신 자료순 · 누적 공시·승인 분석")).toBeVisible();
  });

  it("combines real filters with update, company-name, event-date, and normalized search ordering", async () => {
    render(<Watchlist />);
    await upcomingPanel().findByRole("link", { name: /Alpha Fixture Alpha confirmed meeting/ });
    expect(cardNames()).toEqual(names(alpha, beta, korean, london));
    fireEvent.change(screen.getByLabelText("관심 기업 정렬"), { target: { value: "name" } });
    expect(cardNames()).toEqual(names(alpha, beta, london, korean));
    fireEvent.change(screen.getByLabelText("관심 기업 정렬"), { target: { value: "event" } });
    expect(cardNames()).toEqual(names(beta, alpha, korean, london));
    const filters = within(screen.getByRole("group", { name: "관심 기업 필터" }));
    fireEvent.click(filters.getByRole("button", { name: "미국" }));
    expect(cardNames()).toEqual(names(beta, alpha));
    expect(filters.getByRole("button", { name: "미국" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(filters.getByRole("button", { name: "한국" }));
    expect(cardNames()).toEqual(names(korean));
    fireEvent.click(filters.getByRole("button", { name: "알림 켬" }));
    expect(cardNames()).toEqual(names(alpha, korean, london));
    fireEvent.click(filters.getByRole("button", { name: "일정 예정" }));
    expect(cardNames()).toEqual(names(beta, alpha, korean));
    fireEvent.click(filters.getByRole("button", { name: "전체" }));
    fireEvent.change(screen.getByLabelText("관심 기업 검색"), { target: { value: "  ALPH  " } });
    expect(cardNames()).toEqual(names(alpha));
    await waitFor(() => expect(mocks.request.mock.calls.some(([path]) => path === "/v1/companies?q=ALPH&limit=50")).toBe(true));
    expect(recentPanel().getAllByRole("link")).toHaveLength(3);
    expect(mocks.request.mock.calls.some(([, , , init]) => ["POST", "PUT", "DELETE"].includes(init?.method))).toBe(false);
  });

  it("does not claim no matches while an alias lookup is debouncing, pending, or failed", async () => {
    const baseRequest = mocks.request.getMockImplementation()!;
    const aliasPath = "/v1/companies?q=issuer-alias&limit=50";
    let rejectAlias!: (reason: Error) => void;
    const pendingAlias = new Promise<unknown>((_resolve, reject) => { rejectAlias = reject; });
    let aliasReady = false;
    mocks.request.mockImplementation((path: string, token: string, schema: z.ZodType, init?: RequestInit) => {
      if (path === aliasPath) return aliasReady ? Promise.resolve(schema.parse([alpha])) : pendingAlias;
      return baseRequest(path, token, schema, init);
    });
    render(<Watchlist />);
    await upcomingPanel().findByRole("link", { name: /Alpha Fixture Alpha confirmed meeting/ });
    fireEvent.change(screen.getByLabelText("관심 기업 검색"), { target: { value: "issuer-alias" } });
    expect(cardNames()).toEqual([]);
    expect(screen.queryByText("검색 조건에 맞는 관심 기업이 없습니다.")).not.toBeInTheDocument();
    await waitFor(() => expect(mocks.request.mock.calls.some(([path]) => path === aliasPath)).toBe(true));
    expect(screen.queryByText("검색 조건에 맞는 관심 기업이 없습니다.")).not.toBeInTheDocument();
    await act(async () => { rejectAlias(new Error("Synthetic alias catalog unavailable")); });
    const discovery = within(screen.getByRole("region", { name: "관심 기업 추가 검색" }));
    expect(await discovery.findByRole("alert")).toHaveTextContent("서버에 연결하지 못했습니다. API 서버 주소와 실행 상태를 확인해 주세요.");
    expect(screen.queryByText("검색 조건에 맞는 관심 기업이 없습니다.")).not.toBeInTheDocument();
    aliasReady = true;
    fireEvent.click(discovery.getByRole("button", { name: "다시 시도" }));
    expect(await screen.findByRole("article", { name: `${alpha.name} 관심 기업` })).toBeVisible();
    expect(cardNames()).toEqual(names(alpha));
    expect(screen.queryByText("검색 조건에 맞는 관심 기업이 없습니다.")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("관심 기업 검색"), { target: { value: "unmapped-name" } });
    expect(screen.queryByText("검색 조건에 맞는 관심 기업이 없습니다.")).not.toBeInTheDocument();
    expect(await screen.findByText("검색 조건에 맞는 관심 기업이 없습니다.")).toBeVisible();
  });

  it("distinguishes undated collected content from genuinely absent updates", async () => {
    monitoring = [
      monitor(alpha, { latest_filing: { ...filing, published_at: null },
        latest_analysis: { ...analysis, published_at: null, reviewed_at: null } }),
      monitor(beta, { filing_count: 2, analysis_count: 1 }),
      monitor(korean), monitor(london),
    ];
    const first = render(<Watchlist />);
    const recent = recentPanel();
    expect(await recent.findByText("업데이트 날짜를 확인할 수 있는 자료가 없습니다.")).toBeVisible();
    expect(recent.queryByText("아직 수집된 관심 기업 업데이트가 없습니다.")).not.toBeInTheDocument();
    expect(recent.queryAllByRole("link")).toHaveLength(0);
    expect(screen.getByRole("link", { name: `최신 공시 ${filing.title}` })).toBeVisible();
    expect(screen.getByRole("link", { name: `최신 분석 ${analysis.title}` })).toBeVisible();
    first.unmount();
    pageDataCache.reset();
    monitoring = ownCompanies.map(company => monitor(company));
    render(<Watchlist />);
    expect(await recentPanel().findByText("아직 수집된 관심 기업 업데이트가 없습니다.")).toBeVisible();
    expect(recentPanel().queryByText("업데이트 날짜를 확인할 수 있는 자료가 없습니다.")).not.toBeInTheDocument();
  });

  it("distinguishes a calendar outage from no events and allows a read-only retry", async () => {
    calendarFailure = true;
    render(<Watchlist />);
    const upcoming = upcomingPanel();
    expect(await upcoming.findByRole("alert")).toHaveTextContent("일정을 불러오지 못했습니다. 다시 시도해 주세요.");
    expect(screen.queryByText("향후 1년간 확인된 관심 기업 일정이 없습니다.")).not.toBeInTheDocument();
    expect(within(screen.getByRole("article", { name: `${alpha.name} 관심 기업` })).getByText("일정을 불러오지 못했습니다.")).toBeVisible();
    expect(screen.getByRole("link", { name: `최신 공시 ${filing.title}` })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "일정 예정" }));
    expect(screen.queryByText("검색 조건에 맞는 관심 기업이 없습니다.")).not.toBeInTheDocument();
    calendarFailure = false;
    calendarItems = [];
    fireEvent.click(upcoming.getByRole("button", { name: "다시 시도" }));
    expect(await upcoming.findByText("향후 1년간 확인된 관심 기업 일정이 없습니다.")).toBeVisible();
    expect(screen.getByText("검색 조건에 맞는 관심 기업이 없습니다.")).toBeVisible();
    expect(calendarQueries).toHaveLength(2);
    expect(mocks.request.mock.calls.some(([, , , init]) => init?.method)).toBe(false);
  });

  it("keeps confirmed calendar data usable when source monitoring fails and restores monitoring on retry", async () => {
    overviewFailure = true;
    render(<Watchlist />);
    await upcomingPanel().findByRole("link", { name: /Alpha Fixture Alpha confirmed meeting/ });
    const recent = recentPanel();
    expect(await recent.findByRole("alert")).toHaveTextContent("Synthetic source overview failed");
    expect(recent.queryByText("아직 수집된 관심 기업 업데이트가 없습니다.")).not.toBeInTheDocument();
    expect(recent.queryAllByRole("link")).toHaveLength(0);
    expect(screen.getByRole("link", { name: `다음 일정 ${alphaEvent.title}` })).toBeVisible();
    overviewFailure = false;
    fireEvent.click(recent.getByRole("button", { name: "다시 시도" }));
    expect(await recent.findByRole("link", { name: /Alpha Fixture/ })).toBeVisible();
    expect(recent.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("does not query a broad calendar or show fallback rows for an empty personal watchlist", async () => {
    watched = [];
    render(<Watchlist />);
    expect(await screen.findByText("첫 관심 기업을 추가해 보세요.")).toBeVisible();
    expect(await upcomingPanel().findByText("관심 기업을 추가하면 예정 일정을 확인할 수 있습니다.")).toBeVisible();
    expect(cardNames()).toEqual([]);
    expect(recentPanel().queryAllByRole("link")).toHaveLength(0);
    expect(mocks.from).not.toHaveBeenCalled();
    expect(screen.queryByText(filing.title)).not.toBeInTheDocument();
    expect(screen.queryByText(outside.name)).not.toBeInTheDocument();
  });

  it("never substitutes all-company monitoring after a failed personal watchlist read", async () => {
    listFailure = true;
    render(<Watchlist />);
    await waitFor(() => expect(screen.getAllByRole("alert").length).toBeGreaterThan(0));
    expect(cardNames()).toEqual([]);
    expect(screen.queryByText("첫 관심 기업을 추가해 보세요.")).not.toBeInTheDocument();
    expect(recentPanel().queryAllByRole("link")).toHaveLength(0);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("clears the previous account's cards and panels before the next account's response arrives", async () => {
    const view = render(<Watchlist />);
    await upcomingPanel().findByRole("link", { name: /Alpha Fixture Alpha confirmed meeting/ });
    let resolveList!: (value: unknown) => void;
    const pendingList = new Promise(resolve => { resolveList = resolve; });
    mocks.request.mockImplementation(() => pendingList);
    mocks.token = "synthetic-watchlist-owner-b";
    view.rerender(<Watchlist />);
    expect(cardNames()).toEqual([]);
    expect(screen.queryByText(filing.title)).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Alpha Fixture Alpha confirmed meeting/ })).not.toBeInTheDocument();
    expect(recentPanel().queryAllByRole("link")).toHaveLength(0);
    await act(async () => { resolveList({ id: "synthetic-next-list", name: "Watchlist", items: [] }); });
    expect(await screen.findByText("첫 관심 기업을 추가해 보세요.")).toBeVisible();
    expect(mocks.request).toHaveBeenLastCalledWith("/v1/watchlist", mocks.token, expect.anything(), expect.anything());
  });
});
