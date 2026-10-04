"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "./auth";
import { initializeSupabase } from "@/lib/supabase";
import { siteOrigin } from "@/lib/site-url";
import { Icon } from "./icons";

export type AuthMode = "login" | "signup" | "reset";

const copy: Record<AuthMode, { title: string; description: string; submit: string }> = {
  login: {
    title: "중요한 변화부터 확인하세요",
    description: "내 종목, 이전과의 차이, 확인 가능한 원문.",
    submit: "로그인",
  },
  signup: {
    title: "나만의 브리핑을 시작하세요",
    description: "이메일 또는 Google 계정으로 무료 계정을 만들 수 있습니다.",
    submit: "계정 만들기",
  },
  reset: {
    title: "비밀번호를 재설정하세요",
    description: "가입한 이메일 주소로 비밀번호 재설정 링크를 보내드립니다.",
    submit: "복구 메일 요청",
  },
};

export default function LoginForm({ mode }: { mode: AuthMode }) {
  const auth = useAuth();
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const inFlight = useRef(false);

  useEffect(() => {
    if (auth.me) {
      router.replace(auth.me.onboarding_completed ? "/today" : "/onboarding");
    }
  }, [auth.me, router]);

  async function run(action: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setMessage("");
    setError("");
    try {
      await action();
    } catch {
      setError(
        mode === "reset"
          ? "복구 메일 요청을 완료하지 못했습니다. 이메일 주소를 확인하고 다시 시도해 주세요."
          : "요청을 완료하지 못했습니다. 이메일, 비밀번호 또는 이메일 인증 상태를 확인해 주세요.",
      );
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (mode === "signup" && !acknowledged) {
      setError("서비스 이용 안내와 개인정보 처리 안내를 먼저 확인해 주세요.");
      return;
    }

    await run(async () => {
      const canonical = siteOrigin(
        location.href,
        process.env.NEXT_PUBLIC_SITE_URL,
        process.env.NODE_ENV === "production",
      );
      const callback = `${canonical}/auth/callback`;
      if (location.origin !== canonical) {
        location.assign(`${canonical}/${mode === 'reset' ? 'forgot-password' : mode}`);
        return;
      }
      const supabase = await initializeSupabase();

      if (mode === "login") {
        const result = await supabase.auth.signInWithPassword({ email, password });
        if (result.error) throw result.error;
        router.replace("/today");
        return;
      }

      if (mode === "signup") {
        const result = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: callback, ...(name.trim() ? {data: {full_name: name.trim()}} : {}) },
        });
        if (result.error) throw result.error;

        if (result.data.session) {
          router.replace("/onboarding");
        } else {
          setMessage("가입 요청을 접수했습니다. 가입 가능한 이메일이라면 인증 메일이 도착합니다. 이메일의 링크를 열어 가입을 완료해 주세요.");
        }
        return;
      }

      const result = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${callback}?next=reset-password`,
      });
      if (result.error) throw result.error;
      setMessage("복구 가능한 계정이라면 비밀번호 재설정 메일이 발송됩니다.");
    });
  }

  const text = copy[mode];

  return (
    <section className="login-box" aria-label={text.title} aria-busy={busy}>
      <span className="eyebrow">
        {mode === "login" ? "WELCOME BACK" : mode === "signup" ? "GET STARTED" : "ACCOUNT RECOVERY"}
      </span>

      {mode === "reset" ? <h1>{text.title}</h1> : <h2>{text.title}</h2>}
      <p className="muted">{text.description}</p>

      <form className="form-stack" onSubmit={submit}>
        {mode === "signup" && <label className="field"><span>이름 (선택)</span><input autoComplete="name" value={name} onChange={event=>setName(event.target.value)} placeholder="표시 이름" maxLength={80} disabled={busy}/></label>}
        <label className="field">
          <span>이메일</span>
          <input
            autoComplete="email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="name@example.com"
            required
            maxLength={254}
            disabled={busy}
          />
        </label>

        {mode !== "reset" && (
          <div className="field">
            <label htmlFor="auth-password">비밀번호</label>
            <div className="password-field">
              <input
                id="auth-password"
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
                type={show ? "text" : "password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                minLength={mode === "signup" ? 12 : 1}
                maxLength={128}
                placeholder={mode === "signup" ? "12자 이상 입력" : "비밀번호 입력"}
                required
                disabled={busy}
                aria-describedby={mode === "signup" ? "password-requirement" : undefined}
              />
              <button
                type="button"
                onClick={() => setShow((value) => !value)}
                aria-label={show ? "비밀번호 숨기기" : "비밀번호 보기"}
                aria-pressed={show}
                disabled={busy}
              >
                {show ? "숨김" : "보기"}
              </button>
            </div>
            {mode === "signup" && <p id="password-requirement" className={'password-requirement'+(password.length >= 12 ? ' is-met' : '')}><Icon name={password.length >= 12 ? 'check' : 'shield'} size={14}/>{password.length >= 12 ? '12자 이상 입력했습니다.' : '비밀번호는 12자 이상으로 입력해 주세요.'}</p>}
          </div>
        )}

        {mode === "login" && <Link className="d-forgot-link" href="/forgot-password">비밀번호 찾기</Link>}
        {mode === "signup" && <div className="d-signup-ack"><label><input type="checkbox" checked={acknowledged} onChange={event=>setAcknowledged(event.target.checked)} required disabled={busy}/>서비스 이용 안내와 개인정보 처리 안내를 확인했습니다.</label><p><Link href="/terms" target="_blank" rel="noopener noreferrer">서비스 이용 안내</Link><span> · </span><Link href="/privacy" target="_blank" rel="noopener noreferrer">개인정보 처리 안내</Link></p></div>}
        <button className="button primary full" disabled={busy}>
          {busy ? "처리 중…" : text.submit}
          <Icon name="arrow" size={17} />
        </button>
      </form>

      {mode !== "reset" && <>
        <div className="divider"><span>또는</span></div>
          <button
            type="button"
            className="button google full"
            disabled={busy}
            onClick={() => {
              if (mode === "signup" && !acknowledged) {
                setError("서비스 이용 안내와 개인정보 처리 안내를 먼저 확인해 주세요.");
                return;
              }
              void run(() => auth.googleLogin());
            }}
          >
            <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24"><path fill="#4285f4" d="M22 12.2c0-.7-.1-1.4-.2-2.1H12v4h5.6a4.8 4.8 0 0 1-2.1 3.1v2.6h3.4c2-1.8 3.1-4.5 3.1-7.6Z"/><path fill="#34a853" d="M12 22c2.8 0 5.2-.9 6.9-2.4l-3.4-2.6c-.9.6-2.1 1-3.5 1a6 6 0 0 1-5.6-4.1H2.9v2.7A10 10 0 0 0 12 22Z"/><path fill="#fbbc05" d="M6.4 13.9a6 6 0 0 1 0-3.8V7.4H2.9a10 10 0 0 0 0 9.2Z"/><path fill="#ea4335" d="M12 6c1.6 0 3 .5 4.1 1.6l3.1-3.1A10 10 0 0 0 2.9 7.4l3.5 2.7A6 6 0 0 1 12 6Z"/></svg>
            {mode === "signup" ? "Google로 회원가입" : "Google로 로그인"}
          </button>
      </>}


      {auth.error && (
        <p className="notice danger" role="alert">
          인증 서비스에 연결하지 못했습니다. 새로고침 후 다시 시도해 주세요.
        </p>
      )}

      {error && (
        <p className="notice danger" role="alert">
          {error}
        </p>
      )}

      {message && (
        <p className="notice success" role="status">
          {message}
        </p>
      )}

      {mode === "login" && (
        <div className="auth-links">
          <span>계정이 없으신가요?</span>
          <Link href="/signup">회원가입하기</Link>
        </div>
      )}

      {mode === "signup" && (
        <div className="auth-links">
          <span>이미 계정이 있으신가요?</span>
          <Link href="/login">로그인</Link>
          <Link href="/forgot-password">비밀번호 찾기</Link>
        </div>
      )}

      {mode === "reset" && (
        <div className="auth-links">
          <Link href="/login">로그인으로 돌아가기</Link>
          <Link href="/signup">회원가입하기</Link>
        </div>
      )}

      {mode === "login" && auth.config?.demo_mode && (
        <button className="button secondary full" onClick={() => run(() => auth.demoLogin())}>
          로컬 합성 데모로 시작하기
        </button>
      )}

      <p className="login-security">
        <Icon name="shield" size={17} />
        개인정보는 계정별 접근 권한으로 보호합니다.
      </p>

      <Link href="/privacy" className="small muted">
        개인정보 처리 및 서비스 범위
      </Link>
    </section>
  );
}
