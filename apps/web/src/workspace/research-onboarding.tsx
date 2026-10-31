'use client';
import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {useEffect,useState} from 'react';
import {useAuth} from '@/components/auth';
import {useResource} from '@/components/ui';
import WorkspaceLoading from '@/components/workspace-loading';
import {companiesSchema,meSchema} from '@/lib/contracts';
import {workspace} from './client';
import {usePrefs} from './preferences';
import {DataState,Logo,Notice,useMutation} from './ui';
import './monitoring.css';

const completed=meSchema.extend({onboarding_completed:meSchema.shape.onboarding_completed.refine(value=>value===true)});
export default function ResearchOnboarding(){
  const auth=useAuth(),router=useRouter(),{text:t}=usePrefs(),action=useMutation();
  const [selected,setSelected]=useState<string[]>([]),[q,setQ]=useState('');
  const companies=useResource(auth.token?'/v1/companies?limit=100':null,companiesSchema);
  useEffect(()=>{if(!auth.loading&&!auth.token)router.replace('/login?next=%2Fonboarding');},[auth.loading,auth.token,router]);
  if(!auth.me)return <WorkspaceLoading error={auth.error}/>;
  async function complete(skip=false){await workspace(auth.token,{action:'onboarding_complete',p:{company_ids:skip?[]:selected,removed_company_ids:[],positions:[]}},completed);await auth.refresh();router.replace('/today');}
  const items=(companies.data??[]).filter(company=>`${company.name} ${company.ticker}`.toLowerCase().includes(q.toLowerCase()));
  return <main className="sb-monitoring" style={{maxWidth:880,margin:'32px auto',padding:24}}><Link href="/today"><strong>SignalBrief</strong></Link><header><div><h1>{t('관심 기업을 선택하세요.','Choose companies to follow.')}</h1><p>{t('공식 공시와 승인된 분석을 모아 보여드립니다. 나중에 추가하거나 변경할 수 있습니다.','Follow official disclosures and approved summaries. You can add or change companies later.')}</p></div></header>
    <Notice action={action}/><DataState loading={companies.loading} error={companies.error??''} retry={companies.reload}/>
    <label className="ws-field"><span>{t('기업 찾기','Find a company')}</span><input value={q} maxLength={100} onChange={event=>setQ(event.target.value)}/></label>
    <div className="sb-monitor-company-grid">{items.map(company=><button key={company.id} className="sb-monitor-card" aria-pressed={selected.includes(company.id)} disabled={action.busy||!selected.includes(company.id)&&selected.length>=10} style={{textAlign:'left',cursor:'pointer',outline:selected.includes(company.id)?'2px solid #2879eb':undefined}} onClick={()=>setSelected(current=>current.includes(company.id)?current.filter(id=>id!==company.id):[...current,company.id])}><Logo ticker={company.ticker}/><strong>{company.name}</strong><small>{company.ticker} · {company.market}</small><span>{selected.includes(company.id)?t('선택됨','Selected'):t('팔로우','Follow')}</span></button>)}</div>
    <p>{t(`${selected.length}/10개 선택 · 기업 정보와 수집된 자료 범위는 기업별로 다릅니다.`,`${selected.length}/10 selected · Collected-source coverage varies by company.`)}</p>
    <div className="sb-monitor-toolbar"><button className="sb-monitor-button primary" disabled={action.busy} onClick={()=>void action.run(()=>complete())}>{action.busy?t('저장 중…','Saving…'):t('시작하기','Open workspace')}</button><button className="sb-monitor-button" disabled={action.busy} onClick={()=>void action.run(()=>complete(true))}>{t('전체 기업 먼저 둘러보기','Browse all companies first')}</button></div>
  </main>;
}
