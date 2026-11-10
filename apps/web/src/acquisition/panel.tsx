"use client";
import {useEffect,useState} from 'react';
import {useAuth} from '@/components/auth';
import {trafficSummary,type TrafficSummary} from './contracts';
import './traffic.css';
const labels:Record<string,string>={direct:'직접·내부 이동',google:'Google',naver:'네이버',disquiet:'디스콰이엇',geeknews:'GeekNews',youtube:'YouTube',x:'X / Twitter',other:'기타'};
export default function AcquisitionPanel({from,to,revision=0}:{from:string;to:string;revision?:number}){
 const {token,me}=useAuth(),[attempt,setAttempt]=useState(0);
 const key=JSON.stringify([from,to,revision,attempt,me?.id]);
 const [result,setResult]=useState<{key:string;data?:TrafficSummary;error?:string}>({key:''});
 useEffect(()=>{if(!token||!me?.is_admin)return;const controller=new AbortController();
  void fetch('/api/traffic',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify({action:'summary',from,to}),signal:AbortSignal.any([controller.signal,AbortSignal.timeout(12000)])})
   .then(async response=>{if(!response.ok)throw new Error(response.status===403?'관리자 권한 또는 추가 인증을 확인해 주세요.':'방문 통계를 불러오지 못했습니다.');return trafficSummary.parse(await response.json());})
   .then(data=>{if(!controller.signal.aborted)setResult({key,data});}).catch(error=>{if(!controller.signal.aborted)setResult({key,error:error instanceof Error?error.message:'방문 통계 조회 실패'});});
  return()=>controller.abort();
 },[from,to,key,token,me?.is_admin]);
 if(!token||!me?.is_admin)return null;
 const data=result.key===key?result.data:undefined,error=result.key===key?result.error:undefined;
 return <section className="traffic-panel overview-section" aria-labelledby="traffic-title"><h2 id="traffic-title">외부 유입 · 회원가입</h2><p>선택적 방문 통계에 동의한 브라우저만 집계합니다. 로그인 후 활동 통계와는 별도입니다.</p>
 {!data&&!error&&<p role="status">방문 통계를 불러오는 중입니다.</p>}{error&&<div role="alert"><p>{error}</p><button className="button secondary" onClick={()=>setAttempt(v=>v+1)}>다시 조회</button></div>}
 {data&&<><div className="traffic-metrics">{[['방문 브라우저',data.totals.visitors],['공개 페이지 조회',data.totals.pageviews],['가입·Google 시작',data.totals.starts],['이메일 가입 요청',data.totals.requests],['인증된 신규 가입',data.totals.signups],['초기 설정 완료',data.totals.onboarded]].map(([label,value])=><div key={label}><span>{label}</span><strong>{Number(value).toLocaleString('ko-KR')}</strong></div>)}</div>
 <p><strong>방문 → 신규 가입 전환율: {data.totals.visitors?(100*data.totals.signups/data.totals.visitors).toFixed(1)+'%':'측정 대기'}</strong></p>
 <p className="overview-note">기간 내 인증된 신규 가입 브라우저 ÷ 기간 내 방문 브라우저입니다. 이메일 인증 전 요청, 기존 계정의 로그인, 인증된 관리자 활동은 가입 완료에서 제외합니다. 최초 가입 시작 후 7일 이내 생성된 계정만 연결하며, 브라우저·기기를 바꾸거나 동의하지 않으면 연결되지 않을 수 있습니다.</p>
 {data.totals.visitors===0&&<p role="status">아직 이 기간에 수집된 방문 기록이 없습니다. 설치 이전 기록은 복원하지 않습니다.</p>}
 <div className="traffic-tables"><div><h3>일간 방문 · 한국 시간</h3><table><thead><tr><th>날짜</th><th>브라우저</th><th>페이지 조회</th><th>신규 가입</th></tr></thead><tbody>{data.daily.map(row=><tr key={row.day}><td>{row.day}</td><td>{row.visitors}</td><td>{row.pageviews}</td><td>{row.signups}</td></tr>)}</tbody></table></div><div><h3>최초 유입 경로</h3><table><thead><tr><th>경로</th><th>브라우저</th><th>신규 가입</th><th>전환율</th></tr></thead><tbody>{data.sources.map(row=><tr key={row.source}><td>{labels[row.source]}</td><td>{row.visitors}</td><td>{row.signups}</td><td>{row.visitors?(100*row.signups/row.visitors).toFixed(1)+'%':'—'}</td></tr>)}</tbody></table></div></div>
 <p className="overview-note">사람 수가 아닌 브라우저 수이며, 날짜별 합계와 기간 내 중복 제거 수는 다릅니다. 미동의 방문·광고 차단·자동화·방문자의 자기 신고 이벤트로 오차가 생길 수 있습니다. 원문 URL이나 UTM 전체 값을 저장하지 않고 정해진 출처 분류만 기록합니다.</p></>}
 </section>;
}
