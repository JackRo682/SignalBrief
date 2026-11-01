import {act, cleanup, fireEvent, render, renderHook, screen, waitFor} from '@testing-library/react';
import {StrictMode, type AnchorHTMLAttributes, type ReactNode} from 'react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {useEventAnalytics} from '../src/lib/use-event-analytics';
import RedesignEvent from '../src/redesign/event';
import type {EventDetail} from '../src/lib/contracts';
import {defaults} from '../src/workspace/contracts';
import {companyResources, eventDetails, eventId} from '../e2e/mobile-fixture';

const auth = vi.hoisted(() => ({
  token: 'synthetic-token' as string | null,
  me: {id: 'synthetic-user', analytics_consent: false}, track: vi.fn(),
}));
const view = vi.hoisted(() => ({
  data: null as EventDetail | null, loading: false, error: null as string | null,
}));
vi.mock('../src/components/auth', () => ({useAuth: () => auth}));
vi.mock('next/navigation', () => ({useRouter: () => ({push: vi.fn()})}));
vi.mock('next/link', () => ({default: ({children, onClick, ...props}: AnchorHTMLAttributes<HTMLAnchorElement>) =>
  <a {...props} onClick={event => {onClick?.(event); event.preventDefault();}}>{children}</a>,
}));
vi.mock('../src/components/ui', () => ({useResource: (path: string | null) => ({
  data: path ? view.data : null, loading: !!path && view.loading, error: path ? view.error : null, reload: vi.fn(),
})}));
vi.mock('../src/workspace/preferences', () => ({usePrefs: () => ({
  text: (ko: string) => ko, date: (value: string) => value, value: {...defaults, history_enabled: false},
})}));
vi.mock('../src/workspace/ui', async original => ({
  ...(await original<typeof import('../src/workspace/ui')>()),
  useData: (input: {action: string} | null) => ({
    data: input?.action === 'company' ? {
      company: companyResources[0], analyses: [], events: [], documents: [], facts: [], watching: true, holding: false,
    } : null, loading: false, error: '', reload: vi.fn(),
  }),
}));
vi.mock('../src/desktop/ui', () => ({
  PcLogo: () => null, PcModal: ({children}: {children: ReactNode}) => <div>{children}</div>,
}));
vi.mock('../src/lib/supabase', () => ({initializeSupabase: async () => ({
  rpc: () => ({abortSignal: async () => ({data: [], error: null})}),
})}));
vi.mock('../src/redesign/calendar-data', () => ({useCalendarData: (input: {id?: string} | null) => ({
  data: {items: input?.id ? [{
    id: input.id, title: 'Synthetic personal calendar item', occurs_on: '2026-11-01',
    company_id: null, event_id: null, origin: 'user', quote: null,
    source_url: 'https://example.org/synthetic-calendar-source', source_timezone: null, verified_at: null,
  }] : [], truncated: false}, loading: false, error: '', reload: vi.fn(),
})}));
beforeEach(() => {
  auth.token='synthetic-token'; auth.me={id:'synthetic-user',analytics_consent:false}; vi.clearAllMocks();
  view.data=structuredClone(eventDetails.get(eventId)!); view.loading=false; view.error=null;
});
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
  it('supports the explicit event_detail screen without adding analytics properties', () => {
    auth.me.analytics_consent=true;
    const hook=renderHook(() => useEventAnalytics('e1',true,'event_detail'));
    act(() => hook.result.current());
    expect(auth.track.mock.calls).toEqual([
      ['brief_opened',{event_id:'e1',screen:'event_detail'}],
      ['evidence_opened',{event_id:'e1',screen:'event_detail'}],
    ]);
  });
});

describe('redesign event engagement integration', () => {
  it('tracks actual native evidence opening once, not the documents tab or closing', async () => {
    auth.me.analytics_consent=true;
    const rendered=render(<RedesignEvent id={eventId}/>);
    expect(auth.track.mock.calls).toEqual([['brief_opened',{event_id:eventId,screen:'event_detail'}]]);
    fireEvent.click(screen.getByRole('tab',{name:'문서'}));
    expect(auth.track).toHaveBeenCalledTimes(1);
    const details=rendered.container.querySelector<HTMLDetailsElement>('.rd-event-evidence')!;
    const summary=details.querySelector('summary')!;
    expect(details.open).toBe(false);
    fireEvent.click(summary);
    await waitFor(() => expect(auth.track).toHaveBeenCalledTimes(2));
    expect(details.open).toBe(true);
    fireEvent.click(summary);
    await waitFor(() => expect(details.open).toBe(false));
    fireEvent.click(summary);
    await waitFor(() => expect(details.open).toBe(true));
    expect(auth.track.mock.calls).toEqual([
      ['brief_opened',{event_id:eventId,screen:'event_detail'}],
      ['evidence_opened',{event_id:eventId,screen:'event_detail'}],
    ]);
  });

  it('records a loaded evidence deep link even before an additional click', () => {
    auth.me.analytics_consent=true;
    const rendered=render(<RedesignEvent id={eventId} panel="evidence"/>);
    expect(rendered.container.querySelector<HTMLDetailsElement>('.rd-event-evidence')?.open).toBe(true);
    expect(auth.track.mock.calls).toEqual([
      ['brief_opened',{event_id:eventId,screen:'event_detail'}],
      ['evidence_opened',{event_id:eventId,screen:'event_detail'}],
    ]);
  });

  it.each(['.rd-event-meta a[target="_blank"]','.rd-event-resources a'])('records an explicit source/document click: %s', selector => {
    auth.me.analytics_consent=true;
    const rendered=render(<RedesignEvent id={eventId}/>);
    fireEvent.click(rendered.container.querySelector(selector)!);
    expect(auth.track.mock.calls).toEqual([
      ['brief_opened',{event_id:eventId,screen:'event_detail'}],
      ['evidence_opened',{event_id:eventId,screen:'event_detail'}],
    ]);
  });

  it.each(['no consent','no token','loading','failed','missing','wrong event','unpublished','demo'])('records nothing for %s', async state => {
    auth.me.analytics_consent=state!=='no consent';
    if(state==='no token')auth.token=null;
    if(state==='loading')view.loading=true;
    if(state==='failed')view.error='Synthetic denied request';
    if(state==='missing')view.data=null;
    if(state==='wrong event')view.data!.event.id='another-event';
    if(state==='unpublished')view.data!.event.state='needs_review';
    if(state==='demo')view.data!.event.is_demo=true;
    render(<RedesignEvent id={eventId} panel="evidence"/>);
    await act(async () => {});
    expect(auth.track).not.toHaveBeenCalled();
  });

  it('never sends calendar occurrence IDs as analysis engagement', async () => {
    auth.me.analytics_consent=true;
    const calendarId='90000000-0000-4000-8000-000000000001';
    const rendered=render(<RedesignEvent id={calendarId} kind="calendar" panel="evidence"/>);
    fireEvent.click(rendered.container.querySelector('.rd-event-meta a[target="_blank"]')!);
    await act(async () => {});
    expect(auth.track).not.toHaveBeenCalled();
  });
});
