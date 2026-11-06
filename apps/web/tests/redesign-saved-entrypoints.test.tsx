import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Saved from "../src/redesign/saved";
import { defaults, resourceHref, type Resource, type WorkspaceRequest } from "../src/workspace/contracts";

// Synthetic owner-scoped records and transports; these fixtures do not claim
// that an unsaved account already owns any document, analysis, or calendar item.
const session = vi.hoisted(() => ({ token: "saved-owner-a", fetch: vi.fn(), rpc: vi.fn(), from: vi.fn() }));
vi.mock("@/components/auth", () => ({ useAuth: () => ({ token: session.token, me: { id: session.token } }) }));
vi.mock("@/workspace/preferences", () => ({ usePrefs: () => ({ value: defaults, loaded: true, text: (ko: string) => ko, date: (value: string | null) => value ?? "" }) }));
vi.mock("@/lib/supabase", () => ({ initializeSupabase: async () => ({ rpc: session.rpc, from: session.from }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => "/saved", useSearchParams: () => new URLSearchParams(window.location.search) }));

const companyId = "20000000-0000-4000-8000-000000000001";
const farId = "20000000-0000-4000-8000-000000000099";
const base: Resource = { id: companyId, kind: "company", company_id: companyId, title: "Synthetic issuer", company_name: "Synthetic issuer", ticker: "SYN", market: "NASDAQ", summary: "", source_url: null, published_at: null, publication_precision: "date", category: "", is_saved: false };
const filing: Resource = { ...base, id: "40000000-0000-4000-8000-000000000001", kind: "filing", title: "Synthetic public filing", category: "10-Q", published_at: "2026-10-31", source_url: "https://www.sec.gov/Archives/synthetic-saved.htm" };
const analysis: Resource = { ...filing, kind: "us_analysis", title: "Synthetic approved analysis", filing_id: filing.id, reviewed_at: "2026-10-31T12:00:00Z", coverage: "excerpt" };
const farDocument: Resource = { ...filing, id: "40000000-0000-4000-8000-000000000099", company_id: farId, company_name: "Beyond page fifty", ticker: "FAR", title: "Synthetic far-company document" };
const calendarId = "90000000-0000-4000-8000-000000000099";
const calendar = { id: calendarId, company_id: farId, event_id: null, title: "Synthetic investor call", occurs_on: "2026-11-10", origin: "official", quote: "Synthetic official date", source_url: "https://example.org/synthetic-ir", company: { id: farId, name: "Beyond page fifty", ticker: "FAR" } };
const resources = [filing, analysis, farDocument];
const identity = (item: Resource) => `${item.kind}:${item.id}`;
let records: Map<string, Set<string>>, calendarSaved: boolean, mismatch: boolean, failRead: boolean, failWrite: boolean, failCatalog: boolean, emptyCatalog: boolean;
let calls: WorkspaceRequest[], selections: string[];
const owned = (token = session.token) => { if (!records.has(token)) records.set(token, new Set()); return records.get(token)!; };
const section = (id: string) => within(document.getElementById(`rd-saved-${id}`)!);
const labels = { analysis: "저장한 분석", event: "저장한 일정", document: "북마크 문서", history: "최근 본 항목" } as const;
const selectTab = (id: keyof typeof labels) => fireEvent.click(screen.getByRole("tab", { name: labels[id] }));

beforeEach(() => {
  window.history.replaceState(null, "", "/saved");
  vi.clearAllMocks(); session.token = "saved-owner-a"; records = new Map(); calls = []; selections = [];
  calendarSaved = mismatch = failRead = failWrite = failCatalog = emptyCatalog = false;
  session.rpc.mockImplementation((name: string, { p }: { p: { action: string } }) => {
    expect(name).toBe("sb_reference_reminders"); expect(p.action).toBe("list");
    return { abortSignal: async () => ({ data: calendarSaved ? [{ calendar_id: calendarId }] : [], error: null }) };
  });
  session.from.mockImplementation((table: string) => {
    expect(table).toBe("calendar_items");
    const query = {
      select: (selection: string) => { selections.push(selection); return query; },
      in: (field: string, ids: string[]) => { expect(field).toBe("id"); expect(ids).toEqual([calendarId]); return query; },
      eq: (field: string, value: string) => { expect([field, value]).toEqual(["calendar_status", "confirmed"]); return query; },
      abortSignal: async () => ({ data: [{ ...calendar, company: mismatch ? { ...calendar.company, id: companyId } : calendar.company }], error: null }),
    };
    return query;
  });
  session.fetch.mockImplementation(async (url: string, init: RequestInit) => {
    expect(url).toBe("/api/workspace"); expect(init.method).toBe("POST");
    const token = new Headers(init.headers).get("Authorization")?.replace(/^Bearer /, "") ?? "";
    expect(["saved-owner-a", "saved-owner-b"]).toContain(token);
    const req = JSON.parse(String(init.body)) as WorkspaceRequest; calls.push(req);
    if (req.action === "saved_list") {
      if (failRead && req.p.kind !== "history") return Response.json({ error: { code: "temporarily_unavailable" } }, { status: 503 });
      const all = resources.filter(item => owned(token).has(identity(item)));
      const items = req.p.kind === "history" ? [] : all.filter(item => (!req.p.company || item.company_id === req.p.company) && (!req.p.q || item.title.toLowerCase().includes(req.p.q.toLowerCase())));
      return Response.json({ items: items.map(item => ({ ...item, is_saved: true })), counts: { analysis: all.filter(item => item.kind.endsWith("analysis")).length, document: all.filter(item => item.kind === "filing").length, event: 0, history: 0 } });
    }
    if (req.action === "catalog") {
      if (failCatalog) return Response.json({ error: { code: "temporarily_unavailable" } }, { status: 503 });
      const firstFifty = Array.from({ length: 50 }, (_, index) => ({ ...base, id: `20000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}` }));
      const items = emptyCatalog ? [] : req.p.kind === "company" ? firstFifty : req.p.kind === "analysis" ? [analysis] : [filing];
      return Response.json({ items: items.map(item => ({ ...item, is_saved: owned(token).has(identity(item)) })), total: items.length, counts: {}, markets: ["NASDAQ"], next_offset: req.p.kind === "company" ? 50 : null });
    }
    if (req.action === "save") {
      if (failWrite) return Response.json({ error: { code: "permission_denied" } }, { status: 403 });
      const item = resources.find(value => value.id === req.p.id && value.kind === req.p.kind); expect(item).toBeDefined();
      if (req.p.saved) owned(token).add(identity(item!)); else owned(token).delete(identity(item!));
      return Response.json({ saved: req.p.saved });
    }
    throw new Error(`Unexpected action: ${req.action}`);
  });
  vi.stubGlobal("fetch", session.fetch);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("Saved first-use and complete owned-company filtering", () => {
  it.each([filing, analysis])("offers a real $kind without saving automatically, then persists only its explicit selection", async item => {
    const page = render(<Saved />);
    const category = item.kind === "filing" ? "document" : "analysis";
    selectTab(category);
    const discovery = await screen.findByRole("region", { name: "저장할 자료 찾기" });
    expect(await within(discovery).findByRole("link", { name: item.title })).toHaveAttribute("href", resourceHref(item));
    expect(owned().size).toBe(0); expect(calls.some(call => call.action === "save" || call.action === "visit")).toBe(false);
    expect(within(discovery).getByRole("button", { name: `${item.title} 저장` })).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(within(discovery).getByRole("button", { name: `${item.title} 저장` }));
    await section(category).findByRole("button", { name: `${item.title} 저장 취소` });
    expect(section(category).getByRole("link", { name: item.title })).toBeVisible();
    expect([...owned()]).toEqual([identity(item)]);
    page.unmount(); render(<Saved />);
    expect(await section(category).findByRole("link", { name: item.title })).toBeVisible();
    selectTab("history");
    expect(screen.getByText(/방문 기록 저장이 꺼져 있습니다/)).toBeVisible();
  });

  it("does not pretend a denied first save succeeded and permits a later explicit retry", async () => {
    failWrite = true; render(<Saved />);
    fireEvent.click(await screen.findByRole("button", { name: `${analysis.title} 저장` }));
    expect(await screen.findByRole("alert")).toBeVisible(); expect(owned().size).toBe(0);
    expect(screen.getByRole("button", { name: `${analysis.title} 저장` })).toHaveAttribute("aria-pressed", "false");
    failWrite = false; fireEvent.click(screen.getByRole("button", { name: `${analysis.title} 저장` }));
    await section("analysis").findByRole("button", { name: `${analysis.title} 저장 취소` });
    expect(section("analysis").getByRole("link", { name: analysis.title })).toBeVisible();
  });

  it("does not mistake a failed saved read for a new account needing suggestions", async () => {
    failRead = true; owned().add(identity(filing)); render(<Saved />);
    const alert = await screen.findByRole("alert");
    expect(screen.queryByRole("region", { name: "저장할 자료 찾기" })).not.toBeInTheDocument();
    expect(calls.some(call => call.action === "catalog" && call.p.kind !== "company")).toBe(false);
    failRead = false; fireEvent.click(within(alert).getByRole("button", { name: "다시 시도" }));
    selectTab("document");
    expect(await section("document").findByRole("link", { name: filing.title })).toBeVisible();
  });

  it("keeps public-list failures retryable and never inserts a fabricated recommendation", async () => {
    failCatalog = true; render(<Saved />);
    const discovery = await screen.findByRole("region", { name: "저장할 자료 찾기" });
    await within(discovery).findAllByRole("alert");
    expect(within(discovery).queryByRole("link", { name: analysis.title })).not.toBeInTheDocument();
    expect(owned().size).toBe(0);
    failCatalog = false; fireEvent.click(within(discovery).getAllByRole("button", { name: "다시 시도" })[0]);
    expect(await within(discovery).findByRole("link", { name: analysis.title })).toBeVisible();
  });

  it("includes a saved issuer beyond the first fifty global companies and retains its filter option", async () => {
    owned().add(identity(farDocument)); render(<Saved />);
    selectTab("document");
    await section("document").findByRole("link", { name: farDocument.title });
    expect(screen.getByRole("option", { name: "Beyond page fifty" })).toHaveValue(farId);
    fireEvent.change(screen.getByLabelText("저장 항목 회사"), { target: { value: farId } });
    fireEvent.change(screen.getByLabelText("저장 항목 키워드"), { target: { value: "ＦＡＲ" } });
    fireEvent.click(screen.getByRole("button", { name: "검색" }));
    expect(section("document").getByRole("link", { name: farDocument.title })).toBeVisible();
    expect(screen.getByRole("option", { name: "Beyond page fifty" })).toHaveValue(farId);
    expect(calls.some(call => call.action === "catalog" && call.p.kind === "company")).toBe(false);
  });

  it("searches and filters a calendar-only saved issuer using its exact related company", async () => {
    calendarSaved = true; render(<Saved />);
    selectTab("event");
    await section("event").findByRole("link", { name: calendar.title });
    expect(screen.getByRole("option", { name: "Beyond page fifty" })).toHaveValue(farId);
    fireEvent.change(screen.getByLabelText("저장 항목 키워드"), { target: { value: "FAR" } });
    fireEvent.click(screen.getByRole("button", { name: "검색" }));
    expect(section("event").getByRole("link", { name: calendar.title })).toBeVisible();
    fireEvent.change(screen.getByLabelText("저장 항목 회사"), { target: { value: farId } });
    expect(section("event").getByRole("link", { name: calendar.title })).toBeVisible();
    expect(selections[0]).toContain("company:companies(id,name,ticker)");
    expect(calls.some(call => call.action === "save")).toBe(false);
  });

  it("rejects mismatched calendar-company metadata instead of rendering another issuer", async () => {
    calendarSaved = mismatch = true; render(<Saved />);
    selectTab("event");
    expect(await section("event").findByRole("alert")).toHaveTextContent("저장한 일정의 기업 정보를 확인하지 못했습니다.");
    expect(section("event").queryByRole("link", { name: calendar.title })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Beyond page fifty" })).not.toBeInTheDocument();
  });

  it("resets personal filters and options when the authenticated account changes", async () => {
    owned().add(identity(farDocument)); const page = render(<Saved />);
    selectTab("document");
    await section("document").findByRole("link", { name: farDocument.title });
    fireEvent.change(screen.getByLabelText("저장 항목 회사"), { target: { value: farId } });
    session.token = "saved-owner-b"; page.rerender(<Saved />);
    await screen.findByRole("region", { name: "저장할 자료 찾기" });
    expect(screen.getByLabelText("저장 항목 회사")).toHaveValue("");
    expect(screen.queryByRole("option", { name: "Beyond page fifty" })).not.toBeInTheDocument();
    expect(section("document").queryByRole("link", { name: farDocument.title })).not.toBeInTheDocument();
    expect(owned().size).toBe(0); expect(owned("saved-owner-a").size).toBe(1);
  });
});

describe("Saved tab navigation", () => {
  it("shows one labelled panel and selects saved schedules without a fragment jump", async () => {
    window.history.replaceState(null, "", "/saved?source=bookmark#rd-saved-analysis");
    calendarSaved = true;
    render(<Saved />);
    await screen.findByRole("region", { name: "저장할 자료 찾기" });
    expect(screen.getAllByRole("tab")).toHaveLength(4);
    expect(screen.getAllByRole("tabpanel", { hidden: true })).toHaveLength(4);
    expect(screen.getAllByRole("tabpanel")).toHaveLength(1);
    expect(screen.getByRole("tabpanel", { name: labels.analysis })).toHaveAttribute("aria-labelledby", "rd-saved-tab-analysis");
    selectTab("event");
    expect(window.location.pathname).toBe("/saved");
    expect(window.location.search).toBe("?source=bookmark&tab=event");
    expect(window.location.hash).toBe("");
    expect(screen.getByRole("tab", { name: labels.event })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: labels.event })).toHaveAttribute("aria-controls", "rd-saved-event");
    expect(screen.getAllByRole("tabpanel")).toHaveLength(1);
    expect(screen.getByRole("tabpanel", { name: labels.event })).toBeVisible();
    expect(await section("event").findByRole("link", { name: calendar.title })).toHaveAttribute("href", `/events/${calendarId}?kind=calendar`);
    expect(screen.queryByRole("region", { name: "저장할 자료 찾기" })).not.toBeInTheDocument();
    expect(calls.some(call => call.action === "save" || call.action === "visit")).toBe(false);
  });

  it("supports keyboard activation, wrapping, and one tab stop", async () => {
    render(<Saved />);
    await screen.findByRole("region", { name: "저장할 자료 찾기" });
    const tab = (id: keyof typeof labels) => screen.getByRole("tab", { name: labels[id] });
    tab("analysis").focus();
    const move = (from: keyof typeof labels, key: string, to: keyof typeof labels) => {
      fireEvent.keyDown(tab(from), { key });
      expect(tab(to)).toHaveFocus();
      expect(tab(to)).toHaveAttribute("aria-selected", "true");
      expect(tab(to)).toHaveAttribute("tabindex", "0");
      for (const other of screen.getAllByRole("tab").filter(value => value !== tab(to))) {
        expect(other).toHaveAttribute("aria-selected", "false");
        expect(other).toHaveAttribute("tabindex", "-1");
      }
      expect(screen.getAllByRole("tabpanel")).toHaveLength(1);
      expect(new URLSearchParams(window.location.search).get("tab")).toBe(to);
    };
    move("analysis", "ArrowRight", "event");
    move("event", "End", "history");
    move("history", "ArrowRight", "analysis");
    move("analysis", "ArrowLeft", "history");
    move("history", "Home", "analysis");
  });

  it.each([
    ["?tab=analysis", "analysis"],
    ["?tab=event", "event"],
    ["?tab=document", "document"],
    ["?tab=history", "history"],
    ["#rd-saved-event", "event"],
    ["?tab=document#rd-saved-event", "document"],
    ["?tab=unknown", "analysis"],
  ] as const)("restores the active panel from %s", async (suffix, expected) => {
    window.history.replaceState(null, "", `/saved${suffix}`);
    render(<Saved />);
    expect(await screen.findByRole("tabpanel", { name: labels[expected] })).toBeVisible();
    expect(screen.getAllByRole("tabpanel")).toHaveLength(1);
    expect(screen.getByRole("tab", { name: labels[expected] })).toHaveAttribute("aria-selected", "true");
  });

  it("restores selection on popstate, legacy hash changes, and same-route navigation", async () => {
    const page = render(<Saved />);
    selectTab("event");
    selectTab("document");
    act(() => {
      window.history.replaceState(null, "", "/saved?tab=event");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(screen.getByRole("tabpanel", { name: labels.event })).toBeVisible();
    act(() => {
      window.history.replaceState(null, "", "/saved#rd-saved-history");
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(screen.getByRole("tabpanel", { name: labels.history })).toBeVisible();
    selectTab("document");
    window.history.replaceState(null, "", "/saved");
    page.rerender(<Saved />);
    expect(screen.getByRole("tabpanel", { name: labels.analysis })).toBeVisible();
    selectTab("event");
    page.unmount();
    render(<Saved />);
    expect(screen.getByRole("tabpanel", { name: labels.event })).toBeVisible();
  });

  it("offers discoveries only for the selected empty resource category", async () => {
    render(<Saved />);
    expect(await screen.findByRole("link", { name: analysis.title })).toBeVisible();
    expect(screen.queryByRole("link", { name: filing.title })).not.toBeInTheDocument();
    selectTab("document");
    expect(await screen.findByRole("link", { name: filing.title })).toBeVisible();
    expect(screen.queryByRole("link", { name: analysis.title })).not.toBeInTheDocument();
    selectTab("history");
    expect(screen.queryByRole("region", { name: "저장할 자료 찾기" })).not.toBeInTheDocument();
    selectTab("event");
    expect(screen.queryByRole("region", { name: "저장할 자료 찾기" })).not.toBeInTheDocument();
    expect(owned().size).toBe(0);
    expect(calls.some(call => call.action === "save" || call.action === "visit")).toBe(false);
  });

  it("shares the four-row schedule limit between available and unavailable saved dates", async () => {
    const ids = Array.from({ length: 6 }, (_, index) => `90000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`);
    session.rpc.mockImplementation(() => ({ abortSignal: async () => ({ data: ids.map(calendar_id => ({ calendar_id })), error: null }) }));
    session.from.mockImplementation(() => {
      const query = {
        select: () => query,
        in: () => query,
        eq: () => query,
        abortSignal: async () => ({ data: ids.slice(0, 3).map((id, index) => ({ ...calendar, id, title: `Synthetic saved date ${index + 1}` })), error: null }),
      };
      return query;
    });
    render(<Saved />);
    selectTab("event");
    await waitFor(() => expect(section("event").getAllByRole("article")).toHaveLength(4));
    expect(section("event").getByRole("heading", { name: /저장한 일정 6개/ })).toBeVisible();
    expect(section("event").getAllByText("사용할 수 없는 저장 일정")).toHaveLength(1);
    fireEvent.click(section("event").getByRole("button", { name: "더보기" }));
    expect(section("event").getAllByRole("article")).toHaveLength(6);
    expect(section("event").getAllByText("사용할 수 없는 저장 일정")).toHaveLength(3);
    fireEvent.click(section("event").getByRole("button", { name: "접기" }));
    expect(section("event").getAllByRole("article")).toHaveLength(4);
  });
});
