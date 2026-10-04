import MarketingInfoPage from "@/components/marketing-info-page";

export const metadata = { title: "고객 사례" };

export default function CustomersPage() {
  return (
    <MarketingInfoPage
      current="/customers"
      eyebrow="CUSTOMER STORIES"
      title="내 종목을 확인하는 새로운 흐름을 만나보세요."
      description="공개 고객 사례는 준비 중입니다. 먼저 SignalBrief에서 활용할 수 있는 흐름을 살펴보세요."
      sections={[
        {
          title: "관심종목의 변화 확인",
          body: "관심 기업을 저장하고 새 공시의 변화와 원문 근거를 함께 확인합니다.",
        },
        {
          title: "보유종목 중심으로 탐색",
          body: "등록한 보유종목에 관련된 이벤트를 찾고, 기업별 타임라인에서 이전 자료와 이어서 읽을 수 있습니다.",
        },
        {
          title: "직접 확인하기",
          body: "제품의 실제 기능은 계정을 만든 뒤 관심종목, 타임라인, 포트폴리오, 질문과 알림 흐름에서 직접 확인할 수 있습니다.",
        },
      ]}
    />
  );
}
