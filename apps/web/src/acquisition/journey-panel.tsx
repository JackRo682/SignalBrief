import type {TrafficSummary} from './contracts';
const sources:Record<string,string>={kakao:'카카오',direct:'직접·내부',google:'Google',naver:'네이버',youtube:'YouTube',disquiet:'디스콰이엇',geeknews:'GeekNews',x:'X',other:'기타'};
const steps:Record<string,string>={view:'화면 도착',features_cta:'기능 보기 선택',pricing_cta:'요금 보기 선택',signup_cta:'가입 선택',login_cta:'로그인 선택',signup_submit:'이메일 가입 시도',login_submit:'이메일 로그인 시도',google_start:'Google 인증 시도'};
const pages:Record<string,string>={home:'홈',features:'기능',pricing:'요금',login:'로그인',signup:'가입',about:'소개',sources:'출처',customers:'이용 대상',privacy:'개인정보',terms:'약관',disclaimer:'고지'};
function rate(n:number,d:number){return d?(100*n/d).toFixed(1)+'%':'—';}
export default function JourneyPanel({data}:{data:TrafficSummary}){
 if(!data.journeys)return null;
 return <section className="traffic-product-funnel"><h3>로그인 전 방문 경로</h3>
 <p>선택한 기간에 새로 시작한 동의 세션을 최초 유입별로 비교합니다. 같은 탭에서 측정된 화면 이동·버튼 선택 사이에 30분 이상 공백이 있으면 새 세션입니다.</p>
 {!data.journeys.length?<p>아직 측정된 로그인 전 세션이 없습니다.</p>:<div className="traffic-tables"><div><table><thead><tr>{['최초 유입','시작 세션','가입·로그인 선택','선택한 화면 도착','같은 화면에서 인증 시도','진입→시도','인증 화면 직접 진입','완료 관찰 세션','인증 시도 없이 종료'].map(t=><th key={t}>{t}</th>)}</tr></thead><tbody>{data.journeys.map(r=><tr key={r.source}><td>{sources[r.source]}</td><td>{r.sessions}</td><td>{r.auth_cta}</td><td>{r.auth_arrived}</td><td>{r.auth_attempt}</td><td>{rate(r.auth_attempt,r.sessions)}</td><td>{r.direct_auth_entries}</td><td>{r.closed}</td><td>{r.closed_without_attempt} ({rate(r.closed_without_attempt,r.closed)})</td></tr>)}</tbody></table></div></div>}
 <p>전환 단계는 같은 세션에서 발생한 순서대로 셉니다. 인증 시도는 성공 여부와 별도로 측정합니다. 종료 비율의 분모는 마지막 수신 후 30분이 지난 세션입니다. 마지막 관측 행동은 브라우저 종료 사실을 보장하지 않습니다.</p>
 {!!data.journey_exits?.length&&<><h4>인증 시도 없이 종료한 세션의 마지막 관측 행동</h4><div className="traffic-tables"><div><table><thead><tr>{['최초 유입','마지막 화면','마지막 행동','세션'].map(t=><th key={t}>{t}</th>)}</tr></thead><tbody>{data.journey_exits.map(r=><tr key={[r.source,r.page,r.step].join('/')}><td>{sources[r.source]}</td><td>{pages[r.page]}</td><td>{steps[r.step]}</td><td>{r.sessions}</td></tr>)}</tbody></table></div></div></>}
 {!!data.journey_actions?.length&&<><h4>로그인 전 화면별 행동</h4><div className="traffic-tables"><div><table><thead><tr>{['최초 유입','화면','행동','횟수','세션'].map(t=><th key={t}>{t}</th>)}</tr></thead><tbody>{data.journey_actions.map(r=><tr key={[r.source,r.page,r.step].join('/')}><td>{sources[r.source]}</td><td>{pages[r.page]}</td><td>{steps[r.step]}</td><td>{r.events}</td><td>{r.sessions}</td></tr>)}</tbody></table></div></div></>}
 </section>;
}
