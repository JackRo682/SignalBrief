import React from 'react';
import {cleanup, render, screen} from '@testing-library/react';
import {afterEach, describe, expect, it} from 'vitest';
import ProductFunnelPanel from '../src/acquisition/product-panel';
afterEach(cleanup);
const empty = {landing_visitors: 0, engaged_visitors: 0, detail_click_visitors: 0, detail_view_visitors: 0, search_events: 0, filter_events: 0, detail_click_events: 0, detail_view_events: 0};
describe('product funnel reporting', () => {
  it('shows an unmeasured denominator instead of inventing a zero conversion rate', () => {
    render(<ProductFunnelPanel data={empty}/>);
    expect(screen.getByText('홈 방문 → 상세 화면 확인: 측정 대기')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('설치 이전 행동 기록은 복원하지 않습니다');
    expect(screen.queryByText(/NaN|Infinity/)).toBeNull();
  });
  it('uses the previous stage for step rates and the landing cohort for overall conversion', () => {
    render(<ProductFunnelPanel data={{...empty, landing_visitors: 20, engaged_visitors: 10, detail_click_visitors: 4, detail_view_visitors: 3, search_events: 18, filter_events: 12, detail_click_events: 7, detail_view_events: 5}}/>);
    expect(screen.getByText('홈 방문 → 상세 화면 확인: 15.0%')).toBeTruthy();
    for (const rate of ['50.0%', '40.0%', '75.0%']) expect(screen.getByText(`이전 단계 대비 ${rate}`)).toBeTruthy();
    expect(screen.getByText(/같은 방문 세션인지와 관계없이/)).toBeTruthy();
    expect(screen.getByText('기간 내 전체 동의 활동')).toBeTruthy();
  });
});
