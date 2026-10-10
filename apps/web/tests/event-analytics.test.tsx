import {act, cleanup, renderHook} from '@testing-library/react';
import {StrictMode, type ReactNode} from 'react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {useEventAnalytics} from '../src/lib/use-event-analytics';

const auth = vi.hoisted(() => ({
  token: 'synthetic-token' as string | null,
  me: {id: 'synthetic-user', analytics_consent: false}, track: vi.fn(),
}));
vi.mock('../src/components/auth', () => ({useAuth: () => auth}));
beforeEach(() => {auth.token='synthetic-token'; auth.me={id:'synthetic-user',analytics_consent:false}; vi.clearAllMocks();});
afterEach(cleanup);

describe('consented mobile engagement', () => {
  it('records nothing without consent, identity token or a loaded event', () => {
    const hook=renderHook(() => useEventAnalytics('e1',true));
    act(() => hook.result.current());
    expect(auth.track).not.toHaveBeenCalled();
    auth.me.analytics_consent=true; auth.token=null; hook.rerender();
    expect(auth.track).not.toHaveBeenCalled();
    auth.token='synthetic-token';
    renderHook(() => useEventAnalytics(null,true));
    expect(auth.track).not.toHaveBeenCalled();
  });
  it('deduplicates rerenders and strict effects; tracks a new event independently', () => {
    auth.me.analytics_consent=true;
    const wrapper=({children}:{children:ReactNode}) => <StrictMode>{children}</StrictMode>;
    const hook=renderHook(({id}) => useEventAnalytics(id,false),{initialProps:{id:'e1'},wrapper});
    hook.rerender({id:'e1'});
    act(() => {hook.result.current(); hook.result.current();});
    expect(auth.track.mock.calls).toEqual([
      ['brief_opened',{event_id:'e1',screen:'mobile_detail'}],
      ['evidence_opened',{event_id:'e1',screen:'mobile_detail'}],
    ]);
    hook.rerender({id:'e2'});
    expect(auth.track).toHaveBeenLastCalledWith('brief_opened',{event_id:'e2',screen:'mobile_detail'});
  });
  it('supports a loaded evidence deep link and stops new interactions after opt-out', () => {
    auth.me.analytics_consent=true;
    const hook=renderHook(({open}) => useEventAnalytics('e1',open),{initialProps:{open:false}});
    auth.me.analytics_consent=false; hook.rerender({open:true});
    act(() => hook.result.current());
    expect(auth.track).toHaveBeenCalledTimes(1);
    auth.me.analytics_consent=true; hook.rerender({open:true});
    expect(auth.track).toHaveBeenLastCalledWith('evidence_opened',{event_id:'e1',screen:'mobile_detail'});
  });
});
