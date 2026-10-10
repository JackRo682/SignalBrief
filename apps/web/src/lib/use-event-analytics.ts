'use client';

import {useCallback, useEffect, useRef} from 'react';
import {useAuth} from '@/components/auth';

/** Best-effort, consented engagement. No questions, URLs, holdings or persistent browser IDs. */
export function useEventAnalytics(eventId: string | null, evidenceOpen: boolean) {
  const {me, token, track} = useAuth();
  const opened = useRef<string | null>(null);
  const evidence = useRef<string | null>(null);
  const identity = me?.id;
  const consent = me?.analytics_consent === true;
  const key = identity && eventId ? `${identity}:${eventId}` : null;

  useEffect(() => {
    if (!consent || !token || !eventId || !key || opened.current === key) return;
    opened.current = key;
    track('brief_opened', {event_id: eventId, screen: 'mobile_detail'});
  }, [consent, token, eventId, key, track]);

  const engage = useCallback(() => {
    if (!consent || !token || !eventId || !key || evidence.current === key) return;
    evidence.current = key;
    track('evidence_opened', {event_id: eventId, screen: 'mobile_detail'});
  }, [consent, token, eventId, key, track]);

  useEffect(() => { if (evidenceOpen) engage(); }, [evidenceOpen, engage]);
  return engage;
}
