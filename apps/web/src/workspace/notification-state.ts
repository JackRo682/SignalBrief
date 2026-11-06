"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { useAuth } from "@/components/auth";
import { workspace } from "./client";
import { contentNotificationsSchema } from "./contracts";

type Notifications = z.infer<typeof contentNotificationsSchema>;
type ReadConfirmation = { token: string; id?: string; readAt: string };
const contentUpdated = "signalbrief:content-updated";
const storageKey = "signalbrief:notifications-updated";

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
  window.dispatchEvent(new CustomEvent<ReadConfirmation>(contentUpdated, {
    detail: { token, id, readAt: new Date().toISOString() },
  }));
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

  const reload = useCallback(() => {
    const requestId = ++generation.current;
    if (!scope) {
      setState({ scope, data: null, loading: false, error: "" });
      return;
    }
    setState((current) => ({
      scope,
      data: current.scope === scope ? current.data : null,
      loading: true,
      error: "",
    }));
    void workspace(scope, { action: "content_notifications", p: {} }, contentNotificationsSchema)
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

  useEffect(() => {
    const refreshVisible = () => {
      if (document.visibilityState === "visible") reload();
    };
    const update = (event: Event) => {
      const confirmation = event instanceof CustomEvent
        ? event.detail as ReadConfirmation | undefined
        : undefined;
      if (confirmation?.token && confirmation.token !== scope) return;
      if (confirmation?.token === scope) {
        setState((current) => current.scope === scope
          ? { ...current, data: applyRead(current.data, confirmation) }
          : current);
      }
      // Invalidates responses started before a successful mutation, including
      // requests still pending when the notification link navigates away.
      reload();
    };
    const storage = (event: StorageEvent) => {
      if (event.key === storageKey) refreshVisible();
    };
    reload();
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
  }, [invalidatePending, reload, scope]);

  const current = state.scope === scope;
  return {
    data: current ? state.data : null,
    loading: Boolean(scope && (!current || (state.loading && !state.data))),
    error: current ? state.error : "",
    reload,
  };
}
