import Link from 'next/link';
import type {Metadata} from 'next';
import {TradingViewNews} from '@/components/tradingview-news';

export const metadata: Metadata = {title: '주요 뉴스'};
export default function NewsPage() {
  return <main className="sb-news-page"><nav><Link href="/">SignalBrief</Link><Link href="/today">오늘의 변화 →</Link></nav>
    <h1>주요 뉴스</h1><TradingViewNews/></main>;
}
