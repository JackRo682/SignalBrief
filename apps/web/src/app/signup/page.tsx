import Link from "next/link";
import LoginForm from "@/components/login-form";

export const metadata = { title: "회원가입" };

export default function SignupPage() {
  return (
    <main className="auth-page">
      <Link href="/" className="auth-brand" aria-label="SignalBrief 홈">
        <span className="auth-brand-mark" aria-hidden="true" />
        SignalBrief
      </Link>
      <LoginForm mode="signup" />
    </main>
  );
}
