'use client';
import {useState} from 'react';
import {useAuth} from '@/components/auth';
import {useAction,ActionNotice} from '@/components/ui';
import {research} from './client';
import {Panel,Field} from './ui';
export default function EvaluationSetup({budget,reload}:{budget:unknown;reload:()=>void}){
 const {token}=useAuth(),action=useAction(),[usd,setUsd]=useState('1');
 return <Panel title="실제 공시 수집과 실행 예산"><ActionNotice action={action}/><div className="research-actions">{['AAPL','MSFT','NVDA'].map(symbol=><button key={symbol} className="button secondary" disabled={action.busy} onClick={()=>action.run(async()=>{const r=await fetch('/api/us/ingest',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify({symbol}),signal:AbortSignal.timeout(50000)});const d=await r.json();if(!r.ok)throw new Error(`SEC 수집을 완료하지 못했습니다 (${d?.error?.code??r.status}). 공급자 연결을 확인하세요.`);reload();},`${symbol} SEC 공시 목록을 갱신했습니다.`)}>{symbol} 공시 불러오기</button>)}</div><p className="research-micro">기존 SEC 수집 기능으로 공식 공시 목록을 가져옵니다. 임의의 공시나 정답을 생성하지 않습니다.</p><form className="research-filters" onSubmit={e=>{e.preventDefault();void action.run(async()=>{await research(token,'evaluation_budget',{usd:Number(usd)});reload();},'기존 AI 공급자 일일 예산을 변경했습니다.');}}><Field label={`AI 일일 예산 (현재 ${budget??'미확인'} USD)`}><input type="number" min={0} max={10} step="0.01" value={usd} onChange={e=>setUsd(e.target.value)} required/></Field><button className="button secondary" disabled={action.busy}>예산 저장</button></form><p className="research-micro">0이면 유료 실행이 차단됩니다. 기존 AI 분석과 공유하는 일일 한도이며 최대 10 USD로 설정할 수 있습니다. 평가 사례당 0.04 USD를 보수적으로 예약합니다. 예약 금액은 실제 청구 비용이 아닙니다.</p></Panel>;
}
