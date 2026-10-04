import MarketingInfoPage from "@/components/marketing-info-page";

export const metadata = { title: "서비스 소개" };

export default function AboutPage() {
  return (
    <MarketingInfoPage
      current="/about"
      eyebrow="ABOUT SIGNALBRIEF"
      title="내 종목의 변화, 근거와 함께 한눈에."
      description="SignalBrief는 관심종목과 포트폴리오를 기준으로 무엇이 바뀌었는지, 왜 중요한지, 어떤 원문이 근거인지 빠르게 확인하도록 돕는 투자정보 탐색 서비스입니다."
      sections={[
        {
          title: "문제",
          body: "공시, 뉴스, IR 자료와 시장 데이터가 여러 곳에 흩어져 있어 개인투자자가 중요한 변화를 찾고 원문까지 확인하는 데 시간이 많이 듭니다.",
        },
        {
          title: "SignalBrief의 방식",
          body: "사용자의 관심종목을 중심으로 변화 → 의미 → 근거 → 다음 확인 포인트의 흐름으로 정보를 정리합니다.",
        },
        {
          title: "서비스 범위",
          body: "SignalBrief는 투자정보 탐색과 근거 확인을 돕습니다. 매매 추천, 수익 보장 또는 임의의 목표주가를 제공하는 서비스가 아닙니다.",
        },
      ]}
    />
  );
}
