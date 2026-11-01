import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Search from "../src/redesign/search";
import { marketCategory } from "../src/redesign/company-search";
import { defaults } from "../src/workspace/contracts";
const mocks = vi.hoisted(() => ({ push: vi.fn(), data: vi.fn() }));
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
