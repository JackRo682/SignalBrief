'use client';
import Link from 'next/link';
import Image from 'next/image';
import {useEffect,useRef,type ReactNode} from 'react';
import {Icon,type IconName} from '@/components/icons';
import {usePrefs} from '@/workspace/preferences';
import {chartPoints} from '@/workspace/contracts';
import {vectorBrands} from '@/mobile/brand-paths';
import './desktop.css';

export function PcPanel({title,icon,action,children,className=''}:{title?:string;icon?:IconName;action?:ReactNode;children:ReactNode;className?:string}){
 return <section className={`pc-card ${className}`}>{title&&<header className="pc-panel-head"><h2>{icon&&<Icon name={icon}/>}<span>{title}</span></h2>{action}</header>}{children}</section>;
}
export function PcHeading({title,description,eyebrow,action}:{title:string;description?:string;eyebrow?:string;action?:ReactNode}){
 return <header className="pc-heading"><div>{eyebrow&&<p className="pc-eyebrow">{eyebrow}</p>}<h1>{title}</h1>{description&&<p className="pc-heading-description">{description}</p>}</div>{action&&<div className="pc-heading-action">{action}</div>}</header>;
}
const assetLogos=new Set(['005930','000660','005380','005490','035420','035720','373220']);
export function PcLogo({ticker,size=44}:{ticker:string;size?:number}){
 const symbol=ticker.toUpperCase(),brand=vectorBrands[symbol];
 return <span className={`pc-logo pc-logo-${symbol}`} style={{width:size,height:size}} aria-hidden="true">{brand?<svg width={size*.72} height={size*.72} viewBox="0 0 24 24" fill={brand.color}><path d={brand.path}/></svg>:symbol==='MSFT'?<span className="pc-msft"><i/><i/><i/><i/></span>:assetLogos.has(symbol)?<Image src={`/reference-assets/logos/${symbol}.webp`} width={size} height={size} alt=""/>:<b style={{fontSize:Math.max(10,size*.28)}}>{symbol.slice(0,4)}</b>}</span>;
}
export function PcChart({values,label,className=''}:{values:number[];label?:string;className?:string}){
 const {text:t}=usePrefs(),points=chartPoints(values);
 return points?<svg className={`pc-chart ${className}`} viewBox="0 0 200 68" role="img" aria-label={label??t('공급자 종가 추이','Provider closing-price history')}><polyline fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" points={points}/></svg>:<span className={`pc-chart-empty ${className}`}>{t('추이 미제공','History unavailable')}</span>;
}
export function PcEmpty({title,description,href,label}:{title:string;description?:string;href?:string;label?:string}){
 return <div className="pc-empty"><Icon name="file" size={27}/><strong>{title}</strong>{description&&<p>{description}</p>}{href&&<Link href={href} className="pc-button">{label??title}<Icon name="arrow" size={16}/></Link>}</div>;
}
export function PcDataState({loading,error,retry}:{loading:boolean;error?:string|null;retry?:()=>void}){
 const {text:t}=usePrefs();return <>{loading&&<div className="pc-loading" role="status"><span/>{t('불러오는 중…','Loading…')}</div>}{error&&<div className="pc-notice pc-error" role="alert"><span>{error}</span>{retry&&<button className="pc-button" onClick={retry}>{t('다시 시도','Retry')}</button>}</div>}</>;
}
export function PcNotice({action}:{action:{error?:string|null;success?:string|null}}){return <>{action.error&&<div role="alert" className="pc-notice pc-error">{action.error}</div>}{action.success&&<div role="status" className="pc-notice pc-success">{action.success}</div>}</>;}
export function PcModal({title,onClose,children}:{title:string;onClose:()=>void;children:ReactNode}){
 const ref=useRef<HTMLDialogElement>(null),{text:t}=usePrefs();
 useEffect(()=>{const dialog=ref.current;if(dialog&&!dialog.open)dialog.showModal();},[]);
 return <dialog ref={ref} className="pc-modal" aria-label={title} onCancel={e=>{e.preventDefault();onClose();}} onClose={onClose} onClick={e=>{if(e.target===e.currentTarget){const b=e.currentTarget.getBoundingClientRect();if(e.clientX<b.left||e.clientX>b.right||e.clientY<b.top||e.clientY>b.bottom)onClose();}}}><header><h2>{title}</h2><button type="button" className="pc-icon-button" onClick={onClose} aria-label={t('닫기','Close')}><Icon name="close"/></button></header>{children}</dialog>;
}
