"use client";
import { ErrorState } from "@/components/ui";
export default function ErrorPage({reset}:{error:Error&{digest?:string};reset:()=>void}){return <main className="auth-wrap"><ErrorState message="화면을 표시하는 중 오류가 발생했습니다. 오류가 반복되면 운영자에게 알려주세요." retry={reset}/></main>;}
