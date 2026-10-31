'use client';
import {useState} from 'react';
import {useRouter} from 'next/navigation';
import {useAuth} from '@/components/auth';
import {companiesSchema,meSchema} from '@/lib/contracts';
import {usePcResource} from '@/desktop/data';
import {workspace} from '@/workspace/client';
import {useMutation} from '@/workspace/ui';
import {usePrefs} from '@/workspace/preferences';
import './mvp.css';
export default function ResearchOnboarding(){
 const auth=useAuth(),router=useRouter(),{text:t}=usePrefs(),action=useMutation(),catalog=usePcResource('/v1/companies?limit=50',companiesSchema),[ids,setIds]=useState<string[]>([]);
 async function finish(skip=false){await action.run(async()=>{await workspace(auth.token,{action:'onboarding_complete',p:{company_ids:skip?[]:ids,removed_company_ids:[],positions:[]}},meSchema);await auth.refresh();router.replace('/today');});}
 return <div className="research-mvp mv-onboarding"><header className="mv-heading"><div><span className="mv-eyebrow">WELCOME TO SIGNALBRIEF</span><h1>{t('관심 기업부터 선택하세요.','Start with the companies you follow.')}</h1><p>{t('최대 10개 기업을 선택하세요. 나중에 모니터링 화면에서 변경할 수 있습니다.','Select up to 10 companies. Update them later in Monitoring.')}</p></div></header>{catalog.loading&&<p role="status">{t('기업을 불러오는 중…','Loading companies…')}</p>}{catalog.error&&<p role="alert">{catalog.error}<button onClick={catalog.reload}>{t('다시 시도','Retry')}</button></p>}<div className="mv-company-grid">{catalog.data?.map(c=><label key={c.id} className="mv-company-card"><input type="checkbox" checked={ids.includes(c.id)} disabled={!ids.includes(c.id)&&ids.length>=10} onChange={e=>setIds(old=>e.target.checked?[...old,c.id]:old.filter(id=>id!==c.id))}/> <strong>{c.name}</strong><p>{c.ticker} · {c.market}</p></label>)}</div>{action.error&&<p role="alert">{action.error}</p>}<div className="mv-hero-links" style={{marginTop:24}}><button className="mv-button" disabled={action.busy||!catalog.data} onClick={()=>void finish()}>{t('리서치 시작하기','Open research workspace')} →</button><button disabled={action.busy} onClick={()=>void finish(true)}>{t('나중에 선택','Choose later')}</button></div></div>;
}
