"use client";

import {useEffect, useRef, useState, type FormEvent} from "react";
import {initializeSupabase} from "@/lib/supabase";
import {BrandMark} from "./icons";
import "./mfa-challenge.css";

/** Reached only after the authenticated API requires a higher assurance level. */
export default function MfaChallenge({onCancel}: {onCancel: () => Promise<void>}) {
  const [factors, setFactors] = useState<{id: string; friendly_name?: string}[]>([]);
  const [factorId, setFactorId] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const lock = useRef(false);
  useEffect(() => {
    let active = true;
    setLoading(true);
    initializeSupabase().then(db => db.auth.mfa.listFactors()).then(result => {
      if (result.error) throw result.error;
      const verified = result.data.totp.filter(f => f.status === "verified");
      if (active) {
        setFactors(verified);
        setFactorId(verified[0]?.id ?? "");
        setError(verified.length ? "" : "사용 가능한 인증 앱이 없습니다. 로그아웃 후 계정 복구를 진행해 주세요.");
      }
    }).catch(() => {if (active) setError("인증 정보를 불러오지 못했습니다. 다시 시도해 주세요.");})
      .finally(() => {if (active) setLoading(false);});
    return () => {active = false;};
  }, [revision]);

  async function verify(event: FormEvent) {
    event.preventDefault();
    if (lock.current || !factorId || !/^\d{6}$/.test(code)) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const db = await initializeSupabase();
      const result = await db.auth.mfa.challengeAndVerify({factorId, code});
      if (result.error) throw result.error;
      // The auth listener receives the upgraded token. Only a successful /me
      // response releases this gate; a UI toggle never grants access.
      setCode("");
    } catch {
      setError("인증 코드가 잘못되었거나 만료되었습니다. 새 코드를 입력해 주세요.");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function cancel() {
    if (lock.current) return;
    setBusy(true);
    try {await onCancel();} catch {setError("로그아웃을 완료하지 못했습니다. 다시 시도해 주세요.");}
    finally {setBusy(false);}
  }
  return <main className="mfa-screen"><section className="mfa-card" aria-busy={loading || busy}>
    <div className="mfa-brand"><BrandMark/>SignalBrief</div>
    <h1>2단계 인증</h1><p>인증 앱의 6자리 코드를 입력해 로그인을 완료하세요.</p>
    {loading && <p role="status">인증 정보를 확인하고 있습니다…</p>}
    {error && <p role="alert" className="mfa-error">{error}</p>}
    <form onSubmit={verify}>
      {factors.length > 1 && <label>인증 수단<select value={factorId} onChange={e => setFactorId(e.target.value)} disabled={busy}>{factors.map(f => <option key={f.id} value={f.id}>{f.friendly_name || "인증 앱"}</option>)}</select></label>}
      <label>인증 앱 코드<input autoFocus required autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={code} disabled={loading || busy || !factorId} onChange={e => setCode(e.target.value.replace(/\D/g, ""))}/></label>
      <button type="submit" disabled={loading || busy || code.length !== 6 || !factorId}>{busy ? "확인 중…" : "인증하고 계속하기"}</button>
    </form>
    <div className="mfa-options"><button disabled={busy} onClick={() => setRevision(x => x + 1)}>다시 불러오기</button><button disabled={busy} onClick={() => void cancel()}>로그아웃</button></div>
    <small>인증 코드와 복구 정보를 다른 사람에게 공유하지 마세요.</small>
  </section></main>;
}
