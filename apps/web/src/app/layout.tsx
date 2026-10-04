import localFont from "next/font/local";
import type { Metadata } from "next";
import { AuthProvider } from "@/components/auth";
import "./globals.css";
import "./release-layout.css";
import "./account-marketing.css";
const appFont=localFont({src:"./fonts/PretendardVariable.woff2",variable:"--font-sans",display:"swap",weight:"100 900"});
export const metadata:Metadata={title:{default:"SignalBrief · 근거로 읽는 변화",template:"%s · SignalBrief"},description:"내 관심종목의 중요한 변화와 그 근거를 한곳에서 확인하세요.",robots:{index:false,follow:false}};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="ko"><body className={appFont.variable}><AuthProvider>{children}</AuthProvider></body></html>;}
