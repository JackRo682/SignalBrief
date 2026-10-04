import MarketingInfoPage from "@/components/marketing-info-page";

export const metadata = { title: "데이터 출처" };

export default function SourcesPage() {
  return (
    <MarketingInfoPage
      current="/sources"
      eyebrow="DATA SOURCES"
      title="원문에서 시작하는 믿을 수 있는 정보."
      description="현재 초기 버전은 미국 주식 데이터 연결을 우선하며, 공식 원문과 실제 연결 상태를 기준으로 화면을 구성합니다."
      sections={[
        {
          title: "공식 공시",
          body: "미국 기업 공시는 SEC 원문을 우선합니다. 문서 제목, 게시 시점과 원문 링크를 함께 확인할 수 있도록 구성합니다.",
        },
        {
          title: "기업 IR 및 공식 자료",
          body: "기업이 직접 공개한 IR 자료 등 검증 가능한 공식 출처를 연결할 수 있도록 설계되어 있습니다.",
        },
        {
          title: "현재 연결 범위",
          body: "한국 DART·KRX 데이터는 초기 미국 주식 버전에서 보류된 상태입니다. 수집 또는 검토가 완료되지 않은 데이터는 실제 데이터처럼 표시하지 않습니다.",
        },
      ]}
    />
  );
}
