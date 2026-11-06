import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Saved from "../src/redesign/saved";
import Watchlist from "../src/redesign/watchlist";
import Notifications from "../src/redesign/notifications";
import { defaults, type Resource } from "../src/workspace/contracts";
import { pageDataCache } from "../src/lib/page-data-cache";

// Synthetic transport fixtures test persistence/error handling, not provider data accuracy.
const mocks = vi.hoisted(() => ({
  workspace: vi.fn(),
  request: vi.fn(),
  push: vi.fn(),
  savePrefs: vi.fn(),
  rpc: vi.fn(),
  from: vi.fn(),
  fetch: vi.fn(),
  muted: [] as string[],
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
  usePathname: () => "/saved",
  useSearchParams: () => new URLSearchParams(window.location.search),
}));
vi.mock("@/components/auth", () => ({
  useAuth: () => ({
    token: "synthetic-redesign-personal-token",
    me: { id: "synthetic-user" },
    loading: false,
  }),
}));
vi.mock("@/workspace/client", async (original) => ({
  ...(await original<typeof import("../src/workspace/client")>()),
  workspace: mocks.workspace,
}));
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("../src/lib/api")>()),
  request: mocks.request,
}));
vi.mock("@/lib/supabase", () => ({
  initializeSupabase: async () => ({ rpc: mocks.rpc, from: mocks.from }),
}));
vi.mock("@/workspace/preferences", () => ({
  usePrefs: () => ({
    value: { ...defaults, history_enabled: true, muted_companies: mocks.muted },
    date: (value: string | null) => value ?? "날짜 미제공",
    text: (ko: string) => ko,
    loaded: true,
    busy: false,
    error: "",
    save: mocks.savePrefs,
    reload: vi.fn(),
  }),
}));

const companyId = "20000000-0000-4000-8000-000000000001";
const filingId = "40000000-0000-4000-8000-000000000001";
const noticeId = "80000000-0000-4000-8000-000000000001";
const calendarId = "90000000-0000-4000-8000-000000000001";
const company = {
  id: companyId,
  name: "검증용 기업",
  ticker: "TEST",
  market: "NASDAQ",
  provider: "sec",
  is_demo: true,
  last_ingested_at: null,
};
const resource: Resource = {
  id: companyId,
  kind: "company",
  title: company.name,
  summary: "",
  company_id: companyId,
  company_name: company.name,
  ticker: "TEST",
  market: "NASDAQ",
  source_url: null,
  published_at: null,
  publication_precision: "date",
  category: "company",
  is_saved: false,
};
const document: Resource = {
  ...resource,
  id: filingId,
  kind: "filing",
  title: "검증용 원문 문서",
  category: "10-Q",
  published_at: "2026-10-01",
  source_url: "https://www.sec.gov/Archives/synthetic.htm",
  is_saved: true,
};
const analysis: Resource = {
  ...document,
  kind: "us_analysis",
  title: "검증용 승인 분석",
  summary: "합성 테스트용 검토 문장.",
  reviewed_at: "2026-10-31T00:00:00Z",
  is_saved: true,
};
const calendar = {
  id: calendarId,
  title: "검증용 저장 일정",
  occurs_on: "2026-11-10",
  company_id: companyId,
  event_id: null,
  origin: "official",
  quote: null,
  source_url: null,
  source_timezone: "Asia/Seoul",
  verified_at: "2026-10-31T00:00:00Z",
};
let watched: (typeof company)[],
  saved: boolean,
  history: boolean,
  read: boolean,
  calendarSaved: boolean,
  calendarVisible: boolean,
  failSave: boolean,
  failFollow: boolean,
  failRead: boolean,
  failPrefs: boolean,
  emailAvailable: boolean,
  ruleEnabled: boolean;
beforeEach(() => {
  window.history.replaceState(null, "", "/saved");
  vi.clearAllMocks();
  pageDataCache.reset();
  mocks.muted = [];
  watched = [company];
  saved =
    history =
    calendarSaved =
    calendarVisible =
    emailAvailable =
    ruleEnabled =
      true;
  read = failSave = failFollow = failRead = failPrefs = false;
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  mocks.savePrefs.mockImplementation(async (patch) => {
    if (failPrefs) throw new Error("검증용 알림 설정 실패");
    if (patch.muted_companies) mocks.muted = patch.muted_companies;
  });
  mocks.rpc.mockImplementation((_name, { p }) => ({
    abortSignal: async () => {
      if (p.action === "list")
        return {
          data: calendarSaved ? [{ calendar_id: calendarId }] : [],
          error: null,
        };
      calendarSaved = p.enabled;
      return {
        data: { saved: true, delivery: "saved_interest_only" },
        error: null,
      };
    },
  }));
  mocks.from.mockImplementation(() => {
    const query = {
      select: () => query,
      in: () => query,
      eq: () => query,
      gte: () => query,
      lte: () => query,
      neq: () => query,
      order: () => query,
      limit: () => query,
      abortSignal: async () => ({
        data: calendarVisible ? [calendar] : [],
        error: null,
      }),
    };
    return query;
  });
  mocks.fetch.mockImplementation(
    async () =>
      new Response(
        JSON.stringify({ available: emailAvailable, enabled: false }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
  );
  vi.stubGlobal("fetch", mocks.fetch);
  mocks.workspace.mockImplementation(async (_token, req) => {
    if (req.action === "saved_list") {
      const all =
        req.p.kind === "history"
          ? history
            ? [{ ...resource, saved_at: "2026-10-31T00:00:00Z" }]
            : []
          : [...(saved ? [analysis] : []), document];
      const items = all.filter(
        (item) =>
          (!req.p.company || item.company_id === req.p.company) &&
          (!req.p.q || item.title.includes(req.p.q)),
      );
      return {
        items,
        counts: {
          analysis: saved ? 1 : 0,
          document: 1,
          event: 0,
          history: history ? 1 : 0,
        },
      };
    }
    if (req.action === "catalog")
      return {
        items: [resource],
        total: 1,
        counts: { company: 1 },
        markets: ["NASDAQ"],
        categories: [],
        next_offset: null,
      };
    if (req.action === "save") {
      if (failSave) throw new Error("검증용 저장 실패");
      saved = req.p.saved;
      return { saved };
    }
    if (req.action === "history_clear") {
      history = false;
      return {};
    }
    if (req.action === "source_overview")
      return {
        companies: 1,
        filing_count: 1,
        published_count: 1,
        following_count: watched.length,
        scope: "following",
        fallback_to_all: false,
        filings: [document],
        analyses: [analysis],
        historical_events: [],
        calendar: [],
        historical_calendar: [],
        monitoring: [
          {
            company_id: companyId,
            latest_filing: document,
            latest_analysis: analysis,
            next_event: null,
            last_collected_at: null,
            filing_count: 1,
            analysis_count: 1,
          },
        ],
      };
    if (req.action === "content_notifications")
      return {
        items: [
          {
            id: noticeId,
            created_at: "2026-10-31T00:00:00Z",
            read_at: read ? "2026-11-01T00:00:00Z" : null,
            resource: analysis,
          },
        ],
        unread_count: read ? 0 : 1,
      };
    if (req.action === "content_notification_read") {
      if (failRead) throw new Error("검증용 읽음 처리 실패");
      read = true;
      return { read: true };
    }
    if (req.action === "notifications")
      return { realtime_enabled: true, notify_min_score: 0.4 };
    if (req.action === "notification_save")
      return {
        realtime_enabled: req.p.realtime_enabled,
        notify_min_score: 0.4,
      };
    if (req.action === "visit") return {};
    throw new Error(`Unexpected workspace action: ${req.action}`);
  });
  mocks.request.mockImplementation(async (path, _token, _schema, init) => {
    if (path === "/v1/watchlist")
      return {
        id: "synthetic-watchlist",
        name: "Watchlist",
        items: [...watched],
      };
    if (path.startsWith("/v1/companies?")) return [company];
    if (path.startsWith("/v1/watchlist/")) {
      if (failFollow) throw new Error("검증용 팔로우 해제 실패");
      watched = init.method === "DELETE" ? [] : [company];
      return undefined;
    }
    const rule = {
      id: "70000000-0000-4000-8000-000000000001",
      name: "검증용 이벤트 규칙",
      event_types: [],
      min_score: 0.4,
      enabled: ruleEnabled,
      created_at: "2026-10-31T00:00:00Z",
    };
    if (path === "/v1/alerts") return [rule];
    if (path.startsWith("/v1/alerts/")) {
      ruleEnabled = JSON.parse(init.body).enabled;
      return { ...rule, enabled: ruleEnabled };
    }
    throw new Error(`Unexpected API request: ${path}`);
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("redesigned personal screens", () => {
  it("applies actual saved keyword, company and sort filters across selected tabs", async () => {
    render(<Saved />);
    await screen.findByRole("link", { name: "검증용 승인 분석" });
    fireEvent.click(screen.getByRole("tab", { name: "북마크 문서" }));
    expect(
      screen.getByRole("link", { name: "검증용 원문 문서" }),
    ).toBeVisible();
    fireEvent.change(screen.getByLabelText("저장 항목 회사"), {
      target: { value: companyId },
    });
    fireEvent.change(screen.getByLabelText("저장 항목 정렬"), {
      target: { value: "oldest" },
    });
    fireEvent.change(screen.getByLabelText("저장 항목 키워드"), {
      target: { value: "승인" },
    });
    fireEvent.click(screen.getByRole("button", { name: "검색" }));
    await waitFor(() =>
      expect(
        screen.queryByRole("link", { name: "검증용 원문 문서" }),
      ).not.toBeInTheDocument(),
    );
    expect(mocks.workspace).toHaveBeenCalledWith(
      "synthetic-redesign-personal-token",
      {
        action: "saved_list",
        p: { kind: "", sort: "oldest" },
      },
      expect.anything(),
      expect.anything(),
    );
    expect(screen.getByLabelText("저장 항목 회사")).toHaveValue(companyId);
    fireEvent.click(screen.getByRole("tab", { name: "저장한 분석" }));
    expect(screen.getByRole("link", { name: "검증용 승인 분석" })).toBeVisible();
    // Filters operate on the complete owner-scoped response, preserving options
    // for saved issuers that are not in a global directory's first page.
    fireEvent.click(screen.getByRole("button", { name: "저장 필터 초기화" }));
    fireEvent.click(screen.getByRole("tab", { name: "북마크 문서" }));
    expect(await screen.findByRole("link", { name: "검증용 원문 문서" })).toBeVisible();
    expect(screen.getByRole("heading", { name: /북마크 문서 1개/ })).toBeVisible();
  });

  it("keeps failed saves visible and persists successful removal across remount", async () => {
    failSave = true;
    const first = render(<Saved />);
    fireEvent.click(
      await screen.findByRole("button", { name: "검증용 승인 분석 저장 취소" }),
    );
    await screen.findByText("검증용 저장 실패");
    expect(
      screen.getByRole("link", { name: "검증용 승인 분석" }),
    ).toBeVisible();
    failSave = false;
    fireEvent.click(
      screen.getByRole("button", { name: "검증용 승인 분석 저장 취소" }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("link", { name: "검증용 승인 분석" }),
      ).not.toBeInTheDocument(),
    );
    expect(saved).toBe(false);
    first.unmount();
    render(<Saved />);
    await screen.findByText("저장한 분석이 없습니다.");
  });

  it("clears history only after confirmation without removing bookmarks", async () => {
    render(<Saved />);
    await screen.findByRole("link", { name: "검증용 승인 분석" });
    fireEvent.click(screen.getByRole("button", { name: "기록 관리" }));
    expect(history).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "기록 지우기" }));
    fireEvent.click(screen.getByRole("tab", { name: "최근 본 항목" }));
    expect(await screen.findByText("최근 본 항목이 없습니다.")).toBeVisible();
    expect(saved).toBe(true);
    fireEvent.click(screen.getByRole("tab", { name: "저장한 분석" }));
    expect(
      screen.getByRole("link", { name: "검증용 승인 분석" }),
    ).toBeVisible();
    expect(mocks.workspace).toHaveBeenCalledWith(
      "synthetic-redesign-personal-token",
      { action: "history_clear", p: {} },
      expect.anything(),
    );
  });

  it("uses calendar IDs and the calendar RPC for saved dates, never reviewed-event IDs", async () => {
    render(<Saved />);
    fireEvent.click(screen.getByRole("tab", { name: "저장한 일정" }));
    expect(
      await screen.findByRole("link", { name: "검증용 저장 일정" }),
    ).toHaveAttribute("href", `/events/${calendarId}?kind=calendar`);
    fireEvent.click(
      screen.getByRole("button", { name: "검증용 저장 일정 일정 저장 취소" }),
    );
    await waitFor(() => expect(calendarSaved).toBe(false));
    await waitFor(() =>
      expect(
        screen.queryByRole("link", { name: "검증용 저장 일정" }),
      ).not.toBeInTheDocument(),
    );
    expect(mocks.rpc).toHaveBeenCalledWith("sb_reference_reminders", {
      p: { action: "set", calendar_id: calendarId, enabled: false },
    });
    expect(
      mocks.workspace.mock.calls.some(
        ([, req]) => req.action === "save" && req.p.id === calendarId,
      ),
    ).toBe(false);
  });

  it("does not remove a followed company until the API confirms success", async () => {
    failFollow = true;
    const first = render(<Watchlist />);
    expect(
      await screen.findByRole("link", { name: /최신 분석 검증용 승인 분석/ }),
    ).toHaveAttribute("href", `/documents/${filingId}?kind=filing&analysis=us`);
    fireEvent.click(screen.getByLabelText("검증용 기업 메뉴"));
    fireEvent.click(
      screen.getByRole("button", { name: "검증용 기업 팔로우 취소" }),
    );
    await screen.findByText("검증용 팔로우 해제 실패");
    expect(watched).toHaveLength(1);
    failFollow = false;
    fireEvent.click(
      screen.getByRole("button", { name: "검증용 기업 팔로우 취소" }),
    );
    await screen.findByText("첫 관심 기업을 추가해 보세요.");
    first.unmount();
    render(<Watchlist />);
    await screen.findByText("첫 관심 기업을 추가해 보세요.");
  });

  it("allows removal of an unavailable saved date without revealing inaccessible details", async () => {
    calendarVisible = false;
    render(<Saved />);
    fireEvent.click(screen.getByRole("tab", { name: "저장한 일정" }));
    await screen.findByText("사용할 수 없는 저장 일정");
    expect(screen.queryByText("검증용 저장 일정")).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", {
        name: "사용할 수 없는 일정 1 일정 저장 취소",
      }),
    );
    await waitFor(() => expect(calendarSaved).toBe(false));
    await waitFor(() =>
      expect(
        screen.queryByText("사용할 수 없는 저장 일정"),
      ).not.toBeInTheDocument(),
    );
    expect(mocks.rpc).toHaveBeenCalledWith("sb_reference_reminders", {
      p: { action: "set", calendar_id: calendarId, enabled: false },
    });
  });

  it("persists company-specific mute settings and preserves state when persistence fails", async () => {
    failPrefs = true;
    const first = render(<Watchlist />);
    const toggle = await screen.findByRole("switch", {
      name: "검증용 기업 알림",
    });
    fireEvent.click(toggle);
    await screen.findByText("검증용 알림 설정 실패");
    expect(toggle).toHaveAttribute("aria-checked", "true");
    failPrefs = false;
    fireEvent.click(toggle);
    await waitFor(() =>
      expect(toggle).toHaveAttribute("aria-checked", "false"),
    );
    expect(mocks.savePrefs).toHaveBeenLastCalledWith({
      muted_companies: [companyId],
    });
    expect(watched).toHaveLength(1);
    first.unmount();
    render(<Watchlist />);
    expect(await screen.findByRole("switch", { name: "검증용 기업 알림" }))
      .toHaveAttribute("aria-checked", "false");
  });

  it("keeps unread state on failed writes and persists confirmed read state", async () => {
    failRead = true;
    const first = render(<Notifications />);
    fireEvent.click(
      await screen.findByRole("button", {
        name: "검증용 승인 분석 읽음으로 표시",
      }),
    );
    await screen.findByText("검증용 읽음 처리 실패");
    expect(read).toBe(false);
    failRead = false;
    fireEvent.click(
      screen.getByRole("button", { name: "검증용 승인 분석 읽음으로 표시" }),
    );
    expect(
      await screen.findByRole("button", { name: "검증용 승인 분석 읽음" }),
    ).toBeDisabled();
    first.unmount();
    render(<Notifications />);
    expect(
      await screen.findByRole("button", { name: "검증용 승인 분석 읽음" }),
    ).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "읽지 않음 (0)" }));
    await screen.findByText("읽지 않은 알림이 없습니다.");
  });

  it("uses server availability to disable email and persists real event-rule changes", async () => {
    emailAvailable = false;
    render(<Notifications />);
    await screen.findByText("현재 이메일 발송이 연결되지 않았습니다.");
    expect(screen.getByRole("switch", { name: "이메일 알림" })).toBeDisabled();
    const rule = await screen.findByRole("switch", {
      name: "검증용 이벤트 규칙 사용",
    });
    fireEvent.click(rule);
    await waitFor(() => expect(rule).toHaveAttribute("aria-checked", "false"));
    expect(ruleEnabled).toBe(false);
    expect(screen.queryByText("프로젝트")).not.toBeInTheDocument();
  });

  it("filters notification rows by their real resource kinds and retains a real empty state", async () => {
    render(<Notifications />);
    await screen.findByRole("link", { name: "검증용 승인 분석" });
    fireEvent.change(screen.getByLabelText("알림 유형"), {
      target: { value: "event" },
    });
    const list = screen.getByRole("region", { name: "알림 목록" });
    expect(
      within(list).queryByRole("link", { name: "검증용 승인 분석" }),
    ).not.toBeInTheDocument();
    expect(
      within(list).getByText("조건에 맞는 알림이 없습니다."),
    ).toBeVisible();
  });
});
