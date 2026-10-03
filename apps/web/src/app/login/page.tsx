import Link from "next/link";
import LoginForm from "@/components/login-form";
import { BrandMark } from "@/components/icons";
export default function Login(){return <main className="auth-page"><Link className="brand" href="/"><BrandMark/>SignalBrief</Link><LoginForm/><Link className="small muted" href="/status">서비스 연결 상태 확인</Link></main>;}
