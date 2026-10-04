"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { initializeSupabase } from "@/lib/supabase";
import { completeOAuth } from "@/lib/oauth-callback";

export default function Callback() {
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    initializeSupabase()
      .then((db) => completeOAuth(db, location.href))
      .then((path) => {
        if (active) location.replace(path);
      })
      .catch((value) => {
        if (active) setError(value instanceof Error ? value.message : "oauth_failed");
      });

    return () => {
      active = false;
    };
  }, []);

  if (!error) {
    return (
      <main className="authCallbackPage" aria-busy="true">
        <div className="authCallbackSpinner" role="status">
          <span className="spinner" aria-hidden="true" />
          <span className="sr-only">로그인 처리 중</span>
        </div>
      </main>
    );
  }

  return (
    <main className="auth-page">
      <section className="login-box">
        <h1>로그인을 완료하지 못했습니다</h1>
        <p role="alert" className="notice danger">
          {error==='oauth_consent_denied'?'Google 로그인이 취소되었습니다.':'인증 연결이 만료되었거나 완료되지 않았습니다. 다시 로그인해 주세요.'}
        </p>
        <p className="muted">
          로그인을 시작한 같은 브라우저에서 다시 시도해 주세요.
        </p>
        <Link href="/login" className="button primary full">
          로그인 다시 시작
        </Link>
      </section>
    </main>
  );
}
