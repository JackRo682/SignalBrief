'use client';

import {useEffect, useRef, useState} from 'react';
import {usePrefs} from '@/workspace/preferences';
import './market-widget.css';

const scriptUrl = 'https://s3.tradingview.com/external-embedding/embed-widget-symbol-overview.js';
// Identifiers only: values, trading times and availability always come from the hosted widget.
const indices = ['KRX:KOSPI', 'KRX:KOSDAQ', 'NASDAQ:IXIC', 'SP:SPX'];
export function widgetSymbol(ticker: string, market: string): string | null {
  if (/^\d{6}$/.test(ticker)) return `KRX:${ticker}`;
  if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(ticker)) return null;
  const exchange = market.toUpperCase();
  if (['NASDAQ', 'NYSE', 'AMEX'].includes(exchange)) return `${exchange}:${ticker}`;
  // These are the existing tracked SEC issuers; do not guess exchanges for arbitrary tickers.
  if (['AAPL', 'MSFT', 'NVDA', 'TSLA'].includes(ticker)) return `NASDAQ:${ticker}`;
  return null;
}

/** Display-only embed. Never read iframe contents, proxy prices, or reuse them in calculations. */
export function MarketWidget({ticker, market = ''}: {ticker?: string; market?: string}) {
  const {text: t, value} = usePrefs();
  const symbol = ticker ? widgetSymbol(ticker, market) : null;
  const identity = ticker ? symbol ?? '' : indices.join(',');
  const [enabledFor, setEnabledFor] = useState('');
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<'loading' | 'embedded' | 'error'>('loading');
  const host = useRef<HTMLDivElement>(null);
  const enabled = !!identity && enabledFor === identity;
  const locale = value.locale === 'ko' ? 'kr' : 'en';
  useEffect(() => {
    if (!enabled || !host.current) return;
    const container = host.current;
    const widget = document.createElement('div');
    widget.className = 'tradingview-widget-container__widget';
    const script = document.createElement('script');
    script.src = scriptUrl;
    script.async = true;
    script.textContent = JSON.stringify({symbols: identity.split(',').map(item => [item + '|1D']),
      chartOnly: false, width: '100%', height: 380, locale, colorTheme: 'light',
      autosize: false, showVolume: false, hideDateRanges: false, hideMarketStatus: false,
      hideSymbolLogo: false, dateRanges: ['1m|30', '3m|60', '12m|1D'],
      isTransparent: false, scalePosition: 'right', scaleMode: 'Normal'});
    let live = true;
    const timer = window.setTimeout(() => {if (live) setState('error');}, 20000);
    const observer = new MutationObserver(() => {
      const frame = container.querySelector('iframe');
      if (frame) {
        frame.title = 'TradingView market chart';
        window.clearTimeout(timer);
        if (live) setState('embedded'); // This does not certify the symbol's availability.
      }
    });
    observer.observe(container, {childList: true, subtree: true});
    script.onerror = () => {if (live) {window.clearTimeout(timer); setState('error');}};
    container.replaceChildren(widget, script);
    return () => {live = false; observer.disconnect(); window.clearTimeout(timer);
      script.onerror = null; container.replaceChildren();};
  }, [enabled, identity, revision, locale]);
  if (ticker && !symbol) return null;
  const href = symbol ? `https://www.tradingview.com/symbols/${symbol.replace(':', '-')}/` : 'https://www.tradingview.com/markets/indices/';
  return <section className="sb-market-widget" aria-label={t('외부 시세 차트', 'External market chart')}>
    <h3>{t('외부 시세 차트', 'External market chart')}</h3>
    <p>{t('TradingView 제공 · 지연 시간과 지원 여부는 위젯에 표시됩니다. 일부 종목은 외부 사이트에서만 제공됩니다.',
      'Provided by TradingView. Delays and availability appear in the widget. Some symbols are available only on the provider site.')}</p>
    {!enabled && <button type="button" onClick={() => {setState('loading'); setEnabledFor(identity);}}>{t('외부 차트 불러오기', 'Load external chart')}</button>}
    {enabled && state === 'loading' && <p role="status">{t('차트를 불러오는 중…', 'Loading chart…')}</p>}
    {enabled && state === 'error' && <div role="status"><p>{t('차트를 불러오지 못했습니다. 공급자 링크에서 확인하세요.', 'The chart could not be loaded. Use the provider link.')}</p>
      <button type="button" onClick={() => {setState('loading'); setRevision(n => n + 1);}}>{t('다시 시도', 'Retry')}</button></div>}
    <div ref={host} hidden={!enabled} className="tradingview-widget-container sb-market-widget-frame"/>
    <div className="tradingview-widget-copyright"><a href={href} target="_blank" rel="noopener noreferrer nofollow">{t('TradingView에서 확인', 'View on TradingView')}</a> — TradingView</div>
  </section>;
}
