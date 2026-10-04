import AuthLayout from "@/components/auth-layout";
import LoginForm from "@/components/login-form";
export const metadata = { title: "비밀번호 찾기" };
export default function Page() {return <AuthLayout recovery><LoginForm mode="reset" /></AuthLayout>;}
