import AuthLayout from "@/components/auth-layout";
import LoginForm from "@/components/login-form";
export const metadata = { title: "로그인" };
export default function Page() {return <AuthLayout><LoginForm mode="login" /></AuthLayout>;}
