'use client';

import Image from 'next/image';
import Link from 'next/link';
import {useEffect, useRef, type ReactNode} from 'react';
import {Icon, type IconName} from '@/components/icons';
import {usePrefs} from '@/workspace/preferences';
import {chartPoints} from '@/workspace/contracts';
import {type EventCard} from '@/lib/contracts';
import {vectorBrands} from './brand-paths';

const extraIcons: Record<string, string> = {
  sun: 'M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10M12 1v3M12 20v3M1 12h3M20 12h3M4 4l2 2M18 18l2 2M4 20l2-2M18 6l2-2',
  font: 'M2 5h14M9 5v15M17 10h6M20 10v10',
  motion: 'M14 3a2 2 0 1 0 0 4 2 2 0 0 0 0-4M4 10l6-2 4 3 5 1M11 8l-3 7 5 2-3 5M8 15l-5 6',
  book: 'M12 5C8 2 3 3 3 3v16s5-1 9 2c4-3 9-2 9-2V3s-5-1-9 2ZM12 5v16',
  headset: 'M4 14v-2a8 8 0 0 1 16 0v2M3 13h4v7H3ZM17 13h4v7h-4ZM19 20c0 2-4 2-7 2',
  wrench: 'M14 4a6 6 0 0 0-7 8L2 18a3 3 0 0 0 4 4l6-6a6 6 0 0 0 8-7l-4 4-4-4Z',
  person: 'M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8M4 21v-2a8 8 0 0 1 16 0v2Z',
  back: 'm14 5-7 7 7 7', chevron: 'm9 5 7 7-7 7',
  filter: 'M4 6h16M7 12h10M10 18h4M7 3v6M16 9v6M12 15v6',
  trash: 'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7',
  bookmark: 'M5 3h14v18l-7-4-7 4Z',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7ZM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6',
  info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M12 11v6M12 7v.1',
  globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M3 12h18M12 3c-5 5-5 13 0 18M12 3c5 5 5 13 0 18',
  chip: 'M6 6h12v12H6ZM9 9h6v6H9ZM9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4',
  trend: 'm3 17 6-6 4 4 8-10M15 5h6v6',
  lightbulb: 'M8 17h8M9 21h6M8 15c0-3-3-3-3-7a7 7 0 0 1 14 0c0 4-3 4-3 7',
  lock: 'M6 10h12v11H6ZM8 10V6a4 4 0 0 1 8 0v4M12 14v3',
  monitor: 'M3 4h18v13H3ZM12 17v4M8 21h8',
  help: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M9 9a3 3 0 1 1 5 2c-2 1-2 2-2 3M12 17v.1',
  coins: 'M3 7c0-2 12-2 12 0s-12 2-12 0ZM3 7v5c0 2 12 2 12 0V7M3 12v5c0 2 12 2 12 0v-5M18 9c5 0 5 4 0 4M18 13c5 0 5 4 0 4M18 17c5 0 5 4 0 4',
  mail: 'M3 5h18v14H3ZM3 5l9 8 9-8',
  car: 'm5 7 2-4h10l2 4 2 3v8H3v-8ZM3 11h18M6 14h2M16 14h2M5 18v3M19 18v3',
  bank: 'm2 7 10-5 10 5ZM4 10v9M9 10v9M15 10v9M20 10v9M2 22h20',
  dna: 'M6 2c0 9 12 11 12 20M18 2C18 11 6 13 6 22M7 5h10M9 9h6M9 15h6M7 19h10',
  more: 'M5 12h.1M12 12h.1M19 12h.1',
  external: 'M13 3h8v8M21 3l-11 11M9 5H3v16h16v-6',
  refresh: 'M20 8A8 8 0 0 0 6 5L3 8M3 3v5h5M4 16a8 8 0 0 0 14 3l3-3M21 21v-5h-5',
};
const builtin = new Set<string>(['home','star','pie','timeline','calendar','bell','settings','search','shield','file','spark','arrow','menu','close','logout','check','plus','download','upload','clock']);
export function MIcon({name, size = 20, className = ''}: {name: IconName | string; size?: number; className?: string}) {
  return <span className={`m-icon ${className}`} aria-hidden="true">{builtin.has(name) ? <Icon name={name as IconName} size={size}/> : <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d={extraIcons[name] ?? extraIcons.info}/></svg>}</span>;
}

const logoTickers = new Set(['NVDA','AAPL','TSLA','005930','000660','005380','005490','035420','035720','373220']);
export function CompanyLogo({ticker, size = 48}: {ticker: string; size?: number}) {
  return <span className={`m-company-logo m-logo-${ticker.replace(/[^a-zA-Z0-9]/g,'')}`} style={{width:size,height:size}} aria-hidden="true">{vectorBrands[ticker] ? <svg viewBox="0 0 24 24" fill={vectorBrands[ticker].color}><path d={vectorBrands[ticker].path}/></svg> : logoTickers.has(ticker) ? <Image src={`/reference-assets/logos/${ticker}.webp`} alt="" width={size} height={size}/> : ticker === 'MSFT' ? <span className="m-microsoft-logo"><i/><i/><i/><i/></span> : <b>{ticker.slice(0,4)}</b>}</span>;
}

export function SectionTitle({title, href, action, className = ''}: {title: string; href?: string; action?: ReactNode; className?: string}) {
  const {text:t}=usePrefs();
  return <div className={`m-section-title ${className}`}><h2>{title}</h2>{action ?? (href && <Link href={href}>{t('전체 보기','View all')}<MIcon name="chevron" size={15}/></Link>)}</div>;
}
export function EmptyState({title, description, href, label}: {title: string; description?: string; href?: string; label?: string}) {
  const {text:t}=usePrefs();
  return <div className="m-empty"><span className="m-empty-icon"><MIcon name="file" size={25}/></span><strong>{title}</strong>{description && <p>{description}</p>}{href && <Link href={href} className="m-button m-button-secondary">{label ?? t('자세히 보기','View details')}<MIcon name="chevron" size={15}/></Link>}</div>;
}
export function LoadState({loading,error,retry}: {loading: boolean; error?: string | null; retry?: () => void}) {
  const {text:t}=usePrefs();
  return <>{loading && <div className="m-loading" role="status" aria-label={t('불러오는 중','Loading')}><i/><i/><i/></div>}{error && <div className="m-notice m-error" role="alert"><p>{error}</p>{retry && <button type="button" className="m-button m-button-secondary" onClick={retry}>{t('다시 시도','Retry')}</button>}</div>}</>;
}
export function ActionNotice({action}: {action: {error: string | null; success?: string; message?: string | null}}) {
  return <>{action.error && <div className="m-notice m-error" role="alert">{action.error}</div>}{(action.success || action.message) && <div className="m-notice m-success" role="status">{action.success || action.message}</div>}</>;
}
export function SmallChart({values}: {values: number[]}) {
  const {text:t}=usePrefs(), points=chartPoints(values);
  return points ? <svg className="m-sparkline" viewBox="0 0 200 68" role="img" aria-label={t('실제 종가 추이','Actual closing-price history')}><polyline points={points} stroke="currentColor" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round" fill="none"/></svg> : <span className="m-chart-missing" aria-label={t('가격 추이 자료 없음','Price history unavailable')}>—</span>;
}
export function formatMoney(value: number | null | undefined, currency = 'USD', locale = 'ko-KR') {
  if (value == null || !Number.isFinite(value)) return '—';
  try { return new Intl.NumberFormat(locale,{style:'currency',currency,maximumFractionDigits:currency==='KRW'?0:2}).format(value); }
  catch { return `${new Intl.NumberFormat(locale,{maximumFractionDigits:2}).format(value)} ${currency}`; }
}
export function relativeTime(iso: string, locale = 'ko') {
  const timestamp=Date.parse(iso);
  if (!Number.isFinite(timestamp)) return locale==='ko'?'날짜 확인 전':'Date unavailable';
  const seconds=(timestamp-Date.now())/1000;
  const units: [Intl.RelativeTimeFormatUnit,number][]=[['year',31536000],['month',2592000],['day',86400],['hour',3600],['minute',60]];
  const [unit,divisor]=units.find(([,n])=>Math.abs(seconds)>=n)??['second',1];
  return new Intl.RelativeTimeFormat(locale,{numeric:'auto'}).format(Math.trunc(seconds/divisor),unit);
}
export function Dialog({title,onClose,children}: {title: string; onClose: () => void; children: ReactNode}) {
  const dialog=useRef<HTMLDialogElement>(null), {text:t}=usePrefs();
  useEffect(()=>{const element=dialog.current;if(element&&!element.open)element.showModal();},[]);
  return <dialog ref={dialog} className="m-dialog" aria-label={title} onCancel={e=>{e.preventDefault();onClose();}} onClose={onClose} onClick={e=>{if(e.target===e.currentTarget){const r=e.currentTarget.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)onClose();}}}><header><h2>{title}</h2><button type="button" className="m-icon-button" onClick={onClose} aria-label={t('닫기','Close')}><MIcon name="close"/></button></header>{children}</dialog>;
}
export function DateNote({message}: {message?: ReactNode}) {
  const {value}=usePrefs();
  return <aside className="m-date-note"><time dateTime={new Date().toISOString()}>{new Intl.DateTimeFormat(value.locale==='ko'?'ko-KR':'en-US',{timeZone:value.timezone,month:'long',day:'numeric',weekday:'short'}).format(new Date())}</time>{message && <p>{message}</p>}</aside>;
}
const categoryLabels: Record<string,[string,string]>={earnings:['실적','Earnings'],guidance:['전망','Guidance'],contract:['계약','Contract'],business:['사업','Business'],regulatory:['공시','Filing'],capital:['자본','Capital'],risk:['위험','Risk'],product:['제품/기술','Product / technology'],supply:['생산/공급','Production / supply'],capex:['투자/설비','Investment / facilities'],policy:['정책','Policy'],regulation:['규제','Regulation'],management:['경영','Management'],dividend:['배당','Dividend'],buyback:['자사주','Buyback'],other:['공시','Filing']};
export function eventLabel(type:string, locale='ko') {const labels=categoryLabels[type];return labels?labels[locale==='ko'?0:1]:type;}
export function MobileEventCard({event}: {event: EventCard}) {
  const {text:t,value,date}=usePrefs();
  return <article className="m-card m-event-card"><Link className="m-event-logo" href={`/companies/${event.company.id}`} aria-label={`${event.company.name} ${t('기업 개요','Company overview')}`}><CompanyLogo ticker={event.company.ticker} size={54}/></Link><div className="m-event-content"><div className="m-event-company"><Link href={`/companies/${event.company.id}`}>{event.company.name}</Link><span>{event.company.ticker}</span></div><Link href={`/events/${event.id}`} className="m-event-title">{event.headline}</Link><p>{event.fact_summary||event.what_happened}</p></div><div className="m-event-side"><span className={`m-pill m-type-${event.event_type}`}>{eventLabel(event.event_type,value.locale)}</span><time dateTime={event.published_at}>{['date','date_only'].includes(event.publication_precision)?date(event.published_at,'date'):relativeTime(event.published_at,value.locale)}</time><Link href={`/events/${event.id}`}>{t('자세히 보기','Details')}<MIcon name="chevron" size={14}/></Link></div></article>;
}
