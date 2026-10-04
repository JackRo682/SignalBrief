import Link from "next/link";
import LoginForm from "@/components/login-form";

export const metadata = { title: "비밀번호 찾기" };

export default function ForgotPasswordPage() {
  return (
    <main className="auth-page">
      <Link href="/" className="auth-brand" aria-label="SignalBrief 홈">
        <span className="auth-brand-mark" aria-hidden="true" />
        SignalBrief
      </Link>
      <LoginForm mode="reset" />
    </main>
  );
}
