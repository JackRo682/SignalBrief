import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { DemoProvider } from "./preview/provider";

export const metadata: Metadata = {
  title: "SignalBrief · UI 미리보기",
  description:
    "가상 기업과 합성 자료로 둘러보는 SignalBrief UI 미리보기. 실제 금융정보·로그인·AI 연결이 없습니다.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko">
      <body>
        <DemoProvider>{children}</DemoProvider>
      </body>
    </html>
  );
}
