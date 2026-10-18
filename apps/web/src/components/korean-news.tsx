'use client';

import {useEffect, useRef, useState} from 'react';
import {newsResponse, newsTopics, type NewsResponse} from '@/lib/news-contract';
import './korean-news.css';

const dateLabel = (value:string) => new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',dateStyle:'medium',timeStyle:'short'}).format(new Date(value));
export function KoreanNews() {
  const [topic,setTopic] = useState<string>(newsTopics[0]);
  const [result,setResult] = useState<NewsResponse|null>(null);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  const controller = useRef<AbortController|null>(null);
  useEffect(()=>()=>{controller.current?.abort();},[]);
  async function search() {
    controller.current?.abort();
    const abort = new AbortController(); controller.current=abort;
    setBusy(true); setError(''); setResult(null);
    try {
      const response = await fetch(`/api/news?q=${encodeURIComponent(topic)}`,{cache:'no-store',signal:abort.signal});
      if (!response.ok) {
        setError(response.status === 429 ? '검색 요청이 많습니다. 잠시 후 다시 시도해 주세요.' : '뉴스 검색에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.');
        return;
      }
      const parsed = newsResponse.parse(await response.json());
      if (!abort.signal.aborted) setResult(parsed);
    } catch {if (!abort.signal.aborted) setError('뉴스 응답을 확인하지 못했습니다. 다시 시도해 주세요.');}
    finally {if (!abort.signal.aborted) setBusy(false);}
  }
  return <section className="sb-korean-news" aria-label="한국어 뉴스 검색">
    <header><h2>한국어 뉴스 검색</h2><a href="/news">뉴스 페이지 ↗</a></header>
    <p>주제를 선택하면 네이버™ 뉴스 검색결과를 최신순으로 표시합니다.</p>
    <form onSubmit={event=>{event.preventDefault();void search();}}>
      <label>검색 주제<select value={topic} disabled={busy} onChange={event=>{controller.current?.abort();setTopic(event.target.value);setResult(null);setError('');}}>
        {newsTopics.map(value=><option key={value}>{value}</option>)}
      </select></label>
      <button type="submit" disabled={busy}>{busy ? '검색 중…' : '뉴스 검색'}</button>
    </form>
    {busy && <p role="status">뉴스 검색결과를 불러오는 중…</p>}
    {error && <p role="alert">{error}</p>}
    {result && <div aria-live="polite">
      <p>{result.query} · 조회 {dateLabel(result.retrievedAt)} (한국시간)</p>
      {result.items.length === 0 ? <p>검색결과가 없습니다.</p> : <ol>
        {result.items.map((item,index)=><li key={`${index}:${item.link}`}>
          <a href={item.originalLink ?? item.link} target="_blank" rel="noopener noreferrer">{item.title}</a>
          <div><span>{new URL(item.originalLink ?? item.link).hostname}</span> · 네이버 제공 <time dateTime={item.publishedAt}>{dateLabel(item.publishedAt)} (한국시간)</time>
          {item.originalLink && <> · <a href={item.link} target="_blank" rel="noopener noreferrer">네이버 검색 링크</a></>}</div>
        </li>)}
      </ol>}
    </div>}
    <footer><a href="https://www.ncloud.com/product/applicationService/NAVERAPIHUB" target="_blank" rel="noopener noreferrer">네이버™ 검색결과 · NAVER API HUB 제공</a>
      <p>네이버™는 NAVER®의 등록상표입니다. 기사 권리는 각 언론사에 있습니다.<br/>외부 검색결과는 SignalBrief가 검토한 공시 분석과 별도로 제공됩니다.</p></footer>
  </section>;
}

