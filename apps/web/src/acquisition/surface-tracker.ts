'use client';
import {useEffect, useLayoutEffect, useRef} from 'react';
import {activeClock} from './active-clock';
import {privacySignal, readConsent, SURFACE_CONSENT_VERSION, type Consent} from './client';
import {trafficPage} from './contracts';
import {isProductPath, productConsentChoice} from './product-client';

function screen(path: string) {
  if (!isProductPath(path)) return trafficPage(path);
  if (path.startsWith('/events/')) return 'event_detail';
  return path === '/home' ? 'app_home' : path.slice(1);
}

export function useSurfaceTracking(path: string, consent: Consent | null, token: string | null, productAllowed: boolean, admin: boolean, productChoice: string | null) {
  const visitor = consent?.choice === 'yes' && consent.surfaceVersion === SURFACE_CONSENT_VERSION ? consent.identity.visitor_id : null;
  const privatePage = isProductPath(path);
  const permitted = !admin && (!privatePage || Boolean(token && productAllowed && productChoice === 'granted'));
  const live = useRef({token, visitor, permitted});
  useLayoutEffect(() => { live.current = {token, visitor, permitted}; }, [token, visitor, permitted]);
  useEffect(() => {
    const surface = screen(path);
    if (!surface || !visitor || !permitted || privacySignal()) return;
    const id = crypto.randomUUID(), clock = activeClock(performance.now());
    const release = process.env.NEXT_PUBLIC_SB_MEASUREMENT_RELEASE || 'unversioned';
    let opened = false, acknowledged = -1, shown = false;
    function eligible() {
      const current = readConsent();
      return live.current.visitor === visitor && live.current.token === token && live.current.permitted
        && current?.choice === 'yes' && current.identity.visitor_id === visitor && current.surfaceVersion === SURFACE_CONSENT_VERSION
        && !privacySignal() && (!privatePage || productConsentChoice() === 'granted') ? current : null;
    }
    function publish() {
      const active = clock.sample(performance.now()), current = eligible();
      if (!opened || !current || active <= acknowledged) return;
      const payload = {action:'surface', ...current.identity, id, source:current.source, surface, release, active_ms:active, consent_version:SURFACE_CONSENT_VERSION};
      void fetch('/api/traffic', {method:'POST', headers:{'Content-Type':'application/json', ...(token ? {Authorization:'Bearer '+token} : {})},
        body:JSON.stringify(payload), keepalive:true}).then(async response => {
        if (response.ok && (await response.json()).recorded) acknowledged=Math.max(acknowledged,active);
      }).catch(() => {/* The next checkpoint replays this cumulative measurement. */});
    }
    function change(on: boolean) {
      if (on === shown) return;
      shown=on; clock.foreground(on,performance.now());
      if (on) opened=true;
      publish();
    }
    const visibility = () => change(document.visibilityState === 'visible' && document.hasFocus());
    const hidden = () => change(false);
    const activity = () => { if (shown) clock.activity(performance.now()); };
    visibility();
    const timer=window.setInterval(publish,15_000);
    const activityEvents=['pointerdown','pointermove','keydown','scroll','touchstart'];
    activityEvents.forEach(name=>window.addEventListener(name,activity,{passive:true,capture:true}));
    document.addEventListener('visibilitychange',visibility);
    window.addEventListener('focus',visibility); window.addEventListener('blur',hidden);
    window.addEventListener('pageshow',visibility); window.addEventListener('pagehide',hidden);
    return () => {
      clock.foreground(false,performance.now()); publish(); window.clearInterval(timer);
      activityEvents.forEach(name=>window.removeEventListener(name,activity,true));
      document.removeEventListener('visibilitychange',visibility);
      window.removeEventListener('focus',visibility); window.removeEventListener('blur',hidden);
      window.removeEventListener('pageshow',visibility); window.removeEventListener('pagehide',hidden);
    };
  }, [path, visitor, token, privatePage, permitted]);
}
