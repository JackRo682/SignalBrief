'use client';
import {useState} from 'react';
import {usePrefs} from '@/workspace/preferences';
type Row=Record<string,unknown>;
export function FilingAnalysis({value,admin,busy,onReview,approvedOnly=false}:{value:Row;admin:boolean;busy:boolean;onReview:(status:'approved'|'rejected',reason:string)=>Promise<void>;approvedOnly?:boolean}){
 const [reason,setReason]=useState(''),[confirmed,setConfirmed]=useState(false);
 const {text:t}=usePrefs();
 if(approvedOnly&&value.status!=='approved')return null;
 const result=value.result&&typeof value.result==='object'?value.result as Row:null;
 const claims=Array.isArray(result?.claims)?result.claims as Row[]:[];
 if(!claims.length)return approvedOnly?<section className="panel"><p>{t('게시할 수 있는 인용 요약이 없습니다. 공식 원문을 확인하세요.','No publishable excerpt summary is available. Read the official source.')}</p></section>:<section className="panel"><h2>조회 결과</h2><pre>{JSON.stringify(value,null,2)}</pre></section>;
 const valid=result?.validation==='quote_substring_and_numeric_check';
 return <section className="panel" aria-label={approvedOnly?t('승인된 공시 요약','Approved disclosure summary'):'공시 분석 검토'}><h2>{approvedOnly?t('승인된 원문 발췌 요약','Approved source excerpt summary'):<>공시 분석 · {value.status==='approved'?'공개됨':value.status==='rejected'?'반려됨':'검토 대기'}</>}</h2>
 <p className="small muted">{t('분석 범위는 보관된 원문의 일부입니다. 인용과 수치 검사를 통과해도 해석과 조건은 원문과 대조해야 합니다.','This summary covers only part of the stored source document. Check interpretations and conditions against the original, even when quotation and numeric checks have passed.')}</p>
 {Number(result?.omitted_claim_count)>0&&<p role="status">{t(`수치 근거를 확인하지 못한 후보 ${Number(result?.omitted_claim_count)}개를 제외했습니다. 아래에는 검증을 통과한 주장만 표시합니다.`,`${Number(result?.omitted_claim_count)} candidate claims were omitted because numerical support could not be verified. Only validated claims are shown below.`)}</p>}
 {claims.map((claim,index)=><article key={index} className="list-row"><div><p>{String(claim.text??'')}</p><blockquote>{String(claim.quote??'')}</blockquote></div></article>)}
 <p>{String(result?.uncertainty??'')}</p>
 {typeof result?.source_url==='string'&&/^https:\/\/(www\.sec\.gov|dart\.fss\.or\.kr)\//.test(result.source_url)&&<a href={result.source_url} className="source-link" target="_blank" rel="noopener noreferrer">{t('공식 원문 열기','Open official source')} ↗</a>}
 {admin&&!approvedOnly&&value.status==='needs_review'&&<div><label className="field"><span>검토 사유</span><textarea value={reason} onChange={e=>setReason(e.target.value)} maxLength={500}/></label>
 <label><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/> 원문의 수치, 기간, 단위와 조건을 직접 대조했습니다.</label>
 <div className="button-row"><button className="button primary" disabled={busy||!valid||!confirmed||reason.trim().length<5} onClick={()=>void onReview('approved',reason.trim())}>검토 완료 · 공개</button><button className="button secondary" disabled={busy||reason.trim().length<5} onClick={()=>void onReview('rejected',reason.trim())}>반려</button></div></div>}
 {admin&&!approvedOnly&&<details><summary>처리 기록 확인</summary><pre>{JSON.stringify({filing_id:value.filing_id,status:value.status,model:value.model,source_sha256:value.source_sha256,created_at:value.created_at,validation:result?.validation,citation_method:result?.citation_method},null,2)}</pre></details>}
 </section>;
}
