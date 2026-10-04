import MarketingInfoPage from "@/components/marketing-info-page";

export const metadata = { title: "주요 기능" };

export default function FeaturesPage() {
  return (
    <MarketingInfoPage
      current="/features"
      eyebrow="FEATURES"
      title="관심종목의 변화부터 원문 확인까지 한 흐름으로 연결합니다."
      description="실제 계정과 실제 연결 데이터를 기준으로 제공되는 핵심 기능입니다."
      sections={[
        {
          title: "관심종목",
          body: "보고 싶은 기업을 저장하고 중요한 변화가 생겼을 때 다시 찾기 쉽게 관리합니다.",
          items: ["Watchlist", "기업 검색", "기업별 타임라인"],
        },
        {
          title: "포트폴리오 인텔리전스",
          body: "등록한 보유종목을 기준으로 기업 이벤트와 포트폴리오 관련 정보를 연결합니다.",
          items: ["보유종목 관리", "중요 이벤트 확인", "개인화된 탐색 흐름"],
        },
        {
          title: "근거 기반 질문과 알림",
          body: "공시·원문 근거에 연결된 질문, 캘린더와 알림을 통해 다음에 확인할 내용을 관리합니다.",
          items: ["근거 질문", "캘린더", "알림 센터"],
        },
      ]}
    />
  );
}
