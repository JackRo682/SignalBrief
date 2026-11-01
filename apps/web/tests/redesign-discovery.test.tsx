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
import { defaults, type Resource } from "../src/workspace/contracts";
const mocks = vi.hoisted(() => ({
  data: vi.fn(),
  push: vi.fn(),
  reload: vi.fn(),
  workspace: vi.fn(),
  fetch: vi.fn(),
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
vi.mock("@/workspace/client", () => ({
  workspace: (...args: unknown[]) => mocks.workspace(...args),
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
    const kpis = document.querySelector(".rd-kpis")!;
    expect(within(kpis as HTMLElement).getAllByText("조회 불가")).toHaveLength(
      3,
    );
    expect(screen.queryByText("Synthetic filing")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(mocks.reload).toHaveBeenCalled();
    await waitFor(() => expect(mocks.fetch).toHaveBeenCalled());
  });
  it("defaults all-company news to the first covered company when an unsupported company comes first", async () => {
    catalogCompanies = [company, newsCompany];
    render(<Home />);
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
    expect(screen.getByText("뉴스 검색이 연결된 기업이 없습니다.")).toBeVisible();
    expect(screen.queryByText("뉴스를 조회할 등록 기업이 없습니다.")).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: company.company_name })).toBeInTheDocument();
    expect(mocks.fetch).not.toHaveBeenCalled();
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
