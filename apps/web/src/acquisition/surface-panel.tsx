import type {TrafficSummary} from './contracts';
const sources:Record<string,string>={kakao:'카카오',direct:'직접·내부 이동',naver:'네이버',google:'Google',disquiet:'디스콰이엇',geeknews:'GeekNews',youtube:'YouTube',x:'X',other:'기타'};
const labels:Record<string,string>={home:'공개 홈',app_home:'앱 홈',today:'오늘',search:'검색',calendar:'캘린더',event_detail:'이벤트 상세',pricing:'요금',features:'기능 소개',sources:'출처',customers:'이용 대상',about:'소개',privacy:'개인정보',terms:'약관',disclaimer:'고지',signup:'가입',login:'로그인',search_used:'검색 실행',filter_used:'필터 변경',event_detail_click:'상세 클릭',event_detail_view:'상세 열람'};
export default function SurfacePanel({data}:{data:TrafficSummary}){
  if(!data.surface_times)return null;
  return <section className="traffic-product-funnel"><h3>화면별 활성 체류 시간</h3>
    <p>같은 화면과 최초 유입 경로의 배포 버전별 표본을 비교할 수 있습니다. 선택한 한국시간 기간에 시작한 화면 방문마다 한 번 집계합니다. 평균과 중앙값에는 0초 방문도 포함됩니다. 숨김·포커스 이탈 시간과 마지막 입력 30초 이후는 제외합니다.</p>
    {data.surface_times.length ? <div className="traffic-tables"><div><table><thead><tr>{['화면','최초 유입','배포 버전','화면 방문','브라우저','평균(초)','중앙값(초)'].map(x=><th key={x}>{x}</th>)}</tr></thead><tbody>
    {data.surface_times.map(row=><tr key={row.surface+':'+row.source+':'+row.release}><td>{labels[row.surface]??row.surface}</td><td>{sources[row.source]}</td><td title={row.release}>{row.release==='unversioned'?'버전 미확인':row.release.slice(0,8)}</td><td>{row.views}</td><td>{row.browsers}</td><td>{(row.mean_ms/1000).toFixed(1)}</td><td>{(row.median_ms/1000).toFixed(1)}</td></tr>)}</tbody></table></div></div> : <p>선택한 기간에 새 측정 방식으로 기록된 화면 방문이 없습니다.</p>}
    <p>체류 시간은 마지막으로 서버에 도착한 누적값입니다. 종료 신호가 유실되면 실제보다 짧을 수 있습니다. 브라우저 수는 화면·최초 유입·버전별 중복 제거 값입니다.</p>
    {!!data.feature_actions?.length && <><h4>기능별 행동</h4><div className="traffic-tables"><div><table><thead><tr>{['화면','행동','발생 횟수','이용 브라우저'].map(x=><th key={x}>{x}</th>)}</tr></thead><tbody>{data.feature_actions.map(row=><tr key={row.page+':'+row.kind}><td>{labels[row.page]}</td><td>{labels[row.kind]}</td><td>{row.events}</td><td>{row.browsers}</td></tr>)}</tbody></table></div></div></>}
  </section>;
}
