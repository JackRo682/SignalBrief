'use client';

import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {useEffect, useRef, useState, type ComponentProps} from 'react';
import {z} from 'zod';
import {useAuth} from '@/components/auth';
import {workspace} from '@/workspace/client';
import {catalogSchema, searchesSchema, resourceKind, resourceHref, type Resource} from '@/workspace/contracts';
import {useQuotes} from '@/workspace/market';
import {usePrefs} from '@/workspace/preferences';
import {useData, useMutation} from '@/workspace/ui';
import {ActionNotice, CompanyLogo, Dialog, EmptyState, LoadState, MIcon, SectionTitle, SmallChart, formatMoney} from '@/mobile/ui';
import './search.css';

type Quote = ReturnType<typeof useQuotes>['quotes'][number];
type Kind = z.infer<typeof resourceKind> | '';
type SearchProps = {
  initial: string;
  initialKind: string;
  initialMarket?: string;
  initialDays?: number;
  initialOffset?: number;
  initialSort?: 'relevance' | 'newest';
};
type SearchPatch = {q: string; kind: Kind; market: string; days: number; offset: number; sort: 'relevance' | 'newest'};

const companyNames: Record<string, [string, string]> = {
  NVDA: ['엔비디아', 'NVIDIA'], AAPL: ['애플', 'Apple'], TSLA: ['테슬라', 'Tesla'], MSFT: ['마이크로소프트', 'Microsoft'],
};

function companyLabel(item: Resource, locale: 'ko' | 'en') {
  return companyNames[item.ticker]?.[locale === 'ko' ? 0 : 1] ?? item.company_name;
}

function SearchHeading({results = false}: {results?: boolean}) {
  const {text: t, value} = usePrefs();
  const today = new Intl.DateTimeFormat(value.locale === 'ko' ? 'ko-KR' : 'en-US', {
    timeZone: value.timezone, month: 'long', day: 'numeric', weekday: 'short',
  }).format(new Date());
  return <header className={`m-search-heading ${results ? 'is-results' : ''}`}>
    <div><h1>{results ? t('검색 결과', 'Search results') : t('검색 / 탐색', 'Search / explore')}</h1>
      {!results && <p>{t('관심 있는 기업, 키워드, 산업을 검색해보세요.', 'Search companies, keywords and industries.')}</p>}
    </div>
    <aside><time>{today}</time><p>{results ? <>{t('좋은 정보가', 'Better information')}<br/>{t('더 나은 판단을 만듭니다.', 'for informed decisions.')}</> : <>{t('좋은 질문이', 'A good question')}<br/>{t('좋은 투자의 시작입니다.', 'is a thoughtful start.')}</>}</p></aside>
  </header>;
}

function SearchInput({initial = '', submit, onFilter, filtered = false, results = false}: {
  initial?: string; submit: (query: string) => void; onFilter: () => void; filtered?: boolean; results?: boolean;
}) {
  const {text: t} = usePrefs();
  const [query, setQuery] = useState(initial);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => setQuery(initial), [initial]);
  return <div className="m-search-input-row">
    <form className={`m-search-input ${results ? 'is-results' : ''}`} role="search" onSubmit={event => {event.preventDefault(); submit(query.trim());}}>
      <button type="submit" className="m-icon-button" aria-label={t('검색', 'Search')}><MIcon name="search" size={21}/></button>
      <input ref={input} aria-label={t('기업명 또는 키워드 검색', 'Company or keyword search')} value={query} maxLength={100}
        enterKeyHint="search" placeholder={t('기업명 또는 키워드를 검색하세요', 'Search companies or keywords')}
        onChange={event => setQuery(event.target.value)}/>
      {query && <button type="button" className="m-icon-button m-search-clear" aria-label={t('검색어 지우기', 'Clear search')}
        onClick={() => {setQuery(''); input.current?.focus();}}><MIcon name="close" size={14}/></button>}
    </form>
    <button type="button" className={`m-card m-search-filter-button ${filtered ? 'is-active' : ''}`} onClick={onFilter}
      aria-label={t('검색 필터 열기', 'Open search filters')} aria-haspopup="dialog"><MIcon name="filter" size={22}/>{filtered && <i/>}</button>
  </div>;
}

const searchThemes: {ko: string; en: string; query: string; icon: ComponentProps<typeof MIcon>['name']; color: string}[] = [
  {ko: '반도체', en: 'Chips', query: 'semiconductor', icon: 'chip', color: 'purple'},
  {ko: '소프트웨어', en: 'Software', query: 'software', icon: 'monitor', color: 'blue'},
  {ko: '하드웨어', en: 'Hardware', query: 'hardware', icon: 'menu', color: 'green'},
  {ko: '자동차', en: 'Auto', query: 'automotive', icon: 'car', color: 'red'},
  {ko: '헬스케어', en: 'Health', query: 'healthcare', icon: 'plus', color: 'green'},
  {ko: '금융', en: 'Finance', query: 'financial', icon: 'pie', color: 'gold'},
  {ko: '에너지', en: 'Energy', query: 'energy', icon: 'trend', color: 'blue'},
];

export default function MobileExplore() {
  const {token} = useAuth();
  const {text: t, value} = usePrefs();
  const router = useRouter();
  const [market, setMarket] = useState('');
  const [filterOpen, setFilterOpen] = useState(false);
  const [rotation, setRotation] = useState(0);
  const companies = useData({action: 'catalog', p: {kind: 'company', limit: 50, market}}, catalogSchema);
  const sources = useData({action: 'catalog', p: {kind: 'document', limit: 50, market}}, catalogSchema);
  const recent = useData({action: 'searches', p: {}}, searchesSchema);
  const action = useMutation();
  const items = companies.data?.items ?? [];
  const marketData = useQuotes(items.slice(0, 4).map(item => item.ticker));
  const search = (query: string) => {
    const params = new URLSearchParams({q: query});
    if (market) params.set('market', market);
    router.push(`/search?${params}`);
  };
  const availableTerms = [...new Map([
    ...items.map(item => [item.ticker, {query: item.ticker, label: companyLabel(item, value.locale)}] as const),
    ...(sources.data?.items ?? []).filter(item => item.category).map(item => [item.category, {query: item.category, label: item.category}] as const),
  ]).values()];
  const suggestions = availableTerms.length ? Array.from({length: Math.min(6, availableTerms.length)}, (_, index) => availableTerms[(rotation + index) % availableTerms.length]) : [];

  return <div className="m-search-page m-explore-page">
    <SearchHeading/>
    <SearchInput submit={search} onFilter={() => setFilterOpen(true)} filtered={Boolean(market)}/>
    {items.length > 0 && <div className="m-search-chips" aria-label={t('기업 바로 검색', 'Quick company search')}>
      {items.slice(0, 5).map(item => <button key={item.id} className="m-pill" onClick={() => search(item.ticker)}>{companyLabel(item, value.locale)}</button>)}
    </div>}

    <section className="m-search-section m-search-recents">
      <SectionTitle title={t('최근 검색어', 'Recent searches')} action={<button disabled={action.busy || !recent.data?.length}
        onClick={() => void action.run(async () => {await workspace(token, {action: 'searches_clear', p: {}}, z.unknown()); recent.reload();})}>{t('전체 삭제', 'Clear all')}</button>}/>
      <ActionNotice action={action}/><LoadState loading={recent.loading} error={recent.error} retry={recent.reload}/>
      {recent.data?.length ? <div className="m-card m-search-history-grid">{recent.data.map(entry => <div key={entry.query} className="m-search-history-row">
        <button className="m-search-history-query" onClick={() => search(entry.query)}><MIcon name="clock" size={19}/><span>{entry.query}</span></button>
        <button className="m-icon-button" disabled={action.busy} aria-label={`${entry.query} ${t('검색 기록 삭제', 'remove from search history')}`}
          onClick={() => void action.run(async () => {await workspace(token, {action: 'search_delete', p: {query: entry.query}}, z.unknown()); recent.reload();})}><MIcon name="close" size={14}/></button>
      </div>)}</div> : !recent.loading && !recent.error && <EmptyState title={t('최근 검색어가 없습니다', 'No recent searches')}
        description={value.history_enabled ? t('궁금한 기업이나 키워드를 검색해보세요.', 'Search for a company or keyword.') : t('기록 저장을 켜면 최근 검색어를 다시 볼 수 있어요.', 'Enable history to return to recent searches.')}
        href={value.history_enabled ? undefined : '/settings/account'} label={t('기록 설정', 'History settings')}/>}
    </section>

    <section className="m-search-section m-search-suggestions">
      <SectionTitle title={t('추천 검색어', 'Suggested searches')} action={<button className="m-search-refresh" disabled={companies.loading || sources.loading}
        onClick={() => {setRotation(previous => previous + 1); companies.reload(); sources.reload();}}><MIcon name="refresh" size={16}/>{t('새로운 추천', 'Refresh')}</button>}/>
      <LoadState loading={companies.loading} error={companies.error} retry={companies.reload}/>
      <div className="m-search-suggestion-grid">{suggestions.map((term, index) => <button className="m-search-suggestion" key={term.query} onClick={() => search(term.query)}>
        <span className="m-search-number">{index + 1}</span><span>{term.label}</span><MIcon name="chevron" size={13}/>
      </button>)}</div>
      {!companies.loading && !suggestions.length && <EmptyState title={t('검색어를 준비하고 있어요', 'No suggestions available')} description={t('연결된 기업과 수집된 공시에서 검색어를 표시합니다.', 'Suggestions come from connected companies and collected filings.')}/>}
    </section>

    <section className="m-search-section m-search-companies">
      <SectionTitle title={t('지원 기업', 'Companies to explore')} href={`/search?kind=company${market ? `&market=${encodeURIComponent(market)}` : ''}`}/>
      <div className="m-search-company-grid">{items.slice(0, 4).map(item => {
        const quote = marketData.quotes.find(candidate => candidate.symbol === item.ticker);
        return <Link className="m-card m-search-company-tile" key={item.id} href={resourceHref(item)}>
          <CompanyLogo ticker={item.ticker} size={38}/><span className="m-search-ticker">{item.ticker}</span><strong>{companyLabel(item, value.locale)}</strong>
          <b className="m-search-price">{quote?.price == null ? '—' : formatMoney(quote.price, quote.currency, value.locale)}</b>
          <span className={`m-search-movement ${quote?.change_pct != null && quote.change_pct < 0 ? 'is-negative' : ''}`}>
            {quote?.change_pct == null ? <span className="m-muted">{t('시세 확인 전', 'Quote unavailable')}</span> : <>{quote.change_pct < 0 ? '▼' : '▲'} {Math.abs(quote.change_pct).toFixed(2)}%</>}
          </span>
        </Link>;
      })}</div>
      {!companies.loading && !items.length && !companies.error && <EmptyState title={t('표시할 기업이 없습니다', 'No companies available')} href="/sources" label={t('지원 범위 확인', 'View coverage')}/>}
    </section>

    <section className="m-search-section m-search-sectors">
      <SectionTitle title={t('산업 키워드로 탐색하기', 'Explore industry keywords')} href="/search"/>
      <div className="m-search-sector-grid">{searchThemes.map(theme => <button key={theme.query} className={`m-search-sector ${theme.color}`} onClick={() => search(theme.query)}>
        <MIcon name={theme.icon} size={23}/><span>{t(theme.ko, theme.en)}</span>
      </button>)}</div>
      <p className="m-search-coverage m-muted">{t('수집된 원문의 키워드를 검색합니다.', 'Searches keywords in collected sources.')}</p>
    </section>

    {filterOpen && <Dialog title={t('검색 필터', 'Search filters')} onClose={() => setFilterOpen(false)}>
      <div className="m-search-filter-dialog"><label>{t('시장', 'Market')}<select className="m-field" value={market} onChange={event => setMarket(event.target.value)}>
        <option value="">{t('전체 시장', 'All markets')}</option>{(companies.data?.markets ?? []).map(item => <option key={item}>{item}</option>)}
      </select></label><button className="m-button" onClick={() => setFilterOpen(false)}>{t('적용', 'Apply')}</button></div>
    </Dialog>}
  </div>;
}

function SearchResultCard({item, quote}: {item: Resource; quote?: Quote}) {
  const {token} = useAuth();
  const {text: t, value, date} = usePrefs();
  const track = () => {if (value.history_enabled) void workspace(token, {action: 'visit', p: {kind: item.kind, id: item.id}}, z.unknown()).catch(() => {});};
  if (item.kind === 'company') return <Link href={resourceHref(item)} onClick={track} className="m-card m-search-result-company">
    <CompanyLogo ticker={item.ticker} size={52}/><div className="m-search-result-company-body"><div className="m-search-company-name"><strong>{companyLabel(item, value.locale)}</strong><span>{item.ticker}</span></div>
      <p>{item.summary || item.title}</p><small>{t('공시, 주요 변화와 기업 타임라인을 확인하세요.', 'Explore filings, changes and company history.')}</small>
      <div className="m-search-result-tags"><span>{item.market}</span><span>SEC EDGAR</span></div></div>
    <div className="m-search-result-company-quote"><div className={`m-search-quote-box ${quote?.change_pct != null && quote.change_pct < 0 ? 'is-negative' : ''}`}>
      <SmallChart values={quote?.history.map(point => point.close) ?? []}/><strong>{quote?.price == null ? '—' : formatMoney(quote.price, quote.currency, value.locale)}</strong>
      <small>{quote?.change_pct == null ? t('시세 확인 전', 'Quote unavailable') : `${quote.change_pct < 0 ? '▼' : '▲'} ${Math.abs(quote.change_pct).toFixed(2)}%`}</small></div>
      <span className="m-search-detail-link">{t('자세히 보기', 'View details')} <MIcon name="chevron" size={12}/></span>
    </div>
  </Link>;

  const published = item.published_at ? new Date(item.published_at) : null;
  const validDate = published && Number.isFinite(+published) ? published : null;
  const dateOptions = {timeZone: ['date', 'date_only'].includes(item.publication_precision) ? 'UTC' : value.timezone};
  const monthDay = validDate ? new Intl.DateTimeFormat(value.locale === 'ko' ? 'ko-KR' : 'en-US', {...dateOptions, month: 'short', day: 'numeric'}).format(validDate) : t('날짜', 'Date');
  const weekday = validDate ? new Intl.DateTimeFormat(value.locale === 'ko' ? 'ko-KR' : 'en-US', {...dateOptions, weekday: 'short'}).format(validDate) : t('확인 전', 'unavailable');
  const document = item.kind !== 'event';
  return <Link href={resourceHref(item)} onClick={track} className={`m-card m-search-result-resource ${document ? 'is-document' : 'is-event'}`}>
    {document ? <span className="m-search-document-icon"><MIcon name="file" size={29}/><b>{item.source_url && /\.pdf(?:\?|$)/i.test(item.source_url) ? 'PDF' : 'DOC'}</b></span> : <span className="m-search-date-tile"><strong>{monthDay}</strong><small>({weekday})</small></span>}
    <div className="m-search-result-resource-body">{!document && <span className="m-pill m-search-category">{item.category}</span>}<h3>{item.title}</h3>
      {document && <p className="m-search-document-meta">{companyLabel(item, value.locale)} <span>·</span> {date(item.published_at, item.publication_precision)} <span>·</span> {item.category}</p>}
      {item.summary && <p className="m-search-resource-summary">{item.summary}</p>}
    </div><MIcon name="chevron" size={15}/>
  </Link>;
}

export function MobileSearchResults({initial, initialKind, initialMarket = '', initialDays = 0, initialOffset = 0, initialSort = 'relevance'}: SearchProps) {
  const {token} = useAuth();
  const {text: t, value} = usePrefs();
  const router = useRouter();
  const parsedKind = resourceKind.safeParse(initialKind);
  const kind: Kind = parsedKind.success ? parsedKind.data : '';
  const [filterOpen, setFilterOpen] = useState(false);
  const filters = {q: initial, market: initialMarket, days: initialDays, sort: initialSort};
  const result = useData({action: 'catalog', p: {...filters, kind, offset: kind ? initialOffset : 0, limit: kind ? 12 : 1}}, catalogSchema);
  const companies = useData(kind ? null : {action: 'catalog', p: {...filters, kind: 'company', limit: 3}}, catalogSchema);
  const events = useData(kind ? null : {action: 'catalog', p: {...filters, kind: 'event', limit: 3}}, catalogSchema);
  const documents = useData(kind ? null : {action: 'catalog', p: {...filters, kind: 'document', limit: 3}}, catalogSchema);
  const companyItems = kind ? result.data?.items.filter(item => item.kind === 'company') ?? [] : companies.data?.items ?? [];
  const quoteData = useQuotes(companyItems.map(item => item.ticker));
  const set = (patch: Partial<SearchPatch>) => {
    const next: SearchPatch = {q: initial, kind, market: initialMarket, days: initialDays, offset: 0, sort: initialSort, ...patch};
    const params = new URLSearchParams();
    Object.entries(next).forEach(([key, item]) => {if (item !== '' && item !== 0) params.set(key, String(item));});
    router.push(`/search?${params}`);
  };
  const count = (category: Kind) => category === '' ? Object.values(result.data?.counts ?? {}).reduce((sum, item) => sum + item, 0)
    : category === 'document' ? (result.data?.counts.document ?? 0) + (result.data?.counts.filing ?? 0) : result.data?.counts[category] ?? 0;
  useEffect(() => {
    if (initial.trim() && token && value.history_enabled) void workspace(token, {action: 'search_record', p: {query: initial}}, z.unknown()).catch(() => {});
  }, [initial, token, value.history_enabled]);
  const groups = [
    {kind: 'company' as const, label: t('기업', 'Companies'), state: companies},
    {kind: 'event' as const, label: t('이벤트', 'Events'), state: events},
    {kind: 'document' as const, label: t('문서', 'Documents'), state: documents},
  ];
  const filterFields = <div className="m-search-filter-dialog">
    <label>{t('시장', 'Market')}<select className="m-field" value={initialMarket} onChange={event => set({market: event.target.value})}>
      <option value="">{t('전체 시장', 'All markets')}</option>{(result.data?.markets ?? []).map(market => <option key={market}>{market}</option>)}
    </select></label>
    <label>{t('기간', 'Date range')}<select className="m-field" value={initialDays} onChange={event => set({days: Number(event.target.value)})}>
      <option value={0}>{t('전체 기간', 'All time')}</option><option value={7}>{t('최근 1주일', 'Last week')}</option><option value={30}>{t('최근 1개월', 'Last month')}</option>
      <option value={90}>{t('최근 3개월', 'Last 3 months')}</option><option value={365}>{t('최근 1년', 'Last year')}</option>
    </select></label>
    <label>{t('유형', 'Type')}<select className="m-field" value={kind} onChange={event => set({kind: event.target.value as Kind})}>
      <option value="">{t('전체', 'All')}</option><option value="company">{t('기업', 'Companies')}</option><option value="event">{t('이벤트', 'Events')}</option><option value="document">{t('문서', 'Documents')}</option><option value="filing">{t('공시 원문', 'Original filings')}</option>
    </select></label>
    <label>{t('정렬', 'Sort')}<select className="m-field" value={initialSort} onChange={event => set({sort: event.target.value as 'relevance' | 'newest'})}>
      <option value="relevance">{t('관련도순', 'Relevance')}</option><option value="newest">{t('최신순', 'Newest')}</option>
    </select></label>
    <div className="m-search-dialog-actions"><button className="m-button m-button-secondary" onClick={() => set({market: '', days: 0, kind: '', sort: 'relevance'})}>{t('초기화', 'Reset')}</button><button className="m-button" onClick={() => setFilterOpen(false)}>{t('완료', 'Done')}</button></div>
  </div>;

  return <div className="m-search-page m-search-results-page">
    <SearchHeading results/><SearchInput initial={initial} submit={query => set({q: query})} onFilter={() => setFilterOpen(true)} filtered={Boolean(initialMarket || initialDays || kind)} results/>
    <nav className="m-tabs m-search-tabs" aria-label={t('검색 결과 유형', 'Search result types')}>
      {groups.reduce<{kind: Kind; label: string}[]>((list, group) => [...list, {kind: group.kind, label: group.label}], [{kind: '', label: t('전체', 'All')}]).map(tab => <button key={tab.kind}
        className={kind === tab.kind || tab.kind === 'document' && kind === 'filing' ? 'active' : ''} aria-pressed={kind === tab.kind || tab.kind === 'document' && kind === 'filing'} onClick={() => set({kind: tab.kind})}>{tab.label}</button>)}
    </nav>
    <div className="m-search-inline-filters">
      <label className="m-card"><MIcon name="trend" size={18}/><span>{t('시장', 'Market')}</span><select aria-label={t('시장 필터', 'Market filter')} value={initialMarket} onChange={event => set({market: event.target.value})}><option value="">{t('전체', 'All')}</option>{(result.data?.markets ?? []).map(market => <option key={market}>{market}</option>)}</select></label>
      <label className="m-card"><MIcon name="calendar" size={18}/><span>{t('기간', 'Period')}</span><select aria-label={t('기간 필터', 'Date range filter')} value={initialDays} onChange={event => set({days: Number(event.target.value)})}><option value={0}>{t('전체 기간', 'All time')}</option><option value={7}>{t('1주', '1 week')}</option><option value={30}>{t('1개월', '1 month')}</option><option value={90}>{t('3개월', '3 months')}</option><option value={365}>{t('1년', '1 year')}</option></select></label>
      <label className="m-card"><MIcon name="file" size={18}/><span>{t('유형', 'Type')}</span><select aria-label={t('유형 필터', 'Type filter')} value={kind} onChange={event => set({kind: event.target.value as Kind})}><option value="">{t('전체', 'All')}</option><option value="company">{t('기업', 'Companies')}</option><option value="event">{t('이벤트', 'Events')}</option><option value="document">{t('문서', 'Documents')}</option><option value="filing">{t('공시', 'Filings')}</option></select></label>
    </div>
    <LoadState loading={result.loading} error={result.error} retry={result.reload}/>
    {!kind ? groups.map(group => <section className="m-search-section m-search-result-group" key={group.kind}>
      <SectionTitle title={`${group.label}${result.data ? `  ${count(group.kind)}${t('개', '')}` : ''}`} action={<button onClick={() => set({kind: group.kind})}>{t('전체 보기', 'View all')} <MIcon name="chevron" size={12}/></button>}/>
      <LoadState loading={group.state.loading} error={group.state.error} retry={group.state.reload}/>
      <div className="m-stack">{group.state.data?.items.map(item => <SearchResultCard key={item.kind + item.id} item={item} quote={quoteData.quotes.find(quote => quote.symbol === item.ticker)}/>)}</div>
      {group.state.data && !group.state.data.items.length && <EmptyState title={t(`${group.label} 검색 결과가 없습니다`, `No ${group.label.toLowerCase()} found`)}/>}
    </section>) : <section className="m-search-section m-search-result-group">
      <SectionTitle title={`${groups.find(group => group.kind === kind || group.kind === 'document' && kind === 'filing')?.label ?? t('검색 결과', 'Results')}${result.data ? `  ${result.data.total}${t('개', '')}` : ''}`}/>
      <div className="m-stack">{result.data?.items.map(item => <SearchResultCard key={item.kind + item.id} item={item} quote={quoteData.quotes.find(quote => quote.symbol === item.ticker)}/>)}</div>
      {result.data && !result.data.items.length && <EmptyState title={t('검색 결과가 없습니다', 'No results found')} description={t('검색어나 필터를 변경해보세요.', 'Try another query or change the filters.')} href="/explore" label={t('기업 탐색하기', 'Explore companies')}/>}
      {result.data && (initialOffset > 0 || result.data.next_offset !== null) && <nav className="m-search-pagination" aria-label={t('검색 결과 페이지', 'Result pages')}>
        <button className="m-button m-button-secondary" disabled={initialOffset === 0} onClick={() => set({offset: Math.max(0, initialOffset - 12)})}>{t('이전', 'Previous')}</button><span>{Math.floor(initialOffset / 12) + 1}</span>
        <button className="m-button m-button-secondary" disabled={result.data.next_offset === null} onClick={() => set({offset: result.data?.next_offset ?? 0})}>{t('다음', 'Next')}</button>
      </nav>}
    </section>}
    {filterOpen && <Dialog title={t('검색 필터', 'Search filters')} onClose={() => setFilterOpen(false)}>{filterFields}</Dialog>}
  </div>;
}
