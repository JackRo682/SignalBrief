'use client';

import {useCallback, useEffect, useRef} from 'react';
import {useAuth} from '@/components/auth';

/** Best-effort, consented engagement. No questions, URLs, holdings or persistent browser IDs. */
export function useEventAnalytics(
  eventId: string | null,
  evidenceOpen: boolean,
  screen: 'mobile_detail' | 'event_detail' = 'mobile_detail',
) {
  const {me, token, track} = useAuth();
  const opened = useRef<string | null>(null);
  const evidence = useRef<string | null>(null);
  const identity = me?.id;
  const consent = me?.analytics_consent === true;
  const key = identity && eventId ? `${identity}:${eventId}:${screen}` : null;

  useEffect(() => {
    if (!consent || !token || !eventId || !key || opened.current === key) return;
    opened.current = key;
    track('brief_opened', {event_id: eventId, screen});
  }, [consent, token, eventId, key, screen, track]);

  const engage = useCallback(() => {
    if (!consent || !token || !eventId || !key || evidence.current === key) return;
    evidence.current = key;
    track('evidence_opened', {event_id: eventId, screen});
  }, [consent, token, eventId, key, screen, track]);

  useEffect(() => { if (evidenceOpen) engage(); }, [evidenceOpen, engage]);
  return engage;
}
