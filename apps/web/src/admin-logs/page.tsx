'use client';

import { Fragment, useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/auth';
import { Loading } from '@/components/ui';
import { Heading, Panel, Field } from '@/research/ui';
import { useUserLogs, type UserLogsError } from './client';
import {
  defaultLogFilters, koreanDate, recentLogDates, userLogEvents, userLogScreens,
  userLogsRequestSchema, type UserLog, type UserLogCursor, type UserLogsFilters,
} from './contracts';
import './styles.css';

const loginPath = '/login?next=%2Fops';
export { formatLogTime, formatActiveTime } from './display';
import { eventLabels, screenLabels, formatLogTime, formatActiveTime } from './display';
import { useAdminOverview } from './overview-client';
import { OverviewPanels, OverviewLoading } from './overview';
import { useOperationsData } from './operations-client';
import { OperationsPanels } from './operations';

function requestMessage(error: UserLogsError): { title: string; description: string } {
  if (error.code === 'mfa_required') return { title: '추가 인증이 필요합니다', description: '계정에 설정된 2단계 인증을 완료하면 사용자 로그를 다시 조회할 수 있습니다.' };
  if (error.status === 401) return { title: '로그인이 만료되었습니다', description: '보호된 로그를 닫았습니다. 다시 로그인한 뒤 이 페이지로 돌아오세요.' };
  if (error.status === 403) return { title: '사용자 로그에 접근할 수 없습니다', description: '관리자 계정으로 로그인했는지 확인해 주세요. 계정이 맞다면 운영 소유자에게 관리자 권한 확인을 요청해 주세요.' };
  if (error.status === 429) return { title: '잠시 후 다시 조회해 주세요', description: '짧은 시간에 조회가 집중되었습니다. 표시된 대기 시간이 끝나면 다시 시도할 수 있습니다.' };
  if (error.status === 422) return { title: '조회 조건을 확인해 주세요', description: '날짜 범위와 사용자 ID를 확인하고 다시 조회해 주세요. 한 번에 최대 90일을 조회할 수 있습니다.' };
  if (error.code === 'request_timeout') return { title: '조회 시간이 초과되었습니다', description: '현재 조회 조건은 유지됩니다. 연결 상태를 확인한 뒤 다시 시도해 주세요.' };
  return { title: '로그를 불러오지 못했습니다', description: '일시적으로 서버에 연결할 수 없거나 응답을 확인할 수 없습니다. 조회 조건을 유지한 채 다시 시도해 주세요.' };
}

function LogError({ error, retry, reauthenticate, busy, actionError }: {
  error: UserLogsError; retry: () => void; reauthenticate: () => void; busy: boolean; actionError: string;
}) {
  const [remaining, setRemaining] = useState(() => Math.max(0, Math.ceil(((error.retryAt ?? 0) - Date.now()) / 1_000)));
  useEffect(() => {
    const update = () => setRemaining(Math.max(0, Math.ceil(((error.retryAt ?? 0) - Date.now()) / 1_000)));
    update();
    if (!error.retryAt || error.retryAt <= Date.now()) return;
    const timer = setInterval(() => {
      update();
      if ((error.retryAt ?? 0) <= Date.now()) clearInterval(timer);
    }, 1_000);
    return () => clearInterval(timer);
  }, [error.retryAt]);
  const copy = requestMessage(error);
  const accessError = error.status === 401 || error.status === 403;
  return (
    <section className="user-log-error" role="alert">
      <h2>{copy.title}</h2>
      <p>{copy.description}</p>
      <div className="user-log-actions">
        {error.code === 'mfa_required' ? <button type="button" className="button primary" onClick={() => window.dispatchEvent(new Event('signalbrief:mfa-required'))}>추가 인증하기</button>
          : accessError ? <button type="button" className="button primary" disabled={busy} onClick={reauthenticate}>{busy ? '처리 중…' : error.status === 401 ? '다시 로그인' : '다른 계정으로 로그인'}</button>
          : <button type="button" className="button primary" disabled={remaining > 0} onClick={retry}>{remaining > 0 ? `${remaining}초 후 다시 시도` : '다시 시도'}</button>}
        {accessError && <Link className="button secondary" href="/forgot-password">비밀번호 찾기</Link>}
        <Link className="user-log-link" href="/today">서비스로 돌아가기</Link>
      </div>
      {actionError && <p>{actionError}</p>}
      {error.requestId && <p className="user-log-reference">문의 시 요청 ID: <code>{error.requestId}</code></p>}
    </section>
  );
}

function LogRows({ items, filterUser }: { items: UserLog[]; filterUser: (id: string) => void }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  return (
    <div className="user-log-table-wrap" tabIndex={0} role="region" aria-label="사용자 활동 로그 목록">
      <table className="user-log-table">
        <caption className="sr-only">최근 기록 순. 사용자 ID를 선택하면 해당 사용자의 로그로 필터링합니다.</caption>
        <thead><tr>{['발생 시각 (한국 시간)', '사용자', '활동', '화면', '기기', '활성시간', '상세'].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
        <tbody>{items.map(item => <Fragment key={item.id}>
          <tr>
            <td><time dateTime={item.created_at}>{formatLogTime(item.created_at)}</time></td>
            <td><button type="button" className="user-log-user" onClick={() => filterUser(item.user_id)} title={item.user_id} aria-label={`사용자 ${item.user_id}로 필터`}>{item.user_id.slice(0, 8)}…{item.user_id.slice(-4)}</button>{item.is_admin && <span className="user-log-admin-badge">관리자</span>}</td>
            <td><span className="user-log-event">{eventLabels[item.event]}</span></td>
            <td>{item.screen ? screenLabels[item.screen] : '미기록'}</td>
            <td>{item.device === 'mobile' ? '모바일' : item.device === 'desktop' ? '데스크톱' : '미기록'}</td>
            <td className="user-log-duration">{formatActiveTime(item.active_ms)}</td>
            <td><button type="button" className="user-log-detail-button" aria-expanded={expanded === item.id} aria-controls={`log-detail-${item.id}`} aria-label={`${formatLogTime(item.created_at)} ${eventLabels[item.event]} 상세`} onClick={() => setExpanded(value => value === item.id ? null : item.id)}>{expanded === item.id ? '닫기' : '보기'}</button></td>
          </tr>
          {expanded === item.id && <tr className="user-log-detail-row" id={`log-detail-${item.id}`}><td colSpan={7}>
            <dl>
              <div><dt>사용자 ID</dt><dd>{item.user_id}</dd></div>
              <div><dt>기록 ID</dt><dd>{item.id}</dd></div>
              <div><dt>세션 ID</dt><dd>{item.session_id ?? '해당 기록에서 수집하지 않음'}</dd></div>
              <div><dt>화면 방문 ID</dt><dd>{item.page_id ?? '해당 기록에서 수집하지 않음'}</dd></div>
              <div><dt>기록 유형</dt><dd>{item.source === 'usage' ? '화면 이용 기록' : '기능 이용 기록'} · {item.event}</dd></div>
              <div><dt>활성시간</dt><dd>{item.active_ms === null ? '해당 기록에서 측정하지 않음' : `${item.active_ms.toLocaleString('ko-KR')}ms`}</dd></div>
            </dl>
          </td></tr>}
        </Fragment>)}</tbody>
      </table>
    </div>
  );
}

function UserLogContent({ unified }: { unified: boolean }) {
  const auth = useAuth();
  const router = useRouter();
  const [draft, setDraft] = useState<UserLogsFilters>(defaultLogFilters);
  const [selected, setSelected] = useState<{ filters: UserLogsFilters; cursors: (UserLogCursor | null)[] }>(() => ({ filters: defaultLogFilters(), cursors: [null] }));
  const [today] = useState(koreanDate);
  const [validation, setValidation] = useState('');
  const [switching, setSwitching] = useState(false);
  const [switchError, setSwitchError] = useState('');
  const initialAnchorHandled = useRef(false);
  const cursor = selected.cursors[selected.cursors.length - 1];
  const result = useUserLogs({ ...selected.filters, cursor });
  const overview = useAdminOverview({ from: selected.filters.from, to: selected.filters.to, include_admin: selected.filters.include_admin });
  const operations = useOperationsData({ from: selected.filters.from, to: selected.filters.to }, unified);
  const accessError = [result.error, overview.error, operations.accessError].find(error => error?.status === 401 || error?.status === 403) ?? null;
  const response = accessError ? null : result.data;
  const oldest = new Date(Date.parse(`${today}T00:00:00Z`) - 89 * 86_400_000).toISOString().slice(0, 10);

  useEffect(() => {
    if (!unified || initialAnchorHandled.current || accessError || result.loading || overview.loading || operations.loading) return;
    initialAnchorHandled.current = true;
    const target = window.location.hash.slice(1);
    if (/^(overview-|operations-|activity-logs$)/.test(target)) document.getElementById(target)?.scrollIntoView?.({ block: 'start' });
  }, [unified, accessError, result.loading, overview.loading, operations.loading]);

  function apply(filters: UserLogsFilters) {
    const parsed = userLogsRequestSchema.safeParse({ ...filters, user_id: filters.user_id.trim(), cursor: null });
    if (!parsed.success) {
      setValidation(parsed.error.issues.some(issue => issue.path[0] === 'user_id')
        ? '사용자 ID는 전체 UUID를 입력해 주세요. 이메일이나 이름으로는 조회하지 않습니다.'
        : '시작일과 종료일을 확인해 주세요. 조회 기간은 최대 90일입니다.');
      return false;
    }
    const { cursor: ignored, ...next } = parsed.data;
    void ignored;
    setDraft(next);
    setSelected({ filters: next, cursors: [null] });
    setValidation('');
    result.reload();
    return true;
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    apply({ ...draft, from: selected.filters.from, to: selected.filters.to, include_admin: selected.filters.include_admin });
  }
  function submitPeriod(event: FormEvent) {
    event.preventDefault();
    if (apply({ ...selected.filters, from: draft.from, to: draft.to, include_admin: draft.include_admin })) overview.reload();
  }
  function refresh() {
    setSelected(value => ({ ...value, cursors: [null] }));
    result.reload();
    overview.reload();
    operations.reload();
  }
  async function reauthenticate() {
    if (switching) return;
    setSwitching(true);
    setSwitchError('');
    try {
      await auth.logout();
      router.replace(loginPath);
    } catch {
      setSwitchError('로그아웃을 완료하지 못했습니다. 연결 상태를 확인한 뒤 다시 시도해 주세요.');
    } finally { setSwitching(false); }
  }

  return (
    <div className={`user-log-page${unified ? ' unified-ops-page' : ''}`}>
      <Heading tag="SIGNALBRIEF · ADMIN" title={unified ? '운영 현황' : '운영 현황 · 사용자 로그'} description={unified ? '이용 지표·활동 로그부터 수집·AI 처리·검토·감사 기록까지 한 페이지에서 확인합니다.' : '방문부터 재방문, 기능 이용, 오류와 활동 기록까지 한 페이지에서 확인합니다.'}>
        <button type="button" className="button secondary" onClick={refresh} disabled={result.loading || overview.loading || operations.loading}>새로고침</button>
      </Heading>
      <nav className="overview-jump-links" aria-label="이 페이지 바로가기">
        <a href="#overview-metrics">핵심 지표</a><a href="#overview-usage">방문·전환</a><a href="#overview-pages">화면·이탈</a><a href="#overview-errors">오류</a><a href="#activity-logs">활동 로그</a>
        {unified && <><a href="#operations-pipeline">수집·AI 처리</a><a href="#operations-review">검토·실패</a><a href="#operations-data">원문·실행</a><a href="#operations-users">사용자</a><a href="#operations-audit">감사 로그</a></>}
      </nav>
      <section className="overview-period" aria-label="전체 조회 기간">
        <form onSubmit={submitPeriod} noValidate>
          <div className="overview-period-main">
            <div className="user-log-presets" role="group" aria-label="빠른 날짜 선택">
              <button type="button" className="button secondary" onClick={() => apply({ ...selected.filters, from: today, to: today })}>오늘</button>
              {([7, 30] as const).map(days => <button type="button" key={days} className="button secondary" onClick={() => apply({ ...selected.filters, ...recentLogDates(days) })}>최근 {days}일</button>)}
            </div>
            <div className="overview-date-fields">
              <Field label="시작일"><input type="date" value={draft.from} min={oldest} max={today} required onChange={event => setDraft(value => ({ ...value, from: event.target.value }))}/></Field>
              <Field label="종료일"><input type="date" value={draft.to} min={oldest} max={today} required onChange={event => setDraft(value => ({ ...value, to: event.target.value }))}/></Field>
              <button type="submit" className="button primary" disabled={result.loading || overview.loading}>기간 적용</button>
            </div>
          </div>
          <div className="overview-period-footer">
            <label className="user-log-checkbox"><input type="checkbox" checked={draft.include_admin} onChange={event => setDraft(value => ({ ...value, include_admin: event.target.checked }))}/><span>관리자 이용 기록 포함</span></label>
            <span>{selected.filters.from} ~ {selected.filters.to} · 한국 시간 · {selected.filters.include_admin ? '관리자 기록 포함' : '관리자 기록 제외'}</span>
          </div>
          {unified && <p className="overview-note">조회 기간은 이용 지표·활동 로그·수집·AI 처리 이력에 적용됩니다. {(operations.resources.snapshot.data?.schema_version ?? 1) >= 2 ? '검토 대기 목록은 기간과 관계없이 현재 대기 중인 항목입니다. ' : ''}원문·실행·가입 사용자·감사 로그는 전체 기간의 최신 기록을 표시합니다. 관리자 포함 설정은 이용 지표와 활동 로그에 적용됩니다.</p>}
          {validation && <p className="user-log-validation" role="alert">{validation}</p>}
        </form>
      </section>

      {accessError ? <LogError error={accessError} retry={refresh} reauthenticate={() => void reauthenticate()} busy={switching} actionError={switchError}/> : <>
        {overview.loading && <OverviewLoading/>}
        {overview.error && <section className="user-log-error" role="alert"><h2>핵심 지표를 불러오지 못했습니다</h2><p>이용 지표를 확인할 수 없습니다. 아래 활동 기록은 별도로 조회할 수 있습니다.</p><LogError error={overview.error} retry={overview.reload} reauthenticate={() => void reauthenticate()} busy={switching} actionError={switchError}/></section>}
        {overview.data && <OverviewPanels data={overview.data}/>}

        <section id="activity-logs" className="overview-section" aria-label="상세 활동 로그">
          <Panel title="활동 기록" aside={<span className="user-log-small">최근 기록 순 · 페이지당 50개</span>}>
            <p className="overview-note user-log-filter-intro">아래 조건은 활동 기록에만 적용됩니다. 위 지표는 전체 조회 기간과 관리자 포함 설정을 따릅니다.</p>
            <form className="user-log-detail-filters" onSubmit={submit} noValidate>
              <div className="user-log-filters">
                <Field label="활동 유형"><select value={draft.event} onChange={event => setDraft(value => ({ ...value, event: event.target.value as UserLogsFilters['event'] }))}><option value="">전체 활동</option>{userLogEvents.map(name => <option value={name} key={name}>{eventLabels[name]}</option>)}</select></Field>
                <Field label="화면"><select value={draft.screen} onChange={event => setDraft(value => ({ ...value, screen: event.target.value as UserLogsFilters['screen'] }))}><option value="">전체 화면</option>{userLogScreens.map(screen => <option value={screen} key={screen}>{screenLabels[screen]}</option>)}</select></Field>
                <Field label="기기"><select value={draft.device} onChange={event => setDraft(value => ({ ...value, device: event.target.value as UserLogsFilters['device'] }))}><option value="">전체 기기</option><option value="desktop">데스크톱</option><option value="mobile">모바일</option></select></Field>
                <div className="user-log-id-filter"><Field label="사용자 ID"><input value={draft.user_id} maxLength={36} autoComplete="off" spellCheck={false} placeholder="전체 UUID · 비우면 전체 사용자" onChange={event => setDraft(value => ({ ...value, user_id: event.target.value }))}/></Field></div>
              </div>
              <div className="user-log-filter-footer"><span className="user-log-small">이메일·검색 내용·질문 원문은 표시하지 않습니다.</span><div className="user-log-actions">
                <button type="button" className="button secondary" onClick={() => apply({ ...defaultLogFilters(), from: selected.filters.from, to: selected.filters.to, include_admin: selected.filters.include_admin })}>조건 초기화</button>
                <button type="submit" className="button primary" disabled={result.loading}>조회하기</button>
              </div></div>
            </form>
            {result.loading && <Loading label="관리자 권한을 확인하고 로그를 불러오고 있습니다."/>}
            {result.error && <LogError error={result.error} retry={result.reload} reauthenticate={() => void reauthenticate()} busy={switching} actionError={switchError}/>}
            {response && <>
              <div className="user-log-counts"><span>기록 <strong>{response.summary.events.toLocaleString('ko-KR')}개</strong></span><span>사용자 <strong>{response.summary.users.toLocaleString('ko-KR')}명</strong></span><span>기록된 세션 ID <strong>{response.summary.sessions.toLocaleString('ko-KR')}개</strong></span><span>활성시간 합계 <strong>{formatActiveTime(response.summary.active_ms)}</strong></span></div>
              {response.items.length ? <LogRows key={JSON.stringify({ filters: selected.filters, cursor })} items={response.items} filterUser={user_id => apply({ ...selected.filters, user_id })}/>
                : <div className="user-log-empty" role="status"><h3>조회할 기록이 없습니다</h3><p>{response.consented_users === 0 ? '현재 선택적 이용 통계에 동의한 사용자가 없습니다. 통계 수집에 동의한 사용자가 서비스를 이용하면 기록이 표시됩니다.' : selected.cursors.length > 1 ? '이 페이지의 기록이 더 이상 조회되지 않습니다. 새로고침하여 최신 기록부터 확인해 주세요.' : '선택한 조건에 맞는 이용 기록이 없습니다. 날짜와 필터를 확인해 주세요. 관리자 기록은 기본적으로 제외합니다.'}</p><p>미동의 사용자와 비로그인 방문자는 이 로그에 포함되지 않습니다.</p></div>}
              <div className="user-log-pagination"><span>{selected.cursors.length}페이지 · {response.items.length}개 표시</span><div className="user-log-actions">
                <button type="button" className="button secondary" disabled={selected.cursors.length === 1} onClick={() => setSelected(value => ({ ...value, cursors: value.cursors.slice(0, -1) }))}>이전</button>
                <button type="button" className="button secondary" disabled={!response.has_more || !response.next_cursor} onClick={() => { if (response.next_cursor) setSelected(value => ({ ...value, cursors: [...value.cursors, response.next_cursor] })); }}>다음</button>
              </div></div>
              <p className="user-log-updated">로그 조회 시각: <time dateTime={response.generated_at}>{formatLogTime(response.generated_at)}</time> (한국 시간)</p>
            </>}
          </Panel>
        </section>
        {unified && <OperationsPanels resources={operations.resources} reload={operations.reload} refresh={refresh} deny={operations.deny}/>}
      </>}
      <details className="user-log-scope"><summary>측정 기준·수집 범위</summary>
        <p>관리자로 확인된 계정만 조회할 수 있습니다. 선택적 이용 통계에 동의한 로그인 사용자의 최근 90일을 집계하며, 동의를 철회한 사용자는 제외합니다. 수집을 시작하기 전의 방문과 행동 기록은 복원하지 않습니다.</p>
        <p>비로그인 방문자와 가입 시작 기록이 없어 전체 방문자 수와 회원가입 전환율은 측정하지 않습니다. 오류율은 별도로 기록된 인증 API 요청의 최근 30일 이내 집계이며, 관리자 요청을 포함합니다.</p>
        <p>요약 지표의 세션은 같은 사용자의 기록된 세션 ID 안에서 30분 이상 활동 공백이 생기면 나눕니다. 상세 로그의 세션 ID 수는 원래 기록된 식별자 수여서 요약 세션 수와 다를 수 있습니다.</p>
      </details>
    </div>
  );
}

export default function UserActivityLogs({ unified = false }: { unified?: boolean }) {
  const auth = useAuth();
  if (auth.loading) return <Loading label="관리자 인증 정보를 확인하고 있습니다."/>;
  if (!auth.token || !auth.me?.is_admin || auth.error) return <section className="user-log-error"><h1>관리자 인증이 필요합니다</h1><p>관리자 계정으로 로그인한 뒤 다시 시도해 주세요.</p><Link className="button primary" href={loginPath}>로그인</Link></section>;
  return <UserLogContent key={auth.me.id} unified={unified}/>;
}
