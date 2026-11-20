import type {TrafficSummary} from './contracts';

type ProductSummary = NonNullable<TrafficSummary['product']>;
export default function ProductFunnelPanel({data}: {data: ProductSummary}) {
  const steps = [
    ['공개 홈 방문', data.landing_visitors],
    ['검색·필터 사용', data.engaged_visitors],
    ['이벤트 상세 클릭', data.detail_click_visitors],
    ['상세 화면 확인', data.detail_view_visitors],
  ] as const;
  const ratio = (value: number, base: number) => base ? `${(100 * value / base).toFixed(1)}%` : '측정 대기';
  return <section className="traffic-product-funnel" aria-labelledby="product-funnel-title">
    <h3 id="product-funnel-title">방문 → 탐색 → 이벤트 상세</h3>
    <p>선택한 기간에 동일한 브라우저가 아래 순서대로 진행했는지 확인합니다.</p>
    <div className="traffic-metrics">{steps.map(([label, value], index) => <div key={label}>
      <span>{label}</span><strong>{value.toLocaleString('ko-KR')}</strong>
      {index > 0 && <small>이전 단계 대비 {ratio(value, steps[index - 1][1])}</small>}
    </div>)}</div>
    <p><strong>홈 방문 → 상세 화면 확인: {ratio(data.detail_view_visitors, data.landing_visitors)}</strong></p>
    <p className="overview-note">각 단계는 브라우저별로 한 번만 셉니다. 공개 홈 방문 이후 검색 또는 필터를 사용하고, 그 뒤 상세를 클릭한 경우만 다음 단계에 포함합니다. 상세 클릭과 정상적으로 불러온 상세 화면은 구분합니다. 같은 방문 세션인지와 관계없이 선택 기간 내 순서를 기준으로 합니다.</p>
    <div className="traffic-tables"><div><h4>기간 내 전체 동의 활동</h4><table>
      <thead><tr><th>행동</th><th>횟수</th></tr></thead><tbody>
        {[
          ['검색 실행', data.search_events], ['필터 변경', data.filter_events],
          ['이벤트 상세 클릭', data.detail_click_events], ['상세 화면 확인', data.detail_view_events],
        ].map(([label, value]) => <tr key={label}><td>{label}</td><td>{Number(value).toLocaleString('ko-KR')}</td></tr>)}
      </tbody></table></div></div>
    <p className="overview-note">로그인 후 행동은 방문 통계의 새 동의와 계정의 선택적 이용 통계 동의가 모두 있는 경우에만 기록합니다. 관리자·데모 이용과 개인 일정은 제외합니다. 행동 횟수에는 공개 홈을 거치지 않고 앱에 바로 들어온 동의 사용자도 포함하므로 위 전환 단계의 브라우저 수와 다릅니다. 검색어·기업명·개인 일정 내용은 수집하지 않습니다. 통계만으로 개선의 인과관계나 통계적 유의성을 판단하지 않습니다.</p>
    {data.landing_visitors === 0 && <p role="status">이 기간의 홈 방문 표본을 기다리고 있습니다. 설치 이전 행동 기록은 복원하지 않습니다.</p>}
  </section>;
}
