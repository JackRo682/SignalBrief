import AuthLayout from "@/components/auth-layout";
import LoginForm from "@/components/login-form";
export const metadata = { title: "회원가입" };
export default function Page() {return <AuthLayout mode="signup"><LoginForm mode="signup" /></AuthLayout>;}
