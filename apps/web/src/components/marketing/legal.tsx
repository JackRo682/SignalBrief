'use client';
import Link from 'next/link';
import {useEffect,useState,type ReactNode} from 'react';
import {Icon} from '@/components/icons';
export type LegalItem={id:string;title:string};
export function LegalToc({items}:{items:readonly LegalItem[]}){
 const [active,setActive]=useState(items[0]?.id??'');
 useEffect(()=>{
  const openHash=()=>{const id=decodeURIComponent(window.location.hash.slice(1));const section=document.getElementById(id);section?.querySelector('details')?.setAttribute('open','');if(section){setActive(id);section.scrollIntoView({block:'start'});}};
  openHash();window.addEventListener('hashchange',openHash);
  const observer=new IntersectionObserver(entries=>{const visible=entries.filter(entry=>entry.isIntersecting).sort((a,b)=>a.boundingClientRect.top-b.boundingClientRect.top)[0];if(visible)setActive(visible.target.id);},{rootMargin:'-100px 0px -55% 0px'});
  items.forEach(item=>{const section=document.getElementById(item.id);if(section)observer.observe(section);});
  return()=>{observer.disconnect();window.removeEventListener('hashchange',openHash);};
 },[items]);
 return <aside className="d-legal-toc"><details open><summary>이 페이지의 목차<Icon name="menu" size={19}/></summary><nav aria-label="안내 목차">{items.map((item,i)=><Link href={'#'+item.id} aria-current={active===item.id?'location':undefined} key={item.id} onClick={()=>{setActive(item.id);document.getElementById(item.id)?.querySelector('details')?.setAttribute('open','');}}><span>{String(i+1).padStart(2,'0')}</span>{item.title}</Link>)}</nav></details></aside>;
}
export function LegalSection({id,number,title,summary,children}:{id:string;number:number;title:string;summary:string;children:ReactNode}){
 const [open,setOpen]=useState(false);
 useEffect(()=>{if(window.matchMedia('(min-width: 901px)').matches||window.location.hash==='#'+id)setOpen(true);},[id]);
 return <article id={id} className="d-legal-section public-info-card"><h2><span>{String(number).padStart(2,'0')}</span>{title}</h2><p>{summary}</p><details open={open} onToggle={event=>setOpen(event.currentTarget.open)}><summary>{title} 자세히 보기<Icon name="plus" size={18}/></summary><div className="privacy-policy-detail">{children}</div></details></article>;
}
