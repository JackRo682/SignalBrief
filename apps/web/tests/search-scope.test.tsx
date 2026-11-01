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
