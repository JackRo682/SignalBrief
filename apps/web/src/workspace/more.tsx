'use client';
import Link from 'next/link';
import {usePrefs} from './preferences';
import {Icon} from '@/components/icons';
import type {WorkspaceNavigationItem} from '@/lib/workspace-features';
import './monitoring.css';

const links: readonly WorkspaceNavigationItem[] = [
  ['/calendar','캘린더','Calendar','calendar'],
  ['/saved','저장한 자료','Saved items','file'],
  ['/alerts','알림','Notifications','bell'],
  ['/questions','근거 기반 질문','Questions and sources','spark'],
  ['/settings','설정','Settings','settings'],
  ['/help','도움말','Help','shield'],
];
export default function WorkspaceMore() {
  const {text:t}=usePrefs();
  return <div className="sb-monitoring"><header><div><h1>{t('더 보기','More')}</h1>
    <p>{t('저장한 자료와 일정, 알림을 확인하고 계정을 관리하세요.','Find saved research, dates and notifications, and manage your account.')}</p></div></header>
    <div className="sb-more-grid">{links.map(([href,ko,en,icon])=><Link className="sb-monitor-card" href={href} key={href}><Icon name={icon}/><strong>{t(ko,en)}</strong><span aria-hidden="true">›</span></Link>)}</div>
  </div>;
}
