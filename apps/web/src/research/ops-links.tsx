'use client';
import Link from 'next/link';
import {useAuth} from '@/components/auth';
export default function OpsResearchLinks(){const {me}=useAuth();if(!me?.is_admin)return null;return <nav aria-label="분석 관리자 메뉴" style={{position:'relative',zIndex:40,display:'flex',flexWrap:'wrap',gap:20,padding:'14px 24px',background:'#eef2ff',fontSize:13,color:'#3158d5',borderBottom:'1px solid #dce3f5'}}>{[['analytics','사용자 행동 분석'],['experiments','A/B 실험'],['evaluations','AI 평가'],['quality','품질 검수'],['reliability','장애·안전성'],['reports','결과 보고서']].map(([path,label])=><Link key={path} href={`/ops/${path}`}>{label} ↗</Link>)}</nav>;}
