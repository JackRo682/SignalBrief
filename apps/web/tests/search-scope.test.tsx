import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Search from "../src/redesign/search";
import { SearchForm } from "../src/redesign/ui";
import { marketCategory } from "../src/redesign/company-search";
import { defaults } from "../src/workspace/contracts";
const mocks = vi.hoisted(() => ({ push: vi.fn(), data: vi.fn(), productAnalytics: vi.fn() }));
vi.mock("@/lib/use-product-analytics", () => ({ useProductAnalytics: () => mocks.productAnalytics }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("@/components/auth", () => ({ useAuth: () => ({ token: "synthetic-token" }) }));
vi.mock("@/workspace/preferences", () => ({ usePrefs: () => ({ value: defaults, loaded: true, text: (ko: string) => ko }) }));
vi.mock("@/workspace/ui", () => ({ useData: (req: unknown) => mocks.data(req), DataState: () => null }));
vi.mock("../src/redesign/company-discovery", () => ({ default: () => null }));
vi.mock("../src/redesign/ui", async original => ({ ...(await original<typeof import("../src/redesign/ui")>()), SaveButton: () => null }));
const id = "22000000-0000-4000-8000-000000000001";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.data.mockImplementation((req: { action: string; p: Record<string, unknown> } | null) => ({
    data: req?.p.kind === "company" ? { items: [{ id, kind: "company", title: "Scoped issuer", company_name: "Scoped issuer", ticker: "SCOPED", market: "NASDAQ", summary: "" }], total: 1, counts: { company: 1 }, next_offset: null } : { items: [], total: 0, counts: {}, next_offset: null },
    loading: false, error: "", reload: vi.fn(),
  }));
});
afterEach(cleanup);
describe("search scope recovery", () => {
  it("preserves consecutive filter choices before navigation commits", () => {
    render(<Search initial="NVDA" initialKind="" initialOffset={20} />);
    fireEvent.click(screen.getByRole("button", { name: /^승인 분석/ }));
    fireEvent.change(screen.getByLabelText("출처"), { target: { value: "dart" } });
    fireEvent.change(screen.getByLabelText("기간"), { target: { value: "30" } });
    const params = new URL(mocks.push.mock.calls.at(-1)![0], "https://example.test").searchParams;
    expect(params.get("q")).toBe("NVDA");
    expect(params.get("kind")).toBe("analysis");
    expect(params.get("source")).toBe("dart");
    expect(params.get("days")).toBe("30");
    expect(params.has("offset")).toBe(false);
  });
  it("retains the latest choices when an earlier navigation commits first", () => {
    const page = render(<Search initial="NVDA" initialKind="" />);
    fireEvent.click(screen.getByRole("button", { name: /^승인 분석/ }));
    fireEvent.change(screen.getByLabelText("출처"), { target: { value: "dart" } });
    page.rerender(<Search initial="NVDA" initialKind="analysis" />);
    fireEvent.change(screen.getByLabelText("기간"), { target: { value: "90" } });
    const params = new URL(mocks.push.mock.calls.at(-1)![0], "https://example.test").searchParams;
    expect(params.get("kind")).toBe("analysis");
    expect(params.get("source")).toBe("dart");
    expect(params.get("days")).toBe("90");
  });
  it("uses an external route change instead of abandoned pending filters", () => {
    const page = render(<Search initial="NVDA" initialKind="" />);
    fireEvent.click(screen.getByRole("button", { name: /^승인 분석/ }));
    fireEvent.change(screen.getByLabelText("출처"), { target: { value: "dart" } });
    page.rerender(<Search initial="AAPL" initialKind="company" initialSource="sec" />);
    fireEvent.change(screen.getByLabelText("기간"), { target: { value: "30" } });
    const params = new URL(mocks.push.mock.calls.at(-1)![0], "https://example.test").searchParams;
    expect(params.get("q")).toBe("AAPL");
    expect(params.get("kind")).toBe("company");
    expect(params.get("source")).toBe("sec");
  });
  it("stops retaining a filter once its completed navigation is replaced", () => {
    const page = render(<Search initial="NVDA" initialKind="" />);
    fireEvent.click(screen.getByRole("button", { name: /^승인 분석/ }));
    fireEvent.change(screen.getByLabelText("출처"), { target: { value: "dart" } });
    page.rerender(<Search initial="NVDA" initialKind="analysis" initialSource="dart" />);
    page.rerender(<Search initial="NVDA" initialKind="analysis" />);
    fireEvent.change(screen.getByLabelText("기간"), { target: { value: "30" } });
    const params = new URL(mocks.push.mock.calls.at(-1)![0], "https://example.test").searchParams;
    expect(params.get("kind")).toBe("analysis");
    expect(params.has("source")).toBe(false);
  });
  it("discards pending choices when browser history takes over", () => {
    render(<Search initial="NVDA" initialKind="" />);
    fireEvent.click(screen.getByRole("button", { name: /^승인 분석/ }));
    fireEvent.change(screen.getByLabelText("출처"), { target: { value: "dart" } });
    fireEvent.popState(window);
    fireEvent.change(screen.getByLabelText("기간"), { target: { value: "30" } });
    const params = new URL(mocks.push.mock.calls.at(-1)![0], "https://example.test").searchParams;
    expect(params.get("q")).toBe("NVDA");
    expect(params.has("kind")).toBe(false);
    expect(params.has("source")).toBe(false);
  });
  it("keeps a new global query and its cleared scope during overlapping changes", () => {
    render(<Search initial="old query" initialKind="document" initialCompany={id} initialCategory="10-K" initialSource="sec" initialMarket="NASDAQ" initialDays={30} initialOffset={20} />);
    fireEvent.click(screen.getByRole("button", { name: /^승인 분석/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "기업명, 티커 또는 키워드 검색" }), { target: { value: "NVDA" } });
    fireEvent.click(screen.getByRole("button", { name: "검색" }));
    fireEvent.change(screen.getByLabelText("출처"), { target: { value: "dart" } });
    const params = new URL(mocks.push.mock.calls.at(-1)![0], "https://example.test").searchParams;
    expect(params.get("q")).toBe("NVDA");
    expect(params.get("source")).toBe("dart");
    for (const key of ["kind", "company_id", "category", "market", "days", "offset"]) expect(params.has(key)).toBe(false);
  });
  it("makes the active company and category visible and clears them on a new global query", () => {
    render(<Search initial="old query" initialKind="document" initialCompany={id} initialCategory="10-K" initialSource="sec" initialMarket="NASDAQ" initialDays={30} initialOffset={20} />);
    expect(screen.getByText(/기업: Scoped issuer/)).toBeVisible();
    expect(screen.getByText(/자료 유형: 10-K/)).toBeVisible();
    fireEvent.change(screen.getByRole("textbox", { name: "기업명, 티커 또는 키워드 검색" }), { target: { value: "  삼성　전자  " } });
    fireEvent.click(screen.getByRole("button", { name: "검색" }));
    const url = new URL(mocks.push.mock.calls.at(-1)![0], "https://example.test");
    expect(url.pathname).toBe("/search");
    expect(url.searchParams.get("q")).toBe("삼성 전자");
    for (const key of ["kind", "company_id", "category", "source", "market", "days", "offset"]) expect(url.searchParams.has(key)).toBe(false);
  });
  it("provides a single action to broaden a company-scoped search without losing the query", () => {
    render(<Search initial="existing" initialKind="analysis" initialCompany={id} />);
    fireEvent.click(screen.getByRole("button", { name: "전체 기업에서 검색" }));
    const url = new URL(mocks.push.mock.calls.at(-1)![0], "https://example.test");
    expect(url.searchParams.get("q")).toBe("existing");
    expect(url.searchParams.has("company_id")).toBe(false);
    expect(url.searchParams.has("kind")).toBe(false);
  });
  it("recognizes a known US region without inventing a Korean exchange", () => {
    expect(marketCategory("US")).toBe("overseas");
    expect(marketCategory(" NYSEAMERICAN ")).toBe("overseas");
    expect(marketCategory("KR")).toBe("unclassified");
    expect(marketCategory("KRX")).toBe("unclassified");
  });
});

describe("search funnel interactions", () => {
  it("tracks shared header and home search submissions with their bounded screen names", () => {
    const form=render(<SearchForm initial="  Private query  " />);
    fireEvent.submit(screen.getByRole("search"));
    expect(mocks.productAnalytics.mock.calls).toEqual([["search_used",{screen:"search"}]]);
    form.rerender(<SearchForm initial="  Private query  " analyticsScreen="today" />);
    fireEvent.submit(screen.getByRole("search"));
    expect(mocks.productAnalytics.mock.calls).toEqual([
      ["search_used",{screen:"search"}], ["search_used",{screen:"today"}],
    ]);
    expect(JSON.stringify(mocks.productAnalytics.mock.calls)).not.toContain("Private");
  });

  it("leaves supplied search submission callbacks responsible for their own single event", () => {
    const submit=vi.fn();
    render(<SearchForm initial="  Private query  " onSubmit={submit} />);
    fireEvent.submit(screen.getByRole("search"));
    expect(submit).toHaveBeenCalledWith("Private query");
    expect(mocks.productAnalytics).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("records submitted nonempty searches without exporting their text or initial page state", () => {
    render(<Search initial="Private initial query" initialKind="" />);
    expect(mocks.productAnalytics).not.toHaveBeenCalled();
    const input = screen.getByRole("textbox", { name: "기업명, 티커 또는 키워드 검색" });
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "검색" }));
    expect(mocks.productAnalytics).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: "Private submitted query" } });
    fireEvent.click(screen.getByRole("button", { name: "검색" }));
    expect(mocks.productAnalytics.mock.calls).toEqual([["search_used", { screen: "search" }]]);
    expect(JSON.stringify(mocks.productAnalytics.mock.calls)).not.toContain("Private");
  });

  it("excludes active filters and pagination, and records one event for a grouped reset", () => {
    mocks.data.mockReturnValue({ data: { items: [], total: 40, counts: {}, next_offset: 20 }, loading: false, error: "", reload: vi.fn() });
    render(<Search initial="Private query" initialKind="document" initialSource="dart" initialDays={30} />);
    fireEvent.click(screen.getByRole("button", { name: /^공시/ }));
    fireEvent.click(screen.getByRole("button", { name: "다음" }));
    expect(mocks.productAnalytics).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("출처"), { target: { value: "sec" } });
    fireEvent.click(screen.getByRole("button", { name: "필터 초기화" }));
    fireEvent.click(screen.getByRole("button", { name: "필터 초기화" }));
    expect(mocks.productAnalytics.mock.calls).toEqual([
      ["filter_used", { screen: "search", filter_type: "source" }],
      ["filter_used", { screen: "search", filter_type: "reset" }],
    ]);
  });

  it("records event link clicks but not company or document links, with no resource identity", () => {
    mocks.data.mockReturnValue({ data: { items: [
      { id: "private-event-id", kind: "event", title: "Published event", company_name: "Private issuer", published_at: null },
      { id: "private-company-id", kind: "company", title: "Company page", ticker: "PRIVATE", market: "NASDAQ" },
      { id: "private-document-id", kind: "document", title: "Document page", company_name: "Private issuer", published_at: null },
    ], total: 3, counts: {}, next_offset: null }, loading: false, error: "", reload: vi.fn() });
    render(<Search initial="" initialKind="event" />);
    for (const name of ["Company page", "Document page", "Published event"]) {
      const link = screen.getByRole("link", { name: new RegExp(name) });
      link.addEventListener("click", event => event.preventDefault());
      fireEvent.click(link);
    }
    expect(mocks.productAnalytics.mock.calls).toEqual([["event_detail_click", { screen: "search", event_kind: "published" }]]);
  });
});
