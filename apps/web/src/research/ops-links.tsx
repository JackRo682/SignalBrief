'use client';
import Link from 'next/link';
import {useAuth} from '@/components/auth';
export default function OpsResearchLinks(){const {me}=useAuth();if(!me?.is_admin)return null;return <nav aria-label="분석 관리자 메뉴" className="ops-canonical-link"><Link href="/ops">운영 현황</Link></nav>;}
