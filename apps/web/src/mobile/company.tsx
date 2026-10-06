'use client';

import Link from 'next/link';
import {useEffect, useState} from 'react';
import {z} from 'zod';
import {useAuth} from '@/components/auth';
import {body, emptySchema, errorMessage, request} from '@/lib/api';
import {portfolioSchema} from '@/lib/contracts';
import {decimalInput} from '@/lib/decimal-input';
import {workspace} from '@/workspace/client';
import {companyDetailSchema, resourceHref, type Resource} from '@/workspace/contracts';
import {useQuotes} from '@/workspace/market';
import {usePrefs} from '@/workspace/preferences';
import {useData, useMutation} from '@/workspace/ui';
import {ActionNotice, CompanyLogo, Dialog, EmptyState, LoadState, MIcon, SectionTitle, SmallChart, eventLabel, formatMoney, relativeTime} from '@/mobile/ui';
import './company.css';

type Fact = z.infer<typeof companyDetailSchema>['facts'][number];
const savedResponse = z.object({saved: z.boolean()});
const knownNames: Record<string, [string, string]> = {NVDA: ['엔비디아', 'NVIDIA'], AAPL: ['애플', 'Apple'], TSLA: ['테슬라', 'Tesla'], MSFT: ['마이크로소프트', 'Microsoft']};

function PositionDialog({id, onClose, onSaved}: {id: string; onClose: () => void; onSaved: () => void}) {
  const {token} = useAuth();
  const {text: t} = usePrefs();
  const action = useMutation();
  const [quantity, setQuantity] = useState('');
  const [cost, setCost] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setLoading(true); setError('');
    request('/v1/portfolio', token, portfolioSchema, {signal: controller.signal}).then(data => {
      if (!active) return;
      const holding = data.positions.find(position => position.company.id === id);
      setQuantity(decimalInput(holding?.quantity));
      setCost(decimalInput(holding?.average_cost));
      setCurrency(holding?.currency ?? 'USD');
    }).catch(cause => {if (active) setError(errorMessage(cause));}).finally(() => {if (active) setLoading(false);});
    return () => {active = false; controller.abort();};
  }, [id, token, revision]);
  return <Dialog title={t('보유 정보 입력', 'Holding details')} onClose={onClose}>
    <div className="m-company-position-dialog"><LoadState loading={loading} error={error} retry={() => setRevision(previous => previous + 1)}/><ActionNotice action={action}/>
      {!loading && !error && <form onSubmit={event => {event.preventDefault(); void action.run(async () => {
        const exactQuantity = quantity.trim(), exactCost = cost.trim();
        if (!/^\d{1,20}(\.\d{1,8})?$/.test(exactQuantity) || !/[1-9]/.test(exactQuantity)) throw new Error(t('0보다 큰 보유 수량을 입력해주세요.', 'Enter a quantity greater than zero.'));
        if (exactCost && !/^\d{1,20}(\.\d{1,8})?$/.test(exactCost)) throw new Error(t('평균 단가를 확인해주세요. 소수점 8자리까지 입력할 수 있어요.', 'Check the average cost. Up to eight decimal places are supported.'));
        if (!['USD', 'KRW', 'EUR', 'JPY', 'GBP', 'AUD', 'CAD', 'HKD', 'CNY', 'CHF'].includes(currency)) throw new Error(t('지원하는 통화를 선택해주세요.', 'Choose a supported currency.'));
        await request(`/v1/portfolio/positions/${encodeURIComponent(id)}`, token, emptySchema, body('PUT', {quantity: exactQuantity, average_cost: exactCost || null, currency}));
        onSaved();
      });}}>
        <p className="m-muted">{t('실제 보유 수량과 평균 단가를 입력해주세요.', 'Enter your actual quantity and average cost.')}</p>
        <label className="m-field">{t('보유 수량', 'Quantity')}<input required autoFocus inputMode="decimal" maxLength={30} value={quantity} onChange={event => setQuantity(event.target.value)}/></label>
        <label className="m-field">{t('평균 단가 (선택)', 'Average cost (optional)')}<input inputMode="decimal" maxLength={30} value={cost} onChange={event => setCost(event.target.value)} placeholder={t('입력하지 않으면 미설정', 'Leave blank if unknown')}/></label>
        <label className="m-field">{t('취득가 통화', 'Cost currency')}<select value={currency} onChange={event => setCurrency(event.target.value)}>{['USD', 'KRW', 'EUR', 'JPY', 'GBP', 'AUD', 'CAD', 'HKD', 'CNY', 'CHF'].map(code => <option key={code}>{code}</option>)}</select></label>
        <footer><button type="button" className="m-button m-button-secondary" onClick={onClose}>{t('취소', 'Cancel')}</button><button className="m-button" disabled={action.busy}>{action.busy ? t('저장 중', 'Saving') : t('저장', 'Save')}</button></footer>
      </form>}
    </div>
  </Dialog>;
}

function SavedMonitoringRow({item}: {item: Resource}) {
  const {token} = useAuth();
  const {text: t} = usePrefs();
  const [saved, setSaved] = useState(item.is_saved);
  const action = useMutation();
  useEffect(() => setSaved(item.is_saved), [item.is_saved]);
  return <div className="m-company-monitor-item"><div className="m-company-monitor-row">
    <button className={`m-company-check ${saved ? 'is-checked' : ''}`} role="checkbox" aria-checked={saved} disabled={action.busy}
      aria-label={`${item.title} ${saved ? t('저장 취소', 'unsave') : t('저장', 'save')}`}
      onClick={() => void action.run(async () => {const result = await workspace(token, {action: 'save', p: {kind: 'event', id: item.id, saved: !saved}}, savedResponse); setSaved(result.saved);})}>
      {saved && <MIcon name="check" size={14}/>}
    </button>
    <Link href={resourceHref(item)}><strong>{item.title}</strong><p>{item.summary || t('근거 자료를 확인하고 다음 변화를 추적하세요.', 'Review the evidence and follow the next update.')}</p></Link>
    <Link className="m-icon-button" href={resourceHref(item)} aria-label={`${item.title} ${t('자세히 보기', 'details')}`}><MIcon name="chevron" size={14}/></Link>
  </div><ActionNotice action={action}/></div>;
}

function SourcedMetric({fact, index}: {fact: Fact; index: number}) {
  const {text: t} = usePrefs();
  const icons = ['coins', 'timeline', 'trend', 'pie'];
  return <Link href={`/events/${encodeURIComponent(fact.event_id)}?panel=evidence`} className={`m-card m-company-metric m-company-metric-${index % 4}`}>
    <div><span className="m-company-metric-icon"><MIcon name={icons[index % 4]} size={16}/></span><span>{fact.field}</span></div>
    <strong>{fact.value_raw ?? t('원문 확인', 'View source')}{fact.unit && <small> {fact.unit}</small>}</strong>
    <p>{fact.period || fact.basis || t('검증된 원문', 'Verified source')}</p>
  </Link>;
}

export default function MobileCompany({id}: {id: string}) {
  const {token} = useAuth();
  const {text: t, value, date} = usePrefs();
  const result = useData({action: 'company', p: {id}}, companyDetailSchema);
  const data = result.data, company = data?.company;
  const action = useMutation();
  const [positionOpen, setPositionOpen] = useState(false);
  const [metricsOpen, setMetricsOpen] = useState(false);
  const [chartOpen, setChartOpen] = useState(false);
  const [period, setPeriod] = useState('6m');
  const quotes = useQuotes(company ? [company.ticker] : [], period), quote = quotes.quotes.find(item => item.symbol === company?.ticker);
  const title = company ? knownNames[company.ticker]?.[value.locale === 'ko' ? 0 : 1] ?? company.company_name : '';
  const query = encodeURIComponent(company?.ticker ?? '');
  const noMetrics = [
    {ko: '시가총액', en: 'Market cap', icon: 'coins'}, {ko: '주가수익비율 (PER)', en: 'P/E ratio', icon: 'timeline'},
    {ko: '매출 성장률', en: 'Revenue growth', icon: 'trend'}, {ko: '영업이익률', en: 'Operating margin', icon: 'pie'},
  ];
  const visit = (item: Resource) => {if (value.history_enabled) void workspace(token, {action: 'visit', p: {kind: item.kind, id: item.id}}, z.unknown()).catch(() => {});};
  useEffect(() => {
    if (value.history_enabled && company?.id && token) void workspace(token, {action: 'visit', p: {kind: 'company', id: company.id}}, z.unknown()).catch(() => {});
  }, [company?.id, token, value.history_enabled]);

  return <div className="m-company-page"><LoadState loading={result.loading} error={result.error} retry={result.reload}/><ActionNotice action={action}/>
    {data && company && <>
      <section className="m-card m-company-hero">
        <div className="m-company-profile"><CompanyLogo ticker={company.ticker} size={61}/><div><h1>{title}</h1><p className="m-company-market">{company.ticker}<span> | </span>{company.market}</p>
          <p className="m-company-description">{company.summary || t('공식 공시로 연결되는 기업 정보와 주요 변화', 'Company information and changes linked to official filings')}</p></div></div>
        <div className="m-company-quote-area"><button className={`m-company-quote ${quote?.change_pct != null && quote.change_pct < 0 ? 'is-negative' : ''}`}
          onClick={() => setChartOpen(true)} aria-label={t('주가 차트 자세히 보기', 'Open price history')}>
          <div><strong>{quote?.price == null ? '—' : formatMoney(quote.price, quote.currency, value.locale)}</strong><span>{quote?.change_pct == null ? t('시세 확인 전', 'Quote unavailable') : `${quote.change_pct < 0 ? '▼' : '▲'} ${Math.abs(quote.change_pct).toFixed(2)}%`}</span></div>
          <SmallChart values={quote?.history.map(point => point.close) ?? []}/>
        </button><p className="m-company-quote-meta">{quote ? date(quote.as_of) : t('시세 공급자 연결 확인', 'Check price data connection')}<br/>{quote ? `${quote.source} · ${quote.currency}` : company.market}</p></div>
        <div className="m-company-actions"><button className="m-button m-button-secondary" disabled={action.busy} aria-pressed={data.watching}
          onClick={() => void action.run(async () => {await request(`/v1/watchlist/${encodeURIComponent(id)}`, token, emptySchema, body(data.watching ? 'DELETE' : 'PUT')); result.reload();}, t('관심종목을 업데이트했어요.', 'Watchlist updated.'))}>
          <MIcon name="star" size={18} className={data.watching ? 'm-company-watched' : ''}/>{t('관심종목', 'Watchlist')}</button>
          <button className="m-button m-button-secondary" onClick={() => setPositionOpen(true)}><MIcon name="plus" size={16}/>{data.holding ? t('보유 정보 수정', 'Edit holding') : t('포트폴리오에 추가', 'Add to portfolio')}</button>
        </div>
      </section>

      <section className="m-company-section m-company-metrics-section"><SectionTitle title={t('핵심 지표', 'Key metrics')} action={<button onClick={() => setMetricsOpen(true)}>{t('전체 보기', 'View all')}<MIcon name="chevron" size={13}/></button>}/>
        <div className="m-company-metrics">{data.facts.length ? data.facts.slice(0, 4).map((fact, index) => <SourcedMetric key={fact.id} fact={fact} index={index}/>) : noMetrics.map((metric, index) => <div className={`m-card m-company-metric m-company-metric-${index}`} key={metric.en}>
          <div><span className="m-company-metric-icon"><MIcon name={metric.icon} size={16}/></span><span>{t(metric.ko, metric.en)}</span></div><strong>—</strong><p>{t('자료 확인 전', 'Not available')}</p>
        </div>)}</div>
      </section>

      <section className="m-company-section"><SectionTitle title={t('최근 주요 변화', 'Recent changes')} href={`/search?q=${query}&kind=event`}/>
        <div className="m-stack m-company-events">{data.events.slice(0, 3).map((event, index) => <Link className="m-card m-company-event" href={resourceHref(event)} onClick={() => visit(event)} key={event.id}>
          {index === 0 ? <CompanyLogo ticker={company.ticker} size={38}/> : <span className={`m-company-event-icon m-company-event-icon-${index}`}><MIcon name={index === 1 ? 'spark' : 'globe'} size={22}/></span>}
          <div><h3>{event.title}</h3>{event.summary && <p>{event.summary}</p>}</div><aside><time>{event.published_at ? (['date', 'date_only'].includes(event.publication_precision) ? date(event.published_at, 'date') : relativeTime(event.published_at, value.locale)) : t('날짜 확인 전', 'Date unavailable')}</time><span className={`m-pill m-type-${event.category}`}>{eventLabel(event.category, value.locale)}</span></aside>
        </Link>)}</div>
        {!data.events.length && <EmptyState title={t('아직 주요 변화가 없습니다', 'No published changes yet')} description={t('새로 확인된 변화가 여기에 표시됩니다.', 'Newly verified changes will appear here.')}/>}
      </section>

      <section className="m-company-section"><SectionTitle title={t('타임라인 미리보기', 'Timeline preview')} href={`/companies/${encodeURIComponent(id)}/timeline`}/>
        <div className="m-company-timeline">{data.events.slice(0, 3).map((event, index) => <Link href={resourceHref(event)} onClick={() => visit(event)} className={index === 0 ? 'is-latest' : ''} key={event.id}>
          <i/><time>{date(event.published_at, event.publication_precision)}</time><div><strong>{event.title}</strong>{event.summary && <p>{event.summary}</p>}</div>
        </Link>)}</div>
        {!data.events.length && <EmptyState title={t('확인된 변화가 쌓이면 표시됩니다', 'Verified changes will appear here')} href={`/companies/${encodeURIComponent(id)}/timeline`} label={t('기업 타임라인 보기', 'View company timeline')}/>}
      </section>

      <section className="m-company-section"><SectionTitle title={t('모니터링 포인트', 'Monitoring points')} href={`/saved?kind=event&company=${encodeURIComponent(id)}`}/>
        {data.events.length > 0 ? <><p className="m-company-monitor-note m-muted">{t('중요한 변화를 저장하고 다시 확인하세요.', 'Save important changes to follow up.')}</p><div className="m-card m-company-monitor">{data.events.slice(0, 3).map(event => <SavedMonitoringRow item={event} key={event.id}/>)}</div></> : <EmptyState title={t('모니터링할 변화가 없습니다', 'No changes to monitor yet')} description={t('기업 변화가 공개되면 저장하고 추적할 수 있어요.', 'Save and revisit company changes once they are published.')}/>}
      </section>

      <section className="m-company-section m-company-documents-section"><SectionTitle title={t('관련 문서 / 근거 자료', 'Documents / evidence')} href={`/search?q=${query}&kind=document`}/>
        <div className="m-company-documents">{data.documents.slice(0, 3).map((document, index) => <Link className={`m-card m-company-document m-company-document-${index}`} href={resourceHref(document)} onClick={() => visit(document)} key={document.kind + document.id}>
          <span><MIcon name="file" size={18}/></span><div><strong>{document.title}</strong><small>{document.category} · {date(document.published_at, document.publication_precision)}</small></div><MIcon name="chevron" size={11}/>
        </Link>)}</div>
        {!data.documents.length && <EmptyState title={t('수집된 문서가 없습니다', 'No collected documents')} href="/sources" label={t('데이터 출처 확인', 'View data sources')}/>}
      </section>

      {metricsOpen && <Dialog title={t('핵심 지표 / 원문 근거', 'Key metrics / source evidence')} onClose={() => setMetricsOpen(false)}>
        <div className="m-company-facts-dialog">{data.facts.length ? data.facts.map(fact => <article className="m-card" key={fact.id}><h3>{fact.field}</h3><strong>{fact.value_raw ?? t('원문 확인', 'View source')} {fact.unit}</strong><p className="m-muted">{[fact.period, fact.basis].filter(Boolean).join(' · ')}</p>{fact.quote && <blockquote>{fact.quote}</blockquote>}<Link href={`/events/${encodeURIComponent(fact.event_id)}?panel=evidence`} className="m-button m-button-secondary" onClick={() => setMetricsOpen(false)}>{t('근거 보기', 'View evidence')}<MIcon name="chevron" size={13}/></Link></article>) : <EmptyState title={t('검증된 지표가 없습니다', 'No verified metrics available')} description={t('원문과 회계기간이 확인된 수치가 표시됩니다.', 'Metrics appear with confirmed sources and reporting periods.')}/>}
        </div>
      </Dialog>}
      {chartOpen && <Dialog title={`${title} ${t('주가 추이', 'price history')}`} onClose={() => setChartOpen(false)}><div className="m-company-chart-dialog">
        <label className="m-field">{t('조회 기간', 'Period')}<select value={period} onChange={event => setPeriod(event.target.value)}><option value="1m">{t('1개월', '1 month')}</option><option value="3m">{t('3개월', '3 months')}</option><option value="6m">{t('6개월', '6 months')}</option><option value="1y">{t('1년', '1 year')}</option></select></label>
        <LoadState loading={quotes.loading}/>{!quotes.loading && <SmallChart values={quote?.history.map(point => point.close) ?? []}/>}
        {quote ? <p className="m-muted">{quote.source} · {date(quote.as_of)} · {quote.currency}</p> : <EmptyState title={t('주가 자료를 불러오지 못했어요', 'Price history unavailable')} href="/us" label={t('연결 상태 확인', 'View connection status')}/>}
      </div></Dialog>}
    </>}
    {positionOpen && <PositionDialog id={id} onClose={() => setPositionOpen(false)} onSaved={() => {setPositionOpen(false); result.reload();}}/>}
  </div>;
}
