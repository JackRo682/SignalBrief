'use client';

import type { ReactNode } from 'react';
import { Panel } from '@/research/ui';
import type { AdminOverviewResponse } from './overview-contracts';
import { eventLabels, screenLabels, formatActiveTime, formatLogTime } from './display';

const number = (value: number) => value.toLocaleString('ko-KR');
export function formatOverviewRate(value: number | null): string {
  return value === null ? '—' : `${(value * 100).toLocaleString('ko-KR', { maximumFractionDigits: 1 })}%`;
}

function Metric({ label, value, detail, state }: { label: string; value: ReactNode; detail: string; state?: string }) {
  return <article className="overview-metric" aria-label={label}>
    <div className="overview-metric-label"><h3>{label}</h3>{state && <span>{state}</span>}</div>
    <div className="overview-metric-value">{value}</div>
    <p>{detail}</p>
  </article>;
}

function Empty({ children }: { children: ReactNode }) {
  return <div className="overview-empty"><p>{children}</p></div>;
}

function DataTable({ label, headings, children }: { label: string; headings: string[]; children: ReactNode }) {
  return <div className="overview-table-wrap" tabIndex={0} role="region" aria-label={label}>
    <table className="overview-table"><caption className="sr-only">{label}</caption>
      <thead><tr>{headings.map(heading => <th scope="col" key={heading}>{heading}</th>)}</tr></thead>
      <tbody>{children}</tbody>
    </table>
  </div>;
}

export function OverviewLoading() {
  return <section id="overview-metrics" className="overview-loading" role="status" aria-label="핵심 지표를 불러오는 중">
    <div className="overview-metrics">{['방문자 수', '회원가입 전환율', '활성화율', 'D1 · D7 리텐션', '핵심 기능 이용률', '활성 체류시간', '주요 이탈 화면', '오류 발생률'].map(label =>
      <Metric key={label} label={label} value="—" detail="측정 기록을 확인하고 있습니다."/>,
    )}</div>
  </section>;
}

export function OverviewPanels({ data }: { data: AdminOverviewResponse }) {
  const { summary, api, coverage } = data;
  const d1 = data.retention.find(row => row.day === 1);
  const d7 = data.retention.find(row => row.day === 7);
  const exit = data.pages.filter(row => row.exits > 0).sort((a, b) => b.exits - a.exits || a.screen.localeCompare(b.screen))[0];
  const maxVisitors = Math.max(1, ...data.days.map(day => day.visitors));
  const hasViews = data.days.some(day => day.page_views > 0);
  const activeTime = summary.average_active_ms === null ? '—' : formatActiveTime(Math.round(summary.average_active_ms));
  const apiFrom = api.coverage_from ? formatLogTime(api.coverage_from) : '—';
  const apiTo = api.coverage_to ? formatLogTime(api.coverage_to) : '—';

  return <>
    <section id="overview-metrics" className="overview-section" aria-labelledby="overview-metrics-title">
      <div className="overview-section-heading"><h2 id="overview-metrics-title">핵심 지표</h2><span>선택한 기간 · 한국 시간</span></div>
      <div className="overview-metrics">
        <Metric label="방문자 수" value={<>{number(summary.visitors)}<small>명</small></>} detail="분석에 동의한 로그인 방문자" state={coverage.eligible_users === 0 ? '수집 대기' : undefined}/>
        <Metric label="회원가입 전환율" value="미측정" detail="비로그인 가입 시작 기록이 아직 없습니다." state="수집 필요"/>
        <Metric label="활성화율" value={formatOverviewRate(summary.activation.rate)} detail={`${number(summary.activation.completed)} / ${number(summary.activation.eligible)}명 · 신규 가입자 중 현재 온보딩 완료`} state="온보딩 기준"/>
        <Metric label="D1 · D7 리텐션" value={<div className="overview-retention-value"><span><small>D1</small>{formatOverviewRate(d1?.rate ?? null)}</span><span><small>D7</small>{formatOverviewRate(d7?.rate ?? null)}</span></div>} detail="보관 기간 내 첫 방문일 기준 · 관측이 끝난 표본"/>
        <Metric label="핵심 기능 이용률" value={formatOverviewRate(summary.core_feature_rate)} detail={`${number(summary.core_feature_users)} / ${number(summary.active_users)}명 · 핵심 기능을 이용한 사용자`}/>
        <Metric label="활성 체류시간" value={activeTime} detail={`세션당 평균 · ${number(summary.sessions)}개 세션`} state="화면 활성 시간"/>
        <Metric label="주요 이탈 화면" value={exit ? screenLabels[exit.screen] : '집계 대기'} detail={exit ? `${number(exit.exits)}회 · 종료 세션의 마지막 화면` : '30분 동안 활동이 없는 세션 기준'}/>
        <Metric label="오류 발생률" value={formatOverviewRate(api.error_rate)} detail={`${number(api.errors)} / ${number(api.requests)}건 · 인증 API의 5xx 응답`} state="API 기준"/>
      </div>
      <div className="overview-coverage" role="status">
        <span className={`overview-dot${coverage.eligible_users === 0 ? ' is-waiting' : ''}`} aria-hidden="true"/>
        <p>{coverage.eligible_users === 0 ? '집계 대상 중 이용 통계에 동의한 사용자가 없습니다. 실제 이용 기록이 쌓이면 지표가 표시됩니다.'
          : `집계 대상 ${number(coverage.eligible_users)}명 · 이용 통계 동의와 관리자 제외 조건을 반영합니다.`}
          <span>미측정 항목과 분모가 없는 비율은 0%로 표시하지 않습니다.</span></p>
      </div>
    </section>

    <section id="overview-usage" className="overview-section" aria-label="방문 및 가입 현황">
      <div className="overview-two-column">
        <Panel title="날짜별 방문자" aside={<span className="user-log-small">고유 방문자 · 일별 중복 제거</span>}>
          {hasViews ? <>
            <div className="overview-chart" role="img" aria-label={`${data.from}부터 ${data.to}까지 날짜별 방문자. 아래 날짜별 수치 보기에서 정확한 값을 확인할 수 있습니다.`}>
              {data.days.map(day => <div className="overview-chart-column" key={day.day} title={`${day.day}: ${number(day.visitors)}명 · ${number(day.page_views)}회 방문`}>
                <div className="overview-chart-track"><span style={{ height: `${day.visitors / maxVisitors * 100}%` }}/></div>
              </div>)}
            </div>
            <div className="overview-chart-labels"><span>{data.from}</span><span>{data.to}</span></div>
            <details className="overview-detail"><summary>날짜별 수치 보기</summary><DataTable label="날짜별 방문자 수" headings={['날짜', '방문자', '화면 방문']}>
              {data.days.map(day => <tr key={day.day}><th scope="row">{day.day}</th><td>{number(day.visitors)}명</td><td>{number(day.page_views)}회</td></tr>)}
            </DataTable></details>
          </> : <Empty>선택한 기간에 기록된 화면 방문이 없습니다.</Empty>}
          <p className="overview-note">기간 전체 방문자 {number(summary.visitors)}명 · 화면 방문 {number(summary.page_views)}회. 일별 방문자를 더하면 같은 사용자가 중복될 수 있습니다.</p>
        </Panel>
        <Panel title="가입·활성화" aside={<span className="user-log-small">측정 가능한 단계</span>}>
          <div className="overview-funnel">
            <div><span>01</span><p>가입 시작<small>비로그인 구간 수집 필요</small></p><strong>미측정</strong></div>
            <div><span>02</span><p>기간 내 신규 가입<small>이용 통계 동의자 기준</small></p><strong>{number(summary.activation.eligible)}<small>명</small></strong></div>
            <div><span>03</span><p>현재 온보딩 완료<small>위 신규 가입자 중 완료한 사용자</small></p><strong>{number(summary.activation.completed)}<small>명</small></strong></div>
          </div>
          <p className="overview-note">활성화율은 온보딩 완료를 대리 지표로 사용합니다. 가입 후 7일 내 핵심 기능 완료율과는 다릅니다. 완료 상태 확인 시각: {formatLogTime(summary.activation.as_of)}.</p>
        </Panel>
      </div>
      <div className="overview-two-column">
        <Panel title="핵심 기능 이용" aside={<span className="user-log-small">사용자 기준 · 중복 제거</span>}>
          {summary.active_users > 0 ? <DataTable label="핵심 기능별 이용률" headings={['기능', '사용자', '기록 수', '이용률']}>
            {data.features.map(feature => <tr key={feature.event}><th scope="row">{eventLabels[feature.event]}</th><td>{number(feature.users)}명</td><td>{number(feature.events)}회</td><td><span className="overview-rate">{formatOverviewRate(feature.usage_rate)}</span></td></tr>)}
          </DataTable> : <Empty>사용자의 기능 이용 기록이 쌓이면 이용률을 비교할 수 있습니다.</Empty>}
          <p className="overview-note">분모는 선택 기간에 화면 또는 기능 이용이 기록된 사용자 {number(summary.active_users)}명입니다. 여러 기능을 쓴 사용자는 각 기능에 포함됩니다.</p>
        </Panel>
        <Panel title="D1 · D7 리텐션" aside={<span className="user-log-small">첫 관측일 코호트</span>}>
          <DataTable label="재방문 리텐션" headings={['구분', '재방문 / 표본', '관측 대기', '리텐션']}>
            {data.retention.map(row => <tr key={row.day}><th scope="row">D{row.day}</th><td>{number(row.returned)} / {number(row.eligible)}명</td><td>{number(row.pending)}명</td><td>{formatOverviewRate(row.rate)}</td></tr>)}
          </DataTable>
          <p className="overview-note">선택 기간에 처음 관측된 사용자가 정확히 1일·7일 뒤에 다시 방문했는지 확인합니다. 해당 날짜가 끝난 사용자만 분모에 포함합니다. 가입일 기준이 아니며, 재방문은 조회 시점까지 관측합니다.</p>
          {!data.retention.some(row => row.eligible > 0) && <p className="overview-inline-status">아직 리텐션을 계산할 수 있는 표본이 없습니다.</p>}
        </Panel>
      </div>
    </section>

    <section id="overview-pages" className="overview-section" aria-label="화면별 이용 및 이탈">
      <Panel title="화면별 이용·이탈" aside={<span className="user-log-small">체류시간과 마지막 화면을 함께 확인</span>}>
        {data.pages.length ? <DataTable label="화면별 이용 및 이탈 기록" headings={['화면', '방문', '사용자', '평균 활성시간', '이탈', '이탈률']}>
          {data.pages.map(page => <tr key={page.screen}>
            <th scope="row">{screenLabels[page.screen]}</th><td>{number(page.views)}회</td><td>{number(page.users)}명</td>
            <td>{formatActiveTime(page.average_active_ms === null ? null : Math.round(page.average_active_ms))}</td><td>{number(page.exits)}회</td><td>{formatOverviewRate(page.exit_rate)}</td>
          </tr>)}
        </DataTable> : <Empty>화면 방문과 활성시간 기록이 생기면 이탈 지점을 확인할 수 있습니다.</Empty>}
        <p className="overview-note">평균 활성시간은 해당 화면을 이용한 세션 기준입니다. 화면이 보이고 최근 입력이 있는 시간만 측정합니다. 이탈은 30분 동안 활동이 없는 세션의 마지막 화면으로 추정하며, 해당 화면을 방문한 세션을 분모로 사용합니다.</p>
      </Panel>
    </section>

    <section id="overview-errors" className="overview-section" aria-label="오류 및 안정성">
      <Panel title="오류·안정성" aside={<span className="overview-scope-badge">인증 API · 최대 30일</span>}>
        <div className="overview-api-summary"><div><span>기록된 요청</span><strong>{number(api.requests)}<small>건</small></strong></div><div><span>5xx 오류</span><strong className={api.errors > 0 ? 'overview-error-count' : ''}>{number(api.errors)}<small>건</small></strong></div><div><span>평균 응답시간</span><strong>{api.mean_latency_ms === null ? '—' : `${number(Math.round(api.mean_latency_ms))}`}<small>{api.mean_latency_ms === null ? '' : 'ms'}</small></strong></div></div>
        {api.recent_error_hours.length ? <DataTable label="최근 오류가 기록된 시간대" headings={['오류 발생 시간대 (한국 시간)', '전체 요청', '5xx 오류', '오류율']}>
          {api.recent_error_hours.map(hour => <tr key={hour.hour}><th scope="row"><time dateTime={hour.hour}>{formatLogTime(hour.hour)}부터 1시간</time></th><td>{number(hour.requests)}건</td><td>{number(hour.errors)}건</td><td>{formatOverviewRate(hour.error_rate)}</td></tr>)}
        </DataTable> : <Empty>{api.requests > 0 ? '조회 가능한 범위에 기록된 API 5xx 오류가 없습니다.' : '조회 가능한 범위에 API 요청 기록이 없어 오류율을 계산할 수 없습니다.'}</Empty>}
        <p className="overview-note">완료된 기존 인증 API 요청의 시간별 집계입니다. 관리자 요청도 포함하며, 전체 사이트 요청·브라우저 오류·외부 공급자의 모든 오류를 뜻하지 않습니다. 개별 오류 원문은 수집하지 않습니다.</p>
        <p className="overview-note">집계 범위: {apiFrom} ~ {apiTo}. 마지막 요청 기록: {api.last_seen ? formatLogTime(api.last_seen) : '없음'}.</p>
      </Panel>
    </section>
    <p className="overview-updated">지표 조회 시각: <time dateTime={data.generated_at}>{formatLogTime(data.generated_at)}</time> · 첫 보관 이용 기록: {coverage.first_available_event_at ? formatLogTime(coverage.first_available_event_at) : '없음'}</p>
  </>;
}
