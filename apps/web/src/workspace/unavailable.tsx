'use client';
import Link from 'next/link';
import {usePrefs} from './preferences';

export default function WorkspaceUnavailable() {
  const {text:t} = usePrefs();
  return <section className="ws-panel" style={{padding:32, maxWidth:720, margin:'32px auto'}}>
    <h1>{t('현재 제공하지 않는 기능입니다.', 'This feature is currently unavailable.')}</h1>
    <p>{t('기업 공시, 검토된 분석과 일정은 관심 기업에서 확인할 수 있습니다. 기존에 저장한 데이터는 유지됩니다.', 'Follow companies to read disclosures, reviewed analyses and verified dates. Your existing records are retained.')}</p>
    <Link className="ws-button" href="/watchlist">{t('관심 기업으로 이동', 'Open watchlist')}</Link>
  </section>;
}
