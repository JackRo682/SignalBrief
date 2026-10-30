import '@testing-library/jest-dom/vitest';
import {StrictMode} from 'react';
import {act, cleanup, fireEvent, render, screen} from '@testing-library/react';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {MarketWidget, widgetSymbol} from '../src/components/market-widget';
vi.mock('../src/workspace/preferences', () => ({usePrefs: () => ({text: (_ko: string, en: string) => en, value: {locale: 'en'}})}));
afterEach(() => {cleanup(); vi.useRealTimers();});
describe('display-only market fallback', () => {
  it('uses validated issuer identifiers and refuses to guess an exchange', () => {
    expect(widgetSymbol('005930', 'KR')).toBe('KRX:005930');
    expect(widgetSymbol('AAPL', 'US')).toBe('NASDAQ:AAPL');
    expect(widgetSymbol('IBM', 'NYSE')).toBe('NYSE:IBM');
    expect(widgetSymbol('UNKNOWN', 'US')).toBeNull();
    expect(widgetSymbol('AAPL<script>', 'NASDAQ')).toBeNull();
  });
  it('loads only after a click and retains provider attribution', () => {
    const view = render(<StrictMode><MarketWidget ticker="AAPL" market="US"/></StrictMode>);
    expect(view.container.querySelector('script')).toBeNull();
    fireEvent.click(screen.getByRole('button', {name: 'Load external chart'}));
    expect(view.container.querySelectorAll('script')).toHaveLength(1);
    expect(JSON.parse(view.container.querySelector('script')!.textContent!)).toMatchObject({symbols: [['NASDAQ:AAPL|1D']], hideMarketStatus: false});
    expect(screen.getByRole('link', {name: 'View on TradingView'})).toHaveAttribute('href', 'https://www.tradingview.com/symbols/NASDAQ-AAPL/');
    const host = view.container.querySelector('.sb-market-widget-frame')!;
    view.unmount();
    expect(host.children).toHaveLength(0);
  });
  it('cleans up an old issuer and requires a fresh click for the new issuer', () => {
    const view = render(<MarketWidget ticker="AAPL"/>);
    fireEvent.click(screen.getByRole('button', {name: 'Load external chart'}));
    view.rerender(<MarketWidget ticker="MSFT"/>);
    expect(view.container.querySelector('script')).toBeNull();
    expect(screen.getByRole('button', {name: 'Load external chart'})).toBeTruthy();
  });
  it('offers retry after failure and times out when a frame never appears', () => {
    vi.useFakeTimers();
    const view = render(<MarketWidget/>);
    fireEvent.click(screen.getByRole('button', {name: 'Load external chart'}));
    fireEvent.error(view.container.querySelector('script')!);
    fireEvent.click(screen.getByRole('button', {name: 'Retry'}));
    expect(view.container.querySelectorAll('script')).toHaveLength(1);
    act(() => vi.advanceTimersByTime(20000));
    expect(screen.getByRole('button', {name: 'Retry'})).toBeTruthy();
  });
  it('labels a loaded frame without claiming its prices are verified', async () => {
    const view = render(<MarketWidget ticker="005930"/>);
    fireEvent.click(screen.getByRole('button', {name: 'Load external chart'}));
    const host = view.container.querySelector('.sb-market-widget-frame')!;
    await act(async () => {host.appendChild(document.createElement('iframe'));});
    expect(host.querySelector('iframe')).toHaveAttribute('title', 'TradingView market chart');
    expect(screen.queryByText('Loading chart…')).toBeNull();
    expect(view.container.textContent).toContain('Some symbols are available only on the provider site.');
  });
});
