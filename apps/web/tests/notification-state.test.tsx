import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { contentNotificationsSchema, type WorkspaceRequest } from "../src/workspace/contracts";
import { markContentNotificationRead, useContentNotifications } from "../src/workspace/notification-state";
import { DesktopShell } from "../src/desktop/shell";
import { pageDataCache } from "../src/lib/page-data-cache";

const mocks = vi.hoisted(() => ({ workspace: vi.fn(), token: "synthetic-account-a" }));
vi.mock("@/components/auth", () => ({ useAuth: () => ({
  token: mocks.token,
  me: { id: "synthetic-account", display_name: "Synthetic", onboarding_completed: true },
  loading: false,
}) }));
vi.mock("@/workspace/client", () => ({ workspace: mocks.workspace }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/settings/account",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
vi.mock("@/workspace/preferences", () => ({ usePrefs: () => ({ text: (ko: string) => ko }) }));

type Notifications = z.infer<typeof contentNotificationsSchema>;
const firstId = "80000000-0000-4000-8000-000000000001";
const secondId = "80000000-0000-4000-8000-000000000002";
const unread: Notifications = {
  unread_count: 2,
  items: [firstId, secondId].map((id) => ({
    id,
    created_at: "2026-11-01T00:00:00Z",
    read_at: null,
    resource: {
      id: "40000000-0000-4000-8000-000000000001",
      kind: "us_analysis",
      title: "Synthetic notification",
      summary: "Synthetic test fixture",
      company_id: "20000000-0000-4000-8000-000000000001",
      company_name: "Synthetic company",
      ticker: "TEST",
      market: "NASDAQ",
      source_url: null,
      published_at: null,
      publication_precision: "date",
      category: "analysis",
      is_saved: false,
    },
  })),
};
const read: Notifications = {
  unread_count: 0,
  items: unread.items.map((item) => ({ ...item, read_at: "2026-11-02T00:00:00Z" })),
};

function Consumer({ name }: { name: string }) {
  const state = useContentNotifications();
  return <div data-testid={name}>
    <output aria-label={`${name} unread`}>{state.data?.unread_count ?? "loading"}</output>
    <output aria-label={`${name} rows`}>{state.data?.items.filter((item) => !item.read_at).length ?? "loading"}</output>
    {state.error && <p role="alert">{state.error}</p>}
  </div>;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.workspace.mockReset();
  pageDataCache.reset();
  mocks.token = "synthetic-account-a";
  localStorage.clear();
  mocks.workspace.mockImplementation(async (_token: string, request: WorkspaceRequest) =>
    request.action === "content_notifications" ? structuredClone(unread) : { updated: true });
});
afterEach(() => cleanup());

describe("confirmed notification read state", () => {
  it("updates bell and list immediately after confirmation, keeping other unread rows and older totals", async () => {
    mocks.workspace.mockResolvedValueOnce({ ...unread, unread_count: 102 });
    render(<><Consumer name="bell" /><Consumer name="list" /></>);
    await waitFor(() => expect(screen.getByLabelText("bell unread")).toHaveTextContent("102"));
    await waitFor(() => expect(screen.getByLabelText("list unread")).toHaveTextContent("102"));
    // Hold revalidation: the persisted write itself must update every mounted consumer.
    mocks.workspace.mockImplementation((_token: string, request: WorkspaceRequest) =>
      request.action === "content_notifications" ? new Promise(() => {}) : Promise.resolve({ updated: true }));
    await act(() => markContentNotificationRead(mocks.token, firstId));
    for (const name of ["bell", "list"]) {
      expect(screen.getByLabelText(`${name} unread`)).toHaveTextContent("101");
      expect(screen.getByLabelText(`${name} rows`)).toHaveTextContent("1");
    }
    // A repeated acknowledgement must not decrement the total twice.
    await act(() => markContentNotificationRead(mocks.token, firstId));
    expect(screen.getByLabelText("bell unread")).toHaveTextContent("101");
    await act(() => markContentNotificationRead(mocks.token));
    for (const name of ["bell", "list"]) {
      expect(screen.getByLabelText(`${name} unread`)).toHaveTextContent("0");
      expect(screen.getByLabelText(`${name} rows`)).toHaveTextContent("0");
    }
    const signal = localStorage.getItem("signalbrief:notifications-updated");
    expect(signal).toBeTruthy();
    expect(signal).not.toContain(mocks.token);
    expect(signal).not.toContain(firstId);
  });

  it("leaves every unread state unchanged and sends no cross-tab signal when the write fails", async () => {
    render(<><Consumer name="bell" /><Consumer name="list" /></>);
    await waitFor(() => expect(screen.getByLabelText("list unread")).toHaveTextContent("2"));
    mocks.workspace.mockRejectedValueOnce(new Error("Read failed"));
    await expect(markContentNotificationRead(mocks.token)).rejects.toThrow("Read failed");
    expect(screen.getByLabelText("bell unread")).toHaveTextContent("2");
    expect(screen.getByLabelText("list rows")).toHaveTextContent("2");
    expect(localStorage.getItem("signalbrief:notifications-updated")).toBeNull();
  });

  it("ignores a response started before a confirmed read, even while revalidation is pending", async () => {
    render(<Consumer name="bell" />);
    await waitFor(() => expect(screen.getByLabelText("bell unread")).toHaveTextContent("2"));
    const stale = deferred<Notifications>(), fresh = deferred<Notifications>();
    mocks.workspace.mockImplementation((_token: string, request: WorkspaceRequest) =>
      request.action === "content_notifications" ? fresh.promise : Promise.resolve({ updated: true }));
    mocks.workspace.mockReturnValueOnce(stale.promise);
    fireEvent.focus(window);
    await waitFor(() => expect(mocks.workspace).toHaveBeenCalledTimes(2));
    await act(() => markContentNotificationRead(mocks.token));
    expect(screen.getByLabelText("bell unread")).toHaveTextContent("0");
    await act(async () => { stale.resolve(unread); await stale.promise; });
    expect(screen.getByLabelText("bell unread")).toHaveTextContent("0");
    await act(async () => { fresh.resolve(read); await fresh.promise; });
    expect(screen.getByLabelText("bell unread")).toHaveTextContent("0");
  });

  it("revalidates reads made elsewhere on focus, visibility and cross-tab storage changes", async () => {
    render(<Consumer name="bell" />);
    await waitFor(() => expect(screen.getByLabelText("bell unread")).toHaveTextContent("2"));
    mocks.workspace.mockResolvedValue(read);
    fireEvent.focus(window);
    await waitFor(() => expect(screen.getByLabelText("bell unread")).toHaveTextContent("0"));
    mocks.workspace.mockResolvedValue(unread);
    fireEvent(window, new StorageEvent("storage", { key: "signalbrief:notifications-updated", newValue: "other-tab" }));
    await waitFor(() => expect(screen.getByLabelText("bell unread")).toHaveTextContent("2"));
    mocks.workspace.mockResolvedValue(read);
    fireEvent(document, new Event("visibilitychange"));
    await waitFor(() => expect(screen.getByLabelText("bell unread")).toHaveTextContent("0"));
  });

  it("does not expose a previous account's response or confirmation after an account change", async () => {
    const previous = deferred<Notifications>(), next = deferred<Notifications>();
    mocks.workspace.mockImplementation((token: string, request: WorkspaceRequest) =>
      request.action !== "content_notifications" ? Promise.resolve({ updated: true })
        : token === "synthetic-account-a" ? previous.promise : next.promise);
    const view = render(<Consumer name="bell" />);
    mocks.token = "synthetic-account-b";
    view.rerender(<Consumer name="bell" />);
    await act(async () => { previous.resolve(unread); await previous.promise; });
    expect(screen.getByLabelText("bell unread")).toHaveTextContent("loading");
    await act(() => markContentNotificationRead("synthetic-account-a"));
    expect(screen.getByLabelText("bell unread")).toHaveTextContent("loading");
    await act(async () => { next.resolve(read); await next.promise; });
    expect(screen.getByLabelText("bell unread")).toHaveTextContent("0");
  });

  it("keeps the live desktop settings/help bell in sync on focus and cross-tab reads", async () => {
    render(<DesktopShell><p>Synthetic settings page</p></DesktopShell>);
    const bell = await screen.findByRole("link", { name: "알림 센터 · 읽지 않은 알림 2개" });
    expect(bell.querySelector("i")).not.toBeNull();
    mocks.workspace.mockResolvedValue(read);
    fireEvent.focus(window);
    await waitFor(() => expect(bell).toHaveAccessibleName("알림 센터"));
    expect(bell.querySelector("i")).toBeNull();
    mocks.workspace.mockResolvedValue(unread);
    fireEvent(window, new StorageEvent("storage", { key: "signalbrief:notifications-updated", newValue: "other-tab" }));
    await waitFor(() => expect(bell).toHaveAccessibleName("알림 센터 · 읽지 않은 알림 2개"));
    mocks.workspace.mockImplementation((_token: string, request: WorkspaceRequest) =>
      request.action === "content_notifications" ? new Promise(() => {}) : Promise.resolve({ updated: true }));
    await act(() => markContentNotificationRead(mocks.token));
    expect(bell).toHaveAccessibleName("알림 센터");
    expect(bell.querySelector("i")).toBeNull();
  });
});

describe("shared notification reads", () => {
  it("shares one initial request and one event refresh between the header and page", async () => {
    const pending = deferred<Notifications>();
    mocks.workspace.mockReturnValueOnce(pending.promise);
    render(<><Consumer name="bell" /><Consumer name="list" /></>);
    await waitFor(() => expect(mocks.workspace).toHaveBeenCalledTimes(1));
    await act(async () => { pending.resolve(unread); await pending.promise; });
    expect(screen.getByLabelText("bell unread")).toHaveTextContent("2");
    expect(screen.getByLabelText("list unread")).toHaveTextContent("2");
    mocks.workspace.mockResolvedValue(read);
    fireEvent.focus(window);
    await waitFor(() => expect(screen.getByLabelText("list unread")).toHaveTextContent("0"));
    expect(screen.getByLabelText("bell unread")).toHaveTextContent("0");
    expect(mocks.workspace).toHaveBeenCalledTimes(2);
  });

  it("renders previously loaded notifications synchronously on a return visit", async () => {
    const first = render(<Consumer name="first" />);
    await waitFor(() => expect(screen.getByLabelText("first unread")).toHaveTextContent("2"));
    first.unmount();
    render(<Consumer name="return" />);
    expect(screen.getByLabelText("return unread")).toHaveTextContent("2");
    await act(async () => {});
    expect(mocks.workspace).toHaveBeenCalledTimes(1);
  });

  it("keeps confirmed reads in the cached snapshot while a return visit revalidates", async () => {
    const first = render(<Consumer name="first" />);
    await waitFor(() => expect(screen.getByLabelText("first unread")).toHaveTextContent("2"));
    first.unmount();
    mocks.workspace.mockImplementation((_token: string, request: WorkspaceRequest) =>
      request.action === "content_notifications" ? new Promise(() => {}) : Promise.resolve({ updated: true }));
    await act(() => markContentNotificationRead(mocks.token, firstId));
    render(<Consumer name="return" />);
    expect(screen.getByLabelText("return unread")).toHaveTextContent("1");
    expect(screen.getByLabelText("return rows")).toHaveTextContent("1");
  });

  it("does not discard already loaded rows when background revalidation fails", async () => {
    render(<Consumer name="bell" />);
    await waitFor(() => expect(screen.getByLabelText("bell unread")).toHaveTextContent("2"));
    mocks.workspace.mockRejectedValueOnce(new Error("Synthetic notification outage"));
    fireEvent.focus(window);
    expect(await screen.findByRole("alert")).toHaveTextContent("Synthetic notification outage");
    expect(screen.getByLabelText("bell unread")).toHaveTextContent("2");
  });
});
