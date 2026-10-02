import Link from "next/link";
export default function NotFound(){return <main className="auth-wrap"><h1>페이지를 찾지 못했습니다.</h1><p>주소를 확인하거나 오늘의 변화로 이동해 주세요.</p><Link className="button primary" href="/today">오늘의 변화</Link></main>;}
