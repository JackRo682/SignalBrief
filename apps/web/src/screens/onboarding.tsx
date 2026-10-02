"use client";
import { useState,useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth";
import { useResource,useAction,ActionNotice,PageHeading,Loading,ErrorState,Empty } from "@/components/ui";
import { companiesSchema,meSchema,type Company } from "@/lib/contracts";
import { body,request } from "@/lib/api";
export default function Onboarding(){const auth=useAuth(),router=useRouter(),[search,setSearch]=useState(""),[selected,setSelected]=useState<Record<string,Company>>({}),[consent,setConsent]=useState(false),action=useAction();
  const catalog=useResource(`/v1/companies?q=${encodeURIComponent(search)}&limit=50`,companiesSchema);
  const track=auth.track; useEffect(()=>{track("onboarding_started");},[track]);
  return <><PageHeading eyebrow="GET STARTED · 01 / 01" title="어떤 기업의 변화를 볼까요?" description="관심 있는 기업을 3개 이상 선택하면 첫 브리핑을 준비합니다."/><section className="panel"><label className="field"><span>기업명 또는 종목코드 검색</span><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="기업명, 종목코드" maxLength={100}/></label><div className="selected-bar"><strong>{Object.keys(selected).length}개 선택</strong><div className="chips">{Object.values(selected).map(c=><button key={c.id} className="chip" onClick={()=>setSelected(old=>{const copy={...old};delete copy[c.id];return copy;})} aria-label={`${c.name} 선택 해제`}>{c.name} ×</button>)}</div></div>
  {catalog.loading?<Loading/>:catalog.error?<ErrorState message={catalog.error} retry={catalog.reload}/>:!catalog.data?.length?<Empty title="기업 목록이 비어 있습니다."><p>검색어를 바꾸거나 운영자에게 공식 기업 목록 동기화를 요청하세요.</p></Empty>:<div className="company-grid">{catalog.data.map(company=><label className={`company-choice ${selected[company.id]?"selected":""}`} key={company.id}><input type="checkbox" checked={Boolean(selected[company.id])} onChange={e=>setSelected(old=>{const copy={...old};if(e.target.checked)copy[company.id]=company;else delete copy[company.id];return copy;})} disabled={!selected[company.id]&&Object.keys(selected).length>=20}/><span><strong>{company.name}</strong><small>{company.ticker} · {company.market}{company.is_demo?" · 합성 기업":""}</small></span></label>)}</div>}
  <label className="checkbox-line"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/>서비스 개선을 위한 선택적 이용 통계 수집에 동의합니다. 동의하지 않아도 사용 가능합니다.</label><ActionNotice action={action}/><button className="button primary" disabled={Object.keys(selected).length<3||action.busy} onClick={()=>action.run(async()=>{await request("/v1/onboarding",auth.token,meSchema,body("POST",{company_ids:Object.keys(selected),analytics_consent:consent}));await auth.refresh();router.replace("/today");})}>{action.busy?"저장 중…":"선택한 기업으로 시작하기 →"}</button></section></>;
}
