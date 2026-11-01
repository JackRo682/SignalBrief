import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import RedesignEvent from "@/redesign/event";
import { defaults } from "@/workspace/contracts";

const state = vi.hoisted(() => ({
  saved: true,
  fail: false,
  rpc: vi.fn(),
  followed: false,
  origin: "official",
  quote: "Synthetic confirmed source text",
}));
const dateId = "00000000-0000-4000-8000-000000000001",
  companyId = "00000000-0000-4000-8000-000000000002";
vi.mock("next/link", () => ({
  default: ({
    children,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a>,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/components/auth", () => ({
  useAuth: () => ({ token: "synthetic-account-token" }),
}));
vi.mock("@/workspace/preferences", () => ({
  usePrefs: () => ({
    text: (ko: string) => ko,
    date: (date: string) => date,
    value: { ...defaults, history_enabled: false },
  }),
}));
vi.mock("@/components/ui", () => ({
  useResource: () => ({
    data: null,
    loading: false,
    error: null,
    reload: vi.fn(),
  }),
}));
vi.mock("@/desktop/ui", () => ({
  PcLogo: () => null,
  PcModal: ({ children, title }: { children: ReactNode; title: string }) => (
    <section role="dialog" aria-label={title}>
      {children}
    </section>
  ),
}));
vi.mock("@/redesign/calendar-data", () => ({
  useCalendarData: (input: { id?: string } | null) => ({
    data: input?.id
      ? {
          items: [
            {
              id: dateId,
              title: "Synthetic official date",
              occurs_on: "2026-11-11",
              company_id: companyId,
              event_id: null,
              origin: state.origin,
              quote: state.quote,
              source_url: state.origin === "user" ? null : "https://example.org/source",
              source_timezone: "Asia/Seoul",
              verified_at: "2026-11-01T00:00:00Z",
            },
          ],
          truncated: false,
        }
      : { items: [], truncated: false },
    loading: false,
    error: "",
    reload: vi.fn(),
  }),
}));
vi.mock("@/workspace/ui", async (original) => ({
  ...(await original<typeof import("../src/workspace/ui")>()),
  useData: (req: { action?: string } | null) => ({
    data:
      req?.action === "company"
        ? {
            company: {
              id: companyId,
              company_name: "Synthetic Company",
              ticker: "TEST",
              market: "TEST",
              summary: "Synthetic company description",
            },
            analyses: [],
            events: [],
            documents: [],
            watching: state.followed,
            holding: false,
          }
        : null,
    loading: false,
    error: "",
    reload: vi.fn(),
  }),
}));
vi.mock("@/lib/supabase", () => ({
  initializeSupabase: async () => ({
    rpc: (name: string, args: unknown) => ({
      abortSignal: () => state.rpc(name, args),
    }),
  }),
}));
beforeEach(() => {
  vi.clearAllMocks();
  state.saved = true;
  state.fail = false;
  state.followed = false;
  state.origin = "official";
  state.quote = "Synthetic confirmed source text";
  state.rpc.mockImplementation(
    async (
      _name: string,
      { p }: { p: { action: string; enabled?: boolean } },
    ) => {
      if (p.action === "list")
        return {
          data: state.saved ? [{ calendar_id: dateId }] : [],
          error: null,
        };
      if (state.fail) return { data: null, error: { message: "denied" } };
      state.saved = Boolean(p.enabled);
      return {
        data: { saved: true, delivery: "saved_interest_only" },
        error: null,
      };
    },
  );
});
afterEach(() => cleanup());

describe("calendar occurrence saved interest actions", () => {
  it("allows removing an owned saved interest after unfollowing the company and persists it across remount", async () => {
    const view = render(<RedesignEvent id={dateId} kind="calendar" />);
    const remove = await screen.findByRole("button", { name: "저장됨 · 취소" });
    await waitFor(() =>
      expect((remove as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(remove);
    await waitFor(() => expect(state.saved).toBe(false));
    expect(state.rpc).toHaveBeenCalledWith("sb_reference_reminders", {
      p: { action: "set", calendar_id: dateId, enabled: false },
    });
    await waitFor(() =>
      expect(
        screen
          .getByRole("button", { name: "저장하기" })
          .getAttribute("aria-pressed"),
      ).toBe("false"),
    );
    view.unmount();
    render(<RedesignEvent id={dateId} kind="calendar" />);
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: "저장하기" }) as HTMLButtonElement)
          .disabled,
      ).toBe(true),
    );
  });
  it("keeps saved state and shows no success when removal is rejected", async () => {
    state.fail = true;
    render(<RedesignEvent id={dateId} kind="calendar" />);
    const remove = await screen.findByRole("button", { name: "저장됨 · 취소" });
    await waitFor(() =>
      expect((remove as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(remove);
    await screen.findByRole("alert");
    expect(state.saved).toBe(true);
    expect(
      screen
        .getByRole("button", { name: "저장됨 · 취소" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(screen.queryByText("저장을 취소했습니다.")).toBeNull();
  });
  it("does not offer a new official-date save when the required company membership is absent", async () => {
    state.saved = false;
    render(<RedesignEvent id={dateId} kind="calendar" />);
    await waitFor(() => expect(state.rpc).toHaveBeenCalled());
    expect(
      (screen.getByRole("button", { name: "저장하기" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      screen.getByText("관심 기업에 추가한 뒤 해당 일정을 저장할 수 있습니다."),
    ).toBeTruthy();
    expect(
      state.rpc.mock.calls.every((call) => call[1].p.action === "list"),
    ).toBe(true);
  });
  it("does not invent session times, venues, or quote prices for a date-only occurrence", async () => {
    render(<RedesignEvent id={dateId} kind="calendar" />);
    await screen.findByRole("button", { name: "저장됨 · 취소" });
    expect(
      screen.getByText("공식 출처에서 확인된 세션 정보가 아직 없습니다."),
    ).toBeTruthy();
    expect(
      screen.getByText("정확한 시간·장소는 공식 원문에서 확인하세요."),
    ).toBeTruthy();
    expect(screen.queryByText("15:00")).toBeNull();
    expect(screen.queryByText("73,400원")).toBeNull();
  });
  it("labels an official occurrence by its stored date while preserving source-stated times", async () => {
    state.quote = "Synthetic official webcast: November 11, 2026 at 9:00 a.m. Pacific Time.";
    render(<RedesignEvent id={dateId} kind="calendar" />);
    await screen.findByRole("button", { name: "저장됨 · 취소" });
    expect(screen.getAllByText("2026-11-11 · 날짜 기준")).toHaveLength(2);
    expect(screen.getByText(state.quote)).toBeTruthy();
    expect(screen.queryByText(/원문에 확인된 세부 시간·장소 정보가 없습니다/)).toBeNull();
    expect(screen.queryByText(/2026-11-11 · 종일/)).toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: "리마인더 설정" })[0]);
    expect(screen.getByText("이 일정은 날짜 기준으로 표시하고 내보냅니다. 정확한 시간은 공식 원문에서 확인하세요.")).toBeTruthy();
    expect(screen.queryByText("이 일정은 시간 정보가 없는 종일 일정입니다.")).toBeNull();
  });
  it("keeps explicitly date-only personal occurrences labeled as all-day", async () => {
    state.origin = "user";
    render(<RedesignEvent id={dateId} kind="calendar" />);
    await screen.findByRole("button", { name: "저장됨 · 취소" });
    expect(screen.getAllByText("2026-11-11 · 종일")).toHaveLength(2);
    expect(screen.queryByText(/2026-11-11 · 날짜 기준/)).toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: "리마인더 설정" })[0]);
    expect(screen.getByText("이 일정은 시간 정보가 없는 종일 일정입니다.")).toBeTruthy();
    expect(screen.queryByText("이 일정은 날짜 기준으로 표시하고 내보냅니다. 정확한 시간은 공식 원문에서 확인하세요.")).toBeNull();
  });
});
