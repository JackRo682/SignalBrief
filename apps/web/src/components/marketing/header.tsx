'use client';

import Link from 'next/link';
import {useEffect,useRef,useState} from 'react';
import {useAuth} from '@/components/auth';
import {Icon} from '@/components/icons';
import {marketingNav,type MarketingRoute} from '@/lib/marketing';

export default function MarketingHeader({current}:{current:MarketingRoute}) {
 const {me}=useAuth();
 const [open,setOpen]=useState(false);
 const toggle=useRef<HTMLButtonElement>(null);
 useEffect(()=>{
  if(!open)return;
  document.querySelector<HTMLAnchorElement>('#public-navigation a')?.focus();
  const close=(event:KeyboardEvent)=>{if(event.key==='Escape'){setOpen(false);toggle.current?.focus();}};
  document.addEventListener('keydown',close);
  return()=>document.removeEventListener('keydown',close);
 },[open]);
 const close=()=>setOpen(false);
 return <header className="public-info-header"><div className="public-info-container">
  <Link href="/" className="public-info-brand" aria-label="SignalBrief 홈" onClick={close}><span className="public-info-mark" aria-hidden="true"/>SignalBrief</Link>
  <nav id="public-navigation" className={'info-nav public-info-nav landNav'+(open?' is-open':'')} aria-label="서비스 안내">
   {marketingNav.filter(item=>item.href!=='/privacy').map(item=><Link key={item.href} href={item.href} onClick={close} aria-current={current===item.href?'page':undefined}>{item.label}<Icon name="arrow" size={16}/></Link>)}
  </nav>
  <div className="public-info-header-actions landActions">{me?<Link href={me.onboarding_completed?'/today':'/onboarding'} className="public-info-button primary">내 브리핑 열기 <Icon name="arrow" size={16}/></Link>:<><Link href="/login" className="public-info-button secondary">로그인</Link><Link href="/signup" className="public-info-button primary">무료로 시작하기</Link></>}
   <button ref={toggle} type="button" className="public-info-menu-toggle" aria-label={open?'서비스 메뉴 닫기':'서비스 메뉴 열기'} aria-expanded={open} aria-controls="public-navigation" onClick={()=>setOpen(value=>!value)}><Icon name={open?'close':'menu'}/></button>
  </div>
 </div></header>;
}
