'use client';

import {useEffect, useRef, useState} from 'react';
import './tradingview-news.css';

/** Embed only: article text is neither scraped nor reused as reviewed evidence. */
export function TradingViewNews({autoLoad = true}: {autoLoad?: boolean}) {
  const host = useRef<HTMLDivElement>(null);
  const [enabled, setEnabled] = useState(autoLoad);
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    if (!enabled) return;
    const container = host.current;
    if (!container) return;
    let active = true;
    const widget = document.createElement('div');
    widget.className = 'tradingview-widget-container__widget';
    const script = document.createElement('script');
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-timeline.js';
    script.async = true;
    script.textContent = JSON.stringify({feedMode: 'all_symbols', colorTheme: 'light',
      isTransparent: false, displayMode: 'regular', width: '100%', height: 520, locale: 'en'});
    const timer = window.setTimeout(() => {if (active) setState('error');}, 20000);
    const observer = new MutationObserver(() => {
      const frame = container.querySelector('iframe');
      if (frame) {
        frame.title = 'TradingView 주요 뉴스';
        // A frame is an embed-load signal, not proof of article availability.
        window.clearTimeout(timer);
        if (active) setState('ready');
      }
    });
    observer.observe(container, {childList: true, subtree: true});
    script.onerror = () => {if (active) {window.clearTimeout(timer); setState('error');}};
    container.replaceChildren(widget, script);
    return () => {
      active = false;
      observer.disconnect();
      window.clearTimeout(timer);
      script.onerror = null;
      container.replaceChildren();
    };
  }, [revision, enabled]);

  return <section className="sb-news" aria-label="TradingView 주요 뉴스">
    <header><h2>주요 뉴스</h2><a href="/news">뉴스 페이지 ↗</a></header>
    <p>TradingView Top Stories는 현재 영어로 제공됩니다. 한국어 뉴스는 별도 공급자 연결이 필요합니다.</p>
    {!enabled && <button type="button" onClick={() => setEnabled(true)}>뉴스 불러오기</button>}
    {enabled && state === 'loading' && <p role="status">뉴스 위젯을 불러오는 중…</p>}
    {enabled && state === 'error' && <div role="status"><p>뉴스를 표시하지 못했습니다. 아래 TradingView 링크에서 확인할 수 있습니다.</p>
      <button type="button" onClick={() => {setState('loading'); setRevision(n => n + 1);}}>다시 시도</button></div>}
    <div className="tradingview-widget-container sb-news-widget" hidden={!enabled} ref={host}/>
    <div className="tradingview-widget-copyright"><a href="https://kr.tradingview.com/news/" target="_blank" rel="noopener noreferrer"><span className="blue-text">TradingView에서 모든 뉴스 확인</span></a><span className="trademark"> — TradingView 제공</span></div>
    <p className="sb-news-note">외부 뉴스 · SignalBrief가 검토한 공시 분석과 별도로 제공됩니다.</p>
  </section>;
}
