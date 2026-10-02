export const fieldLabels:Record<string,string> = {revenue:"매출",operating_income:"영업이익",guidance:"가이던스",capex:"설비투자",dividend:"배당",management_change:"경영진",risk_change:"위험 요인"};
export const typeLabels:Record<string,string> = {earnings:"실적",guidance:"전망 변경",capex:"설비투자",dividend:"배당",management:"경영진",risk:"위험 요인",other:"공시"};
export const changeLabels:Record<string,string> = {numeric_change:"수치 변경",increased:"증가",decreased:"감소",incomparable_context:"동일 기준 비교 불가",wording_changed:"표현 변경",insufficient_history:"비교 이력 부족",incomparable:"동일 기준 비교 불가",unchanged:"변경 없음"};
export function dateText(value:string, precision="timestamp"):string {
  const d=new Date(value);if(Number.isNaN(d.getTime())) return "날짜 미상";
  return new Intl.DateTimeFormat("ko-KR",{timeZone:"Asia/Seoul",year:"numeric",month:"short",day:"numeric",...(precision==="date" ? {} : {hour:"2-digit",minute:"2-digit"})}).format(d);
}
export function pct(value:string|null):string {if(value===null) return "비교 불가";const n=Number(value);return Number.isFinite(n) ? `${n>0?"+":""}${n.toLocaleString("ko-KR",{maximumFractionDigits:2})}%` : "비교 불가";}
export function score(value:number):string {return `${Math.round(value*100)}`;}
export function display(value:unknown):string {return value==null ? "미측정" : typeof value==="object" ? JSON.stringify(value,null,2) : String(value);}
