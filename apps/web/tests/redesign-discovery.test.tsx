import "@testing-library/jest-dom/vitest";
import {
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import Home from "../src/redesign/home";
import Companies, { marketCategory } from "../src/redesign/companies";
import Search from "../src/redesign/search";
import {
  koreaDate,
  rangeStart,
  validRange,
} from "../src/redesign/dashboard-contract";
import { addDays } from "../src/redesign/calendar-utils";
import { defaults, type Resource } from "../src/workspace/contracts";
const mocks = vi.hoisted(() => ({
  data: vi.fn(),
  push: vi.fn(),
  reload: vi.fn(),
  workspace: vi.fn(),
  fetch: vi.fn(),
  resource: vi.fn(),
  calendar: vi.fn(),
  snapshot: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
  useSearchParams: () => new URLSearchParams(window.location.search),
}));
vi.mock("@/components/auth", () => ({
  useAuth: () => ({ token: "test-redesign-token", me: { id: "reader" } }),
}));
vi.mock("@/workspace/preferences", () => ({
  usePrefs: () => ({
    loaded: true,
    text: (ko: string) => ko,
    date: (s: string) => s,
    value: defaults,
  }),
}));
vi.mock("@/workspace/ui", async (original) => ({
  ...(await original<typeof import("../src/workspace/ui")>()),
  useData: (req: unknown) => mocks.data(req),
}));
vi.mock("@/components/ui", async (original) => ({
  ...(await original<typeof import("../src/components/ui")>()),
  useResource: (...args: unknown[]) => mocks.resource(...args),
}));
vi.mock("../src/redesign/calendar-data", () => ({
  useCalendarData: (...args: unknown[]) => mocks.calendar(...args),
}));
vi.mock("@/workspace/client", () => ({
  workspace: (...args: unknown[]) => mocks.workspace(...args),
}));
vi.mock("../src/redesign/home-snapshot", async (original) => ({
  ...(await original<typeof import("../src/redesign/home-snapshot")>()),
  useHomeSnapshot: (today: string) => mocks.snapshot(today),
}));
const id = "22000000-0000-4000-8000-000000000001";
const company: Resource = {
  id,
  kind: "company",
  title: "Synthetic company",
  summary: "Synthetic business description",
  company_id: id,
  company_name: "Synthetic company",
  ticker: "TEST",
  market: "KRX",
  source_url: null,
  published_at: null,
  publication_precision: "date",
  category: "",
  is_saved: false,
};
const newsCompany: Resource = {
  ...company,
  id: "22000000-0000-4000-8000-000000000002",
  company_id: "22000000-0000-4000-8000-000000000002",
  company_name: "Synthetic news-covered company",
  ticker: "aapl",
  market: "US",
};
const filing: Resource = {
  ...company,
  id: "33000000-0000-4000-8000-000000000001",
  kind: "filing",
  title: "Synthetic filing",
  published_at: "2026-11-01T00:00:00Z",
};
let failure = false;
let catalogCompanies: Resource[];
beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState(null, "", "/explore");
  failure = false;
  mocks.resource.mockReturnValue({data:{id:"watchlist", name:"Watchlist", items:[]}, loading:false, error:null, reload:mocks.reload});
  mocks.calendar.mockReturnValue({data:{items:[], truncated:false}, loading:false, error:"", reload:mocks.reload});
  catalogCompanies = [newsCompany];
  vi.stubGlobal("fetch", mocks.fetch);
  mocks.fetch.mockResolvedValue({
    ok: true,
    json: async () => ({
      provider: "NAVER",
      query: "삼성전자",
      retrievedAt: "2026-11-01T00:00:00Z",
      items: [],
    }),
  });
  mocks.workspace.mockResolvedValue({ saved: true });
  mocks.data.mockImplementation(
    (req: { action: string; p: Record<string, unknown> } | null) => ({
      data:
        req?.action === "design_dashboard"
          ? failure
            ? null
            : {
                filing_count: 42,
                analysis_count: 7,
                event_count: 3,
                filings: [filing],
                analyses: [],
                events: [],
              }
          : req?.action === "source_overview"
            ? { monitoring: [] }
            : req?.action === "design_directory"
              ? {
                  items: [company],
                  total: 1,
                  markets: ["KRX"],
                  next_offset: null,
                }
              : req?.action === "catalog"
                ? {
                    items:
                      req.p.kind === "company"
                        ? catalogCompanies
                        : req.p.kind === "analysis"
                          ? []
                          : [filing],
                    total: 1,
                    counts: { company: 2, filing: 7, us_analysis: 3 },
                    markets: ["KRX"],
                    next_offset: null,
                  }
                : null,
      error:
        failure && req?.action === "design_dashboard" ? "Synthetic outage" : "",
      loading: false,
      reload: mocks.reload,
    }),
  );
  mocks.snapshot.mockImplementation((today: string) => {
    // The snapshot and legacy fallback fixture expose the same synthetic records.
    // Calling the implementations directly does not pretend a legacy hook read ran.
    const read = mocks.data.getMockImplementation()!;
    const watchlist = mocks.resource.getMockImplementation()!();
    const directory = read({ action: "catalog", p: { kind: "company", limit: 50 } });
    const monitoring = read({ action: "source_overview", p: { scope: "following", days: 0 } });
    const dashboard = read({ action: "design_dashboard", p: { start_date: rangeStart(today, 30), end_date: today, company_id: "" } });
    const parts = [watchlist, directory, monitoring, dashboard];
    const failed = parts.some(part => part.error);
    const loading = parts.some(part => part.loading);
    return {
      data: failed || loading ? null : {
        today, as_of: new Date().toISOString(), watchlist: watchlist.data,
        directory: directory.data, monitoring: monitoring.data?.monitoring ?? [], dashboard: dashboard.data,
      },
      loading, error: failed ? "Synthetic Home snapshot unavailable" : "", fallback: failed, reload: mocks.reload,
    };
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
describe("screenshot discovery behavior", () => {
  it("uses calendar days in Korea without changing date-only source meaning", () => {
    expect(koreaDate(new Date("2026-10-31T15:00:00Z"))).toBe("2026-11-01");
    expect(rangeStart("2026-03-01", 3)).toBe("2026-02-27");
    expect(validRange("2026-02-30", "2026-03-01")).toBe(false);
    expect(validRange("2026-11-02", "2026-11-01")).toBe(false);
    expect(validRange("2026-11-01", "2026-11-01")).toBe(true);
  });
  it("uses server totals instead of five-row previews and applies exact date boundaries", async () => {
    render(<Home />);
    expect(mocks.snapshot).toHaveBeenCalledWith(koreaDate());
    expect(mocks.data.mock.calls.every(([request]) => request === null)).toBe(true);
    expect(mocks.resource.mock.calls.every(([path]) => path === null)).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "조회 설정" }));
    expect(screen.getByText("42")).toBeVisible();
    fireEvent.change(screen.getByLabelText("시작일"), {
      target: { value: "2026-10-01" },
    });
    fireEvent.change(screen.getByLabelText("종료일"), {
      target: { value: "2026-10-31" },
    });
    fireEvent.click(screen.getByRole("button", { name: "적용" }));
    expect(mocks.data).toHaveBeenCalledWith({
      action: "design_dashboard",
      p: { company_id: "", start_date: "2026-10-01", end_date: "2026-10-31" },
    });
    await waitFor(() => expect(mocks.fetch).toHaveBeenCalled());
  });
  it("keeps dashboard failures distinct from a real zero and supports retry", async () => {
    failure = true;
    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: "조회 설정" }));
    const kpis = document.querySelector(".rd-kpis")!;
    expect(within(kpis as HTMLElement).getAllByText("조회 불가")).toHaveLength(
      3,
    );
    expect(screen.queryByText("Synthetic filing")).not.toBeInTheDocument();
    expect(document.querySelector("[data-home-snapshot-error]")).toHaveTextContent("Synthetic Home snapshot unavailable");
    fireEvent.click(within(screen.getByRole("tabpanel")).getByRole("button", { name: "다시 시도" }));
    expect(mocks.reload).toHaveBeenCalled();
    await waitFor(() => expect(mocks.fetch).toHaveBeenCalled());
  });
  it("defaults all-company news to the first covered company when an unsupported company comes first", async () => {
    catalogCompanies = [company, newsCompany];
    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: "조회 설정" }));
    await screen.findByText(/선택 기업의 최신 검색결과 0건입니다/);
    expect(screen.getByLabelText("기업 필터")).toHaveValue("");
    expect(screen.getByText("Synthetic news-covered company · 최신 검색")).toBeVisible();
    expect(mocks.fetch).toHaveBeenCalledExactlyOnceWith(
      `/api/news?company_id=${newsCompany.id}`,
      expect.objectContaining({ headers: { Authorization: "Bearer test-redesign-token" } }),
    );
  });
  it("preserves an explicitly selected unsupported company and shows its news limitation", async () => {
    catalogCompanies = [newsCompany, company];
    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: "조회 설정" }));
    await screen.findByText(/선택 기업의 최신 검색결과 0건입니다/);
    mocks.fetch.mockResolvedValueOnce({ ok: false, status: 422 });
    fireEvent.change(screen.getByLabelText("기업 필터"), { target: { value: company.id } });
    expect(await screen.findByText("이 기업의 뉴스 검색은 아직 지원하지 않습니다.")).toBeVisible();
    expect(screen.getByLabelText("기업 필터")).toHaveValue(company.id);
    expect(screen.getByText("Synthetic company · 최신 검색")).toBeVisible();
    expect(screen.queryByText("Synthetic news-covered company · 최신 검색")).not.toBeInTheDocument();
    expect(mocks.fetch.mock.calls.map(([url]) => url)).toEqual([
      `/api/news?company_id=${newsCompany.id}`,
      `/api/news?company_id=${company.id}`,
    ]);
  });
  it("explains missing news coverage without requesting news when all registered companies are unsupported", () => {
    catalogCompanies = [company];
    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: "조회 설정" }));
    expect(screen.getByText("뉴스 검색이 연결된 기업이 없습니다.")).toBeVisible();
    expect(screen.queryByText("뉴스를 조회할 등록 기업이 없습니다.")).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: company.company_name })).toBeInTheDocument();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("opens the activity type from a metric and supports keyboard tabs and hidden query controls", async () => {
    render(<Home />);
    expect(screen.getByRole("button", {name:"조회 설정"})).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("combobox", {name:"기업 필터"})).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("link", {name:/기간 내 공개 공시/}));
    expect(screen.getByRole("tab", {name:"공시"})).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toHaveTextContent(filing.title);
    fireEvent.keyDown(screen.getByRole("tab", {name:"공시"}), {key:"ArrowRight"});
    expect(screen.getByRole("tab", {name:"분석"})).toHaveFocus();
    expect(screen.getByRole("tabpanel")).not.toHaveTextContent(filing.title);
    fireEvent.keyDown(screen.getByRole("tab", {name:"분석"}), {key:"End"});
    expect(screen.getByRole("tab", {name:"일정"})).toHaveAttribute("aria-selected", "true");
    fireEvent.click(screen.getByRole("button", {name:"조회 설정"}));
    expect(screen.getByRole("combobox", {name:"기업 필터"})).toBeVisible();
    await waitFor(() => expect(mocks.fetch).toHaveBeenCalled());
  });
  it("never populates an empty watchlist with all-company fallback records", async () => {
    const original=mocks.data.getMockImplementation()!;
    mocks.data.mockImplementation(req => req?.action === "source_overview" ? {
      data:{monitoring:[{company_id:id,latest_filing:filing,latest_analysis:null}]},loading:false,error:"",reload:mocks.reload,
    } : original(req));
    const event = {id:"44000000-0000-4000-8000-000000000004",company_id:newsCompany.id,title:"Official date without a watchlist",occurs_on:koreaDate(),event_id:null,origin:"official_ir",quote:null,source_url:"https://example.com/event"};
    mocks.calendar.mockReturnValue({data:{items:[event],truncated:false},loading:false,error:"",reload:mocks.reload});
    render(<Home />);
    const following=within(document.querySelector(".rd-home-following") as HTMLElement);
    const upcoming=within(document.querySelector(".rd-home-upcoming") as HTMLElement);
    expect(following.queryByText(filing.title)).not.toBeInTheDocument();
    expect(following.getByText("관심 기업을 추가하면 최신 소식을 확인할 수 있습니다.")).toBeVisible();
    expect(upcoming.getByRole("link", {name:/Official date without a watchlist/})).toBeVisible();
    expect(mocks.calendar.mock.calls.at(-1)?.[0]).toMatchObject({includePersonal:false});
    expect(mocks.calendar.mock.calls.at(-1)?.[0].companyIds).toBeUndefined();
    fireEvent.click(within(screen.getByRole("group", {name:"다가오는 일정 기업 범위"})).getByRole("button", {name:"관심 기업"}));
    expect(mocks.calendar.mock.calls.at(-1)?.[0]).toMatchObject({companyIds:[],includePersonal:false});
    expect(upcoming.queryByText(event.title)).not.toBeInTheDocument();
    expect(upcoming.getByText("관심 기업을 추가하면 다가오는 일정을 확인할 수 있습니다.")).toBeVisible();
    expect(mocks.snapshot).toHaveBeenCalledWith(koreaDate());
    expect(mocks.data).not.toHaveBeenCalledWith({action:"source_overview",p:{scope:"following",days:0}});
    await waitFor(() => expect(mocks.fetch).toHaveBeenCalled());
  });
  it("waits on one Home snapshot without starting legacy reads or exposing fallback records", () => {
    mocks.resource.mockReturnValue({data:null,loading:true,error:null,reload:mocks.reload});
    const original=mocks.data.getMockImplementation()!;
    mocks.data.mockImplementation(req => req?.action === "source_overview" ? {
      data:{monitoring:[{company_id:id,latest_filing:filing,latest_analysis:null}]},
      loading:false,error:"",reload:mocks.reload,
    } : original(req));
    render(<Home />);
    expect(mocks.snapshot).toHaveBeenCalledWith(koreaDate());
    expect(mocks.data.mock.calls.every(([request]) => request === null)).toBe(true);
    expect(mocks.resource).toHaveBeenCalledWith(null, expect.anything());
    const following=within(document.querySelector(".rd-home-following") as HTMLElement);
    expect(following.queryByText(filing.title)).not.toBeInTheDocument();
    expect(following.getByRole("status", {name:"불러오는 중"})).toBeVisible();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("isolates followed monitoring and verified future dates from unrelated and personal records", async () => {
    const watched={id,name:company.company_name,ticker:company.ticker,market:"KRX",provider:"dart",is_demo:false,last_ingested_at:null};
    mocks.resource.mockReturnValue({data:{id:"list",name:"Watchlist",items:[watched]},loading:false,error:null,reload:mocks.reload});
    const original=mocks.data.getMockImplementation()!;
    mocks.data.mockImplementation(req => req?.action === "source_overview" ? {
      data:{monitoring:[{company_id:id,latest_filing:filing,latest_analysis:null},{company_id:newsCompany.id,latest_filing:{...filing,company_id:newsCompany.id,title:"Unfollowed source"},latest_analysis:null}]},loading:false,error:"",reload:mocks.reload,
    } : original(req));
    const day=koreaDate();
    const event={id:"44000000-0000-4000-8000-000000000001",company_id:id,title:"Confirmed future date",occurs_on:day,event_id:null,origin:"official_ir",quote:null,source_url:"https://example.com/event"};
    mocks.calendar.mockReturnValue({data:{items:[event,{...event,id:"personal",title:"Personal event",origin:"user"},{...event,id:"unrelated",company_id:newsCompany.id,title:"Unrelated event"}],truncated:false},loading:false,error:"",reload:mocks.reload});
    render(<Home />);
    const following=within(document.querySelector(".rd-home-following") as HTMLElement);
    expect(following.getByText(filing.title)).toBeVisible();
    expect(following.queryByText("Unfollowed source")).not.toBeInTheDocument();
    const upcoming=within(document.querySelector(".rd-home-upcoming") as HTMLElement);
    fireEvent.click(within(upcoming.getByRole("group", {name:"다가오는 일정 기업 범위"})).getByRole("button", {name:"관심 기업"}));
    expect(upcoming.getByRole("link",{name:/Confirmed future date/})).toHaveAttribute("href",`/events/${event.id}?kind=calendar`);
    expect(upcoming.queryByText("Personal event")).not.toBeInTheDocument();
    expect(upcoming.queryByText("Unrelated event")).not.toBeInTheDocument();
    expect(upcoming.getByText("날짜 확정")).toBeVisible();
    expect(upcoming.queryByText(/10:00|종일/)).not.toBeInTheDocument();
    expect(mocks.calendar.mock.calls.at(-1)?.[0]).toMatchObject({from:day,companyIds:[id],includePersonal:false});
    expect(screen.getByRole("heading",{name:"관심 기업 1곳의 주요 소식을 모았습니다."})).toBeVisible();
    await waitFor(() => expect(mocks.fetch).toHaveBeenCalled());
  });
  it("shows all-company dates when only an unfollowed company has upcoming events and recovers from an empty following scope", async () => {
    catalogCompanies = [company, newsCompany];
    const watched = {id,name:company.company_name,ticker:company.ticker,market:"KRX",provider:"dart",is_demo:false,last_ingested_at:null};
    mocks.resource.mockReturnValue({data:{id:"list",name:"Watchlist",items:[watched]},loading:false,error:null,reload:mocks.reload});
    const day = koreaDate(), until = addDays(day, 30);
    const event = {id:"44000000-0000-4000-8000-000000000002",company_id:newsCompany.id,title:"Unfollowed company official date",occurs_on:addDays(day, 2),event_id:null,origin:"official_ir",quote:null,source_url:"https://example.com/event"};
    const reloadCalendar = vi.fn();
    mocks.calendar.mockReturnValue({data:{items:[event,
      {...event,id:"personal",title:"Excluded personal date",origin:"user"},
      {...event,id:"past",title:"Excluded past date",occurs_on:addDays(day, -1)},
      {...event,id:"later",title:"Excluded distant date",occurs_on:addDays(until, 1)},
    ],truncated:false},loading:false,error:"",reload:reloadCalendar});
    render(<Home />);
    const upcoming = within(document.querySelector(".rd-home-upcoming") as HTMLElement);
    const scope = within(upcoming.getByRole("group", {name:"다가오는 일정 기업 범위"}));
    expect(scope.getByRole("button", {name:"전체 기업"})).toHaveAttribute("aria-pressed", "true");
    expect(scope.getByRole("button", {name:"관심 기업"})).toHaveAttribute("aria-pressed", "false");
    expect(mocks.calendar.mock.calls.at(-1)?.[0]).toMatchObject({from:day,until,includePersonal:false});
    expect(mocks.calendar.mock.calls.at(-1)?.[0].companyIds).toBeUndefined();
    expect(upcoming.getByRole("link", {name:/Unfollowed company official date/})).toHaveAttribute("href", `/events/${event.id}?kind=calendar`);
    expect(upcoming.getByText(newsCompany.company_name)).toBeVisible();
    for (const title of ["Excluded personal date", "Excluded past date", "Excluded distant date"])
      expect(upcoming.queryByText(title)).not.toBeInTheDocument();
    fireEvent.click(upcoming.getByRole("button", {name:"다가오는 일정 새로고침"}));
    expect(reloadCalendar).toHaveBeenCalledOnce();

    fireEvent.click(scope.getByRole("button", {name:"관심 기업"}));
    expect(scope.getByRole("button", {name:"관심 기업"})).toHaveAttribute("aria-pressed", "true");
    expect(mocks.calendar.mock.calls.at(-1)?.[0]).toMatchObject({from:day,until,companyIds:[id],includePersonal:false});
    expect(upcoming.queryByText(event.title)).not.toBeInTheDocument();
    expect(upcoming.getByText("앞으로 30일간 확인된 관심 기업 일정이 없습니다.")).toBeVisible();
    fireEvent.click(upcoming.getByRole("button", {name:"전체 기업 일정 보기"}));
    expect(scope.getByRole("button", {name:"전체 기업"})).toHaveAttribute("aria-pressed", "true");
    expect(upcoming.getByRole("link", {name:/Unfollowed company official date/})).toBeVisible();
    expect(mocks.calendar.mock.calls.at(-1)?.[0].companyIds).toBeUndefined();
    await waitFor(() => expect(mocks.fetch).toHaveBeenCalled());
  });
  it("keeps all-company dates available during watchlist failures while rejecting cached following records", async () => {
    mocks.resource.mockReturnValue({data:{id:"list",name:"Watchlist",items:[{id,name:"Cached company"}]},loading:false,error:"Watchlist unavailable",reload:mocks.reload});
    const day = koreaDate();
    const event = {id:"44000000-0000-4000-8000-000000000003",company_id:newsCompany.id,title:"Available official date",occurs_on:day,event_id:null,origin:"official_ir",quote:null,source_url:"https://example.com/event"};
    mocks.calendar.mockReturnValue({data:{items:[event],truncated:false},loading:false,error:"",reload:mocks.reload});
    render(<Home />);
    const following=within(document.querySelector(".rd-home-following") as HTMLElement);
    expect(following.getByRole("alert")).toHaveTextContent("Watchlist unavailable");
    expect(following.queryByText(/관심 기업을 추가하면/)).not.toBeInTheDocument();
    expect(screen.getByRole("heading",{name:"관심 기업의 소식을 불러오지 못했습니다."})).toBeVisible();
    const upcoming = within(document.querySelector(".rd-home-upcoming") as HTMLElement);
    const scope = within(upcoming.getByRole("group", {name:"다가오는 일정 기업 범위"}));
    expect(upcoming.getByRole("link", {name:/Available official date/})).toHaveAttribute("href", `/events/${event.id}?kind=calendar`);
    expect(upcoming.queryByRole("alert")).not.toBeInTheDocument();
    expect(mocks.calendar.mock.calls.at(-1)?.[0]).toMatchObject({from:day,includePersonal:false});
    expect(mocks.calendar.mock.calls.at(-1)?.[0].companyIds).toBeUndefined();
    fireEvent.click(scope.getByRole("button", {name:"관심 기업"}));
    expect(mocks.calendar.mock.calls.at(-1)?.[0]).toBeNull();
    expect(upcoming.getByRole("alert")).toHaveTextContent("Watchlist unavailable");
    expect(upcoming.queryByText(event.title)).not.toBeInTheDocument();
    expect(upcoming.queryByText("앞으로 30일간 확인된 관심 기업 일정이 없습니다.")).not.toBeInTheDocument();
    fireEvent.click(scope.getByRole("button", {name:"전체 기업"}));
    expect(upcoming.getByRole("link", {name:/Available official date/})).toBeVisible();
    expect(upcoming.queryByRole("alert")).not.toBeInTheDocument();
    fireEvent.click(following.getByRole("button",{name:"다시 시도"}));
    expect(mocks.reload).toHaveBeenCalled();
    await waitFor(() => expect(mocks.fetch).toHaveBeenCalled());
  });
  it("keeps followed-company news loading and failures distinct from empty updates without hiding monitoring records", async () => {
    const watched = { id: newsCompany.id, name: newsCompany.company_name, ticker: newsCompany.ticker,
      market: "US", provider: "sec", is_demo: false, last_ingested_at: null };
    mocks.resource.mockReturnValue({ data: { id: "list", name: "Watchlist", items: [watched] },
      loading: false, error: null, reload: mocks.reload });
    const original = mocks.data.getMockImplementation()!;
    const followedFiling = { ...filing, company_id: newsCompany.id,
      company_name: newsCompany.company_name, ticker: newsCompany.ticker, title: "Available followed filing" };
    let hasMonitoring = false;
    mocks.data.mockImplementation(req => req?.action === "source_overview" ? {
      data: { monitoring: hasMonitoring ? [{ company_id: newsCompany.id,
        latest_filing: followedFiling, latest_analysis: null }] : [] },
      loading: false, error: "", reload: mocks.reload,
    } : original(req));
    let respond!: (response: { ok: boolean; status: number }) => void;
    mocks.fetch.mockReturnValueOnce(new Promise(resolve => { respond = resolve; }));
    const view = render(<Home />);
    const following = within(document.querySelector(".rd-home-following") as HTMLElement);
    expect(following.getByRole("status", { name: "불러오는 중" })).toBeVisible();
    expect(following.queryByText("아직 수집된 최신 소식이 없습니다.")).not.toBeInTheDocument();

    hasMonitoring = true;
    view.rerender(<Home />);
    expect(following.getByText(followedFiling.title)).toBeVisible();
    expect(following.queryByRole("status")).not.toBeInTheDocument();
    expect(within(screen.getByRole("tabpanel")).getByText(filing.title)).toBeVisible();
    expect(within(screen.getByRole("tabpanel")).queryByRole("status")).not.toBeInTheDocument();

    respond({ ok: false, status: 500 });
    expect(await following.findByRole("alert")).toHaveTextContent("뉴스 제공자에 연결하지 못했습니다.");
    expect(following.queryByRole("status")).not.toBeInTheDocument();
    expect(following.queryByText("아직 수집된 최신 소식이 없습니다.")).not.toBeInTheDocument();

    hasMonitoring = true;
    view.rerender(<Home />);
    expect(following.getByText(followedFiling.title)).toBeVisible();
    expect(following.getByRole("alert")).toHaveTextContent("뉴스 제공자에 연결하지 못했습니다.");
    fireEvent.click(following.getByRole("button", { name: "다시 시도" }));
    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(following.queryByRole("alert")).not.toBeInTheDocument());
    expect(following.getByText(followedFiling.title)).toBeVisible();
  });
  it("does not show unrelated-company news failures inside followed updates", async () => {
    mocks.resource.mockReturnValue({ data: { id: "list", name: "Watchlist", items: [
      { id, name: company.company_name, ticker: company.ticker, market: "KRX",
        provider: "dart", is_demo: false, last_ingested_at: null },
    ] }, loading: false, error: null, reload: mocks.reload });
    mocks.fetch.mockResolvedValueOnce({ ok: false, status: 500 });
    render(<Home />);
    const following = within(document.querySelector(".rd-home-following") as HTMLElement);
    expect(following.getByText("아직 수집된 최신 소식이 없습니다.")).toBeVisible();
    expect(following.queryByRole("status")).not.toBeInTheDocument();
    expect(await screen.findByRole("alert")).toHaveTextContent("뉴스 제공자에 연결하지 못했습니다.");
    expect(following.queryByRole("alert")).not.toBeInTheDocument();
    expect(following.getByText("아직 수집된 최신 소식이 없습니다.")).toBeVisible();
  });
  it("does not invent KOSPI membership and sends market filters to the server", () => {
    expect(marketCategory("KRX")).toBe("unclassified");
    expect(marketCategory("KOSPI")).toBe("kospi");
    const view = render(<Companies />);
    fireEvent.click(screen.getByRole("button", { name: "코스닥" }));
    view.rerender(<Companies />);
    expect(mocks.data).toHaveBeenCalledWith({
      action: "design_directory",
      p: { q: "", market_group: "kosdaq", limit: 50, offset: 0 },
    });
    expect(screen.getByRole("button", { name: "시장 미분류" })).toBeVisible();
  });
  it("restores directory query, market and page from the URL after leaving and reopening", () => {
    const saved = "/explore?q=micron&market_group=overseas&offset=50";
    window.history.replaceState(null, "", saved);
    const view = render(<Companies />);
    expect(screen.getByRole("textbox", { name: "기업명, 티커 또는 키워드 검색" })).toHaveValue("micron");
    expect(screen.getByRole("button", { name: "해외주식" })).toHaveAttribute("aria-pressed", "true");
    expect(mocks.data).toHaveBeenCalledWith({ action: "design_directory", p: { q: "micron", market_group: "overseas", limit: 50, offset: 50 } });
    expect(screen.getByRole("button", { name: "이전" })).toBeEnabled();
    expect(document.querySelector(".rd-pagination")).toHaveTextContent("2");
    view.unmount();
    window.history.replaceState(null, "", `/companies/${id}`);
    // The router supplies this same URL on Back or a full reload. The real browser
    // regression separately exercises native navigation and Next's history bridge.
    window.history.replaceState(null, "", saved);
    render(<Companies />);
    expect(screen.getByRole("textbox", { name: "기업명, 티커 또는 키워드 검색" })).toHaveValue("micron");
    expect(screen.getByRole("button", { name: "해외주식" })).toHaveAttribute("aria-pressed", "true");
    expect(document.querySelector(".rd-pagination")).toHaveTextContent("2");
  });
  it("keeps consecutive query and market choices in the URL and resets only pagination", () => {
    window.history.replaceState(null, "", "/explore?q=old&market_group=overseas&offset=50");
    const view = render(<Companies />);
    fireEvent.change(screen.getByRole("textbox", { name: "기업명, 티커 또는 키워드 검색" }), { target: { value: "  ＭＵ  " } });
    fireEvent.submit(screen.getByRole("search"));
    // Intentionally act again before the first route update renders.
    fireEvent.click(screen.getByRole("button", { name: "코스닥" }));
    expect(new URLSearchParams(window.location.search).get("q")).toBe("MU");
    expect(new URLSearchParams(window.location.search).get("market_group")).toBe("kosdaq");
    expect(new URLSearchParams(window.location.search).has("offset")).toBe(false);
    view.rerender(<Companies />);
    expect(mocks.data).toHaveBeenCalledWith({ action: "design_directory", p: { q: "MU", market_group: "kosdaq", limit: 50, offset: 0 } });
    expect(screen.getByRole("textbox", { name: "기업명, 티커 또는 키워드 검색" })).toHaveValue("MU");
    fireEvent.click(screen.getByRole("button", { name: "전체" }));
    expect(new URLSearchParams(window.location.search).has("market_group")).toBe(false);
    expect(new URLSearchParams(window.location.search).get("q")).toBe("MU");
  });
  it("writes page navigation to the URL while retaining the company query and market", () => {
    window.history.replaceState(null, "", "/explore?q=micron&market_group=overseas&offset=100");
    const view = render(<Companies />);
    fireEvent.click(screen.getByRole("button", { name: "이전" }));
    expect(new URLSearchParams(window.location.search).get("offset")).toBe("50");
    expect(new URLSearchParams(window.location.search).get("q")).toBe("micron");
    expect(new URLSearchParams(window.location.search).get("market_group")).toBe("overseas");
    view.rerender(<Companies />);
    expect(mocks.data).toHaveBeenCalledWith({ action: "design_directory", p: { q: "micron", market_group: "overseas", limit: 50, offset: 50 } });
    fireEvent.click(screen.getByRole("button", { name: "이전" }));
    expect(new URLSearchParams(window.location.search).has("offset")).toBe(false);
  });
  it.each(["-50", "1.5", "10001", "NaN"])("bounds invalid directory URL filters before requesting data (%s)", offset => {
    window.history.replaceState(null, "", `/explore?market_group=unsupported&offset=${offset}`);
    render(<Companies />);
    expect(screen.getByRole("button", { name: "전체" })).toHaveAttribute("aria-pressed", "true");
    expect(mocks.data).toHaveBeenCalledWith({ action: "design_directory", p: { q: "", market_group: "all", limit: 50, offset: 0 } });
  });
  it("shows all-category counts correctly when a specific search tab is selected", () => {
    render(
      <Search initial="query" initialKind="document" initialOffset={20} />,
    );
    expect(screen.getByRole("button", { name: "전체 (12)" })).toBeVisible();
    expect(screen.getByRole("button", { name: "공시 (7)" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    fireEvent.click(screen.getByRole("button", { name: "승인 분석 (3)" }));
    const url = mocks.push.mock.calls.at(-1)?.[0] as string;
    expect(url).toContain("q=query");
    expect(url).toContain("kind=analysis");
    expect(url).not.toContain("offset=20");
  });
  it("uses canonical resource identity and persistent save results in search", async () => {
    render(<Search initial="query" initialKind="document" />);
    fireEvent.click(
      screen.getByRole("button", { name: "Synthetic filing 저장" }),
    );
    await waitFor(() =>
      expect(mocks.workspace).toHaveBeenCalledWith(
        "test-redesign-token",
        { action: "save", p: { id: filing.id, kind: "filing", saved: true } },
        expect.anything(),
      ),
    );
    expect(
      screen.getByRole("button", { name: "Synthetic filing 저장 취소" }),
    ).toHaveAttribute("aria-pressed", "true");
  });
});
