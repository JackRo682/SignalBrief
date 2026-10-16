import {StrictMode} from 'react';
import {act, cleanup, fireEvent, render, screen} from '@testing-library/react';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {TradingViewNews} from '../src/components/tradingview-news';

afterEach(() => {cleanup(); vi.useRealTimers();});
describe('TradingView embed lifecycle', () => {
  it('keeps one embed in Strict Mode and cleans it up on unmount', async () => {
    const view = render(<StrictMode><TradingViewNews/></StrictMode>);
    expect(view.container.querySelectorAll('script')).toHaveLength(1);
    const script = view.container.querySelector('script')!;
    expect(JSON.parse(script.textContent!)).toMatchObject({locale: 'en', feedMode: 'all_symbols'});
    const host = view.container.querySelector('.sb-news-widget')!;
    await act(async () => {host.appendChild(document.createElement('iframe'));});
    expect(screen.queryByText('뉴스 위젯을 불러오는 중…')).toBeNull();
    expect(host.querySelector('iframe')?.title).toBe('TradingView 주요 뉴스');
    view.unmount();
    expect(host.children).toHaveLength(0);
  });
  it('offers retry and an independent source link when the script fails', () => {
    const view = render(<TradingViewNews/>);
    fireEvent.error(view.container.querySelector('script')!);
    expect(screen.getByText(/뉴스를 표시하지 못했습니다/)).toBeTruthy();
    expect(screen.getByRole('link', {name: 'TradingView에서 모든 뉴스 확인'}).getAttribute('href')).toBe('https://kr.tradingview.com/news/');
    fireEvent.click(screen.getByRole('button', {name: '다시 시도'}));
    expect(screen.getByText('뉴스 위젯을 불러오는 중…')).toBeTruthy();
    expect(view.container.querySelectorAll('script')).toHaveLength(1);
  });
  it('does not leave an endless loading state when the provider never responds', () => {
    vi.useFakeTimers();
    render(<TradingViewNews/>);
    act(() => vi.advanceTimersByTime(20000));
    expect(screen.getByRole('button', {name: '다시 시도'})).toBeTruthy();
  });
});
