"use client";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth";
import { newsResponse, type NewsResponse } from "@/lib/news-contract";

class NewsError extends Error {}
const unavailableMessage =
  "뉴스를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.";

/** Reuses the existing news page and company detail API. */
export function useHomeBNews(companyId: string) {
  const { token } = useAuth(),
    [revision, setRevision] = useState(0);
  const key = JSON.stringify([token, companyId, revision]);
  const [state, setState] = useState<{
    key: string;
    data: NewsResponse | null;
    error: string;
  }>({ key: "", data: null, error: "" });
  useEffect(() => {
    if (!token) return;
    let alive = true;
    const controller = new AbortController();
    const query = companyId
      ? `company_id=${encodeURIComponent(companyId)}`
      : `q=${encodeURIComponent("증시")}`;
    void fetch(`/api/news?${query}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(22000)]),
    })
      .then(async (response) => {
        if (!response.ok)
          throw new NewsError(
            response.status === 429
              ? "뉴스 요청이 많습니다. 잠시 후 다시 시도해 주세요."
              : response.status === 422
                ? "이 기업의 공식 뉴스 검색 정보를 확인하지 못했습니다."
                : "뉴스 제공자에 연결하지 못했습니다.",
          );
        const data = newsResponse.parse(await response.json());
        if (alive) setState({ key, data, error: "" });
      })
      .catch((error: unknown) => {
        if (alive)
          setState({
            key,
            data: null,
            error:
              error instanceof NewsError ? error.message : unavailableMessage,
          });
      });
    return () => {
      alive = false;
      controller.abort();
    };
  }, [token, companyId, key]);
  return {
    data: state.key === key ? state.data : null,
    error: state.key === key ? state.error : "",
    loading: Boolean(token && state.key !== key),
    reload: () => setRevision((value) => value + 1),
  };
}
