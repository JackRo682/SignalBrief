"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { useAuth } from "@/components/auth";
import { pageDataCache } from "@/lib/page-data-cache";
import { workspace } from "./client";
import { contentNotificationsSchema } from "./contracts";

type Notifications = z.infer<typeof contentNotificationsSchema>;
type ReadConfirmation = { token: string; id?: string; readAt: string };
const contentUpdated = "signalbrief:content-updated";
const storageKey = "signalbrief:notifications-updated";
const notificationRequest = { action: "content_notifications", p: {} } as const;
const notificationKey = `workspace:${JSON.stringify(notificationRequest)}`;
// A DOM event is delivered to every mounted notification consumer. Invalidate
// once so the header and page share the same subsequent network request.
const invalidatedEvents = new WeakSet<Event>();

function invalidateForEvent(scope: string | null, event: Event) {
  if (!scope || !pageDataCache.isCurrent(scope) || invalidatedEvents.has(event)) return;
  pageDataCache.invalidate(scope, notificationKey);
  invalidatedEvents.add(event);
}

function applyRead(data: Notifications | null, confirmation: ReadConfirmation) {
  if (!data) return data;
  const { id, readAt } = confirmation;
  const wasUnread = data.items.some((item) => item.id === id && !item.read_at);
  return {
    ...data,
    items: data.items.map((item) =>
      !id || item.id === id
        ? { ...item, read_at: item.read_at ?? readAt }
        : item,
    ),
    // The total includes older notifications outside the latest 100 rows.
    unread_count: id ? Math.max(0, data.unread_count - Number(wasUnread)) : 0,
  };
}

export async function markContentNotificationRead(token: string | null, id?: string) {
  if (!token) throw new Error("로그인이 필요합니다.");
  await workspace(
    token,
    { action: "content_notification_read", p: id ? { id } : { all: true } },
    z.unknown(),
  );
  // Only a confirmed write may clear a row or badge. No credentials or notification
  // contents are stored in the cross-tab signal.
  const confirmation = { token, id, readAt: new Date().toISOString() };
  pageDataCache.update<Notifications>(token, notificationKey,
    (data) => applyRead(data ?? null, confirmation) ?? undefined);
  const event = new CustomEvent<ReadConfirmation>(contentUpdated, { detail: confirmation });
  invalidatedEvents.add(event);
  window.dispatchEvent(event);
  try {
    localStorage.setItem(storageKey, `${Date.now()}:${Math.random()}`);
  } catch {
    // Restricted browser storage still has focus/visibility revalidation.
  }
}

export function useContentNotifications(enabled = true) {
  const { token } = useAuth();
  const scope = enabled ? token : null;
  const generation = useRef(0);
  const invalidatePending = useCallback(() => { ++generation.current; }, []);
  const [state, setState] = useState<{
    scope: string | null;
    data: Notifications | null;
    loading: boolean;
    error: string;
  }>({ scope: null, data: null, loading: false, error: "" });

  const revalidate = useCallback(() => {
    const requestId = ++generation.current;
    if (!scope) {
      setState({ scope, data: null, loading: false, error: "" });
      return;
    }
    const cached = pageDataCache.peek<Notifications>(scope, notificationKey);
    setState((current) => ({
      scope,
      data: current.scope === scope ? current.data ?? cached ?? null : cached ?? null,
      loading: true,
      error: "",
    }));
    void pageDataCache.request(scope, notificationKey, "GET", () =>
      workspace(scope, notificationRequest, contentNotificationsSchema))
      .then((data) => {
        if (generation.current === requestId)
          setState({ scope, data, loading: false, error: "" });
      })
      .catch((error: unknown) => {
        if (generation.current === requestId)
          setState((current) => ({
            ...current,
            loading: false,
            error: error instanceof Error ? error.message : "알림을 불러오지 못했습니다.",
          }));
      });
  }, [scope]);
  const reload = useCallback(() => {
    if (scope) pageDataCache.invalidate(scope, notificationKey);
    revalidate();
  }, [scope, revalidate]);

  useEffect(() => {
    const refreshVisible = (event?: Event) => {
      if (document.visibilityState !== "visible") return;
      if (event) invalidateForEvent(scope, event);
      // The periodic read is already older than the cache's 30-second TTL.
      revalidate();
    };
    const update = (event: Event) => {
      const confirmation = event instanceof CustomEvent
        ? event.detail as ReadConfirmation | undefined
        : undefined;
      if (confirmation?.token && confirmation.token !== scope) return;
      invalidateForEvent(scope, event);
      if (confirmation?.token === scope) {
        setState((current) => current.scope === scope
          ? { ...current, data: applyRead(current.data, confirmation) }
          : current);
      }
      // Invalidates responses started before a successful mutation, including
      // requests still pending when the notification link navigates away.
      revalidate();
    };
    const storage = (event: StorageEvent) => {
      if (event.key === storageKey) refreshVisible(event);
    };
    revalidate();
    window.addEventListener(contentUpdated, update);
    window.addEventListener("focus", refreshVisible);
    document.addEventListener("visibilitychange", refreshVisible);
    window.addEventListener("storage", storage);
    const timer = window.setInterval(refreshVisible, 60000);
    return () => {
      invalidatePending();
      window.clearInterval(timer);
      window.removeEventListener(contentUpdated, update);
      window.removeEventListener("focus", refreshVisible);
      document.removeEventListener("visibilitychange", refreshVisible);
      window.removeEventListener("storage", storage);
    };
  }, [invalidatePending, revalidate, scope]);

  const current = state.scope === scope;
  const cached = scope ? pageDataCache.peek<Notifications>(scope, notificationKey) : undefined;
  const data = current ? state.data ?? cached ?? null : cached ?? null;
  return {
    data,
    loading: Boolean(scope && !data && (!current || state.loading)),
    error: current ? state.error : "",
    reload,
    revalidate,
  };
}
