import AuthLayout from '@/components/auth-layout';
import ResetPasswordForm from '@/components/reset-password-form';
export const metadata={title:'새 비밀번호 설정'};
export default function Page(){return <AuthLayout recovery><ResetPasswordForm/></AuthLayout>;}
