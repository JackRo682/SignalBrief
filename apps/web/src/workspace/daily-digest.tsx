'use client';
import {useEffect,useState} from 'react';
import {z} from 'zod';
import {useAuth} from '@/components/auth';
import {initializeSupabase} from '@/lib/supabase';
import {usePrefs} from './preferences';

export const digestSettingsSchema=z.object({available:z.boolean(),enabled:z.boolean(),time:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)});
export default function DailyDigestSettings(){
 const {token}=useAuth(),{text:t,value}=usePrefs();
 const [settings,setSettings]=useState<z.infer<typeof digestSettingsSchema>|null>(null),[time,setTime]=useState('09:00'),[busy,setBusy]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState(false),[version,setVersion]=useState(0);
 useEffect(()=>{
  let live=true;setSettings(null);setError('');
  if(token)void initializeSupabase().then(db=>db.rpc('sb_digest_preferences',{p:{}})).then(({data,error})=>{if(error)throw error;const parsed=digestSettingsSchema.parse(data);if(live){setSettings(parsed);setTime(parsed.time);}}).catch(()=>{if(live)setError(t('일일 요약 설정을 불러오지 못했습니다.','Could not load daily digest preferences.'));});
  return()=>{live=false;};
 },[token,t,version]);
 async function save(p:{enabled?:boolean;time?:string}){
  setBusy(true);setError('');setSaved(false);
  try{const db=await initializeSupabase(),{data,error}=await db.rpc('sb_digest_preferences',{p});if(error)throw error;const parsed=digestSettingsSchema.parse(data);setSettings(parsed);setTime(parsed.time);setSaved(true);}
  catch{setError(t('일일 요약 설정을 저장하지 못했습니다. 다시 시도해 주세요.','Could not save daily digest preferences. Please retry.'));}
  finally{setBusy(false);}
 }
 return <div><p>{t('전날의 검토된 앱 알림을 이메일로 보냅니다. 새 알림이 없으면 발송하지 않습니다.','Email a summary of the previous day’s reviewed app alerts. No email is sent on empty days.')}</p><label><input type="checkbox" role="switch" aria-label={t('일일 요약 이메일','Daily digest email')} checked={settings?.enabled??false} disabled={!settings?.available||busy} onChange={e=>void save({enabled:e.target.checked})}/>{t('일일 요약 받기','Receive a daily digest')}</label><label style={{display:'block',marginTop:8}}>{t('발송 시각','Delivery time')} ({value.timezone}) <input aria-label={t('일일 요약 발송 시각','Daily digest delivery time')} type="time" value={time} disabled={!settings?.available||busy} onChange={e=>{setTime(e.target.value);setSaved(false);}}/></label><button type="button" disabled={!settings?.available||busy||time===settings.time||!time} onClick={()=>void save({time})}>{t('발송 시각 저장','Save delivery time')}</button><small style={{display:'block'}}>{t('방해금지 시간에는 대기하며, 종료 후 약 5분 이내 발송합니다. 최대 50건을 포함합니다.','Waits during quiet hours, then sends within about 5 minutes. Includes up to 50 items.')}</small>{error&&<p role="alert">{error} <button type="button" onClick={()=>setVersion(n=>n+1)}>{t('다시 불러오기','Reload')}</button></p>}{saved&&<p role="status">{t('일일 요약 설정을 저장했습니다.','Daily digest preferences saved.')}</p>}</div>;
}
