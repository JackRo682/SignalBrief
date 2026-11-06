'use client';
import Link from 'next/link';
import Home from './home';
import './home-b.css';

/** B intentionally shares A's real data, state, filters, links and failure handling.
 * Only ONE Home is mounted. All B presentation rules are namespaced below this root.
 * Keeping the original Home/CSS byte-for-byte preserves the control experience.
 */
export default function HomeB() {
  return <div className="sb-home-b" data-home-layout="B">
    <div className="sb-home-b-masthead">
      <span>DAILY WORKSPACE</span>
      <nav aria-label="홈 빠른 이동">
        <a href="#recent-activity">최근 소식으로 이동 <span aria-hidden="true">↘</span></a>
        <Link href="/saved">저장한 자료 <span aria-hidden="true">↗</span></Link>
      </nav>
    </div>
    <Home />
  </div>;
}
