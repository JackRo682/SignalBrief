import MarketingInfoPage from "@/components/marketing-info-page";

export const metadata = { title: "요금제" };

export default function PricingPage() {
  return (
    <MarketingInfoPage
      current="/pricing"
      eyebrow="PRICING"
      title="무료로 시작하는 관심종목 브리핑."
      description="현재 제공되는 기능을 무료로 이용하세요. 가입할 때 결제 정보를 등록할 필요가 없습니다."
      sections={[
        {
          title: "현재 이용",
          body: "계정을 만들어 현재 제공되는 기능을 사용할 수 있습니다. 실제 제공 범위는 서비스 연결 상태와 계정 권한에 따라 달라질 수 있습니다.",
        },
        {
          title: "결제 정보",
          body: "현재 프로덕션 서비스에는 구독 결제나 카드 청구 흐름이 연결되어 있지 않습니다.",
        },
        {
          title: "향후 변경",
          body: "유료 요금제를 도입하게 되면 가격, 제공 기능과 적용 시점을 이 페이지에 안내합니다.",
        },
      ]}
    />
  );
}
