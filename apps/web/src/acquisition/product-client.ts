import {productRecord, PRODUCT_CONSENT_VERSION} from './contracts';
import {privacySignal, readConsent} from './client';
import {enqueueTraffic} from './queue';

export const PRODUCT_CONSENT_KEY = 'sb.product.analytics.v1';
export {PRODUCT_CONSENT_VERSION};
const MAX_AGE = 90 * 86400000;
let consentRevision = 0;
let runtimeRevoked = false;
export type ProductEvent = 'search_used' | 'filter_used' | 'event_detail_click' | 'event_detail_view';
export type ProductParameters = {
  screen: 'search' | 'calendar' | 'home' | 'today' | 'event_detail';
  filter_type?: 'kind' | 'source' | 'period' | 'sort' | 'market' | 'company' | 'category' | 'scope' | 'view' | 'personal' | 'reset';
  event_kind?: 'published' | 'calendar';
};

export function productConsentChoice(): 'granted' | 'denied' | null {
  if (runtimeRevoked) return 'denied';
  try {
    const value = JSON.parse(localStorage.getItem(PRODUCT_CONSENT_KEY) ?? 'null');
    if (!value || value.version !== PRODUCT_CONSENT_VERSION || !Number.isFinite(value.at)
      || value.at > Date.now() || Date.now() - value.at >= MAX_AGE) return null;
    if (value.choice === 'denied') return 'denied';
    const consent = readConsent();
    return value.choice === 'granted' && typeof value.grant_id === 'string'
      && /^[a-f0-9-]{36}$/i.test(value.grant_id) && consent?.choice === 'yes'
      && value.visitor_id === consent.identity.visitor_id ? 'granted' : null;
  } catch { return null; }
}

export function setProductConsent(granted: boolean): boolean {
  // Revocation is effective immediately even if browser storage cannot be written.
  consentRevision++;
  if (!granted) runtimeRevoked = true;
  const consent = readConsent();
  if (granted && (privacySignal() || consent?.choice !== 'yes')) return false;
  try {
    localStorage.setItem(PRODUCT_CONSENT_KEY, JSON.stringify({
      version: PRODUCT_CONSENT_VERSION, choice: granted ? 'granted' : 'denied', at: Date.now(),
      ...(granted && consent?.choice === 'yes' ? {visitor_id: consent.identity.visitor_id, grant_id: crypto.randomUUID()} : {}),
    }));
    if (granted) runtimeRevoked = false;
    window.dispatchEvent(new Event('sb:product-consent'));
    return true;
  } catch { return false; }
}

export function isProductPath(path: string): boolean {
  return ['/home', '/today', '/search', '/calendar'].includes(path)
    || /^\/events\/[a-zA-Z0-9_-]+$/.test(path);
}

export type ProductAccount = {token: string | null; analyticsConsent: boolean; isAdmin: boolean; isDemo: boolean};
type AccountSource = ProductAccount | (() => ProductAccount);
let liveAccount: ProductAccount | undefined;
let accountRevision = 0;

/** The root tracker survives route changes and publishes committed auth changes.
 * A queued click may outlive its originating page, but never an account change.
 */
export function syncProductAccount(account: ProductAccount): void {
  if (!liveAccount || liveAccount.token !== account.token || liveAccount.analyticsConsent !== account.analyticsConsent
    || liveAccount.isAdmin !== account.isAdmin || liveAccount.isDemo !== account.isDemo) accountRevision++;
  liveAccount = {...account};
}
const accountAllowed = (account: ProductAccount) => typeof account.token === 'string' && account.token.length > 0
  && account.analyticsConsent === true && account.isAdmin === false && account.isDemo === false;
function consentStamp(): string | null {
  try { return localStorage.getItem(PRODUCT_CONSENT_KEY); } catch { return null; }
}

/** The server independently verifies the live account, consent and session.
 * No query text, resource IDs, URLs, names or account identifiers enter the payload.
 */
export function recordProductAction(name: ProductEvent, parameters: ProductParameters, source: AccountSource): Promise<boolean> {
  const readAccount = typeof source === 'function' ? source : () => source;
  const account = readAccount();
  const consent = readConsent();
  if (!accountAllowed(account) || liveAccount && (!accountAllowed(liveAccount) || liveAccount.token !== account.token)
    || consent?.choice !== 'yes' || productConsentChoice() !== 'granted' || privacySignal()) return Promise.resolve(false);
  const initialConsentRevision = consentRevision, initialAccountRevision = accountRevision, initialStamp = consentStamp();
  if (!initialStamp) return Promise.resolve(false);
  const parsed = productRecord.safeParse({
    action: 'record', ...consent.identity, id: crypto.randomUUID(), kind: name,
    page: parameters.screen === 'home' ? 'app_home' : parameters.screen, source: consent.source,
    product_consent_version: PRODUCT_CONSENT_VERSION,
    ...(parameters.filter_type ? {filter_type: parameters.filter_type} : {}),
    ...(parameters.event_kind ? {event_kind: parameters.event_kind} : {}),
  });
  if (!parsed.success) return Promise.resolve(false);
  return enqueueTraffic(async () => {
    const current = readConsent();
    const currentAccount = readAccount();
    if (current?.choice !== 'yes' || current.identity.visitor_id !== consent.identity.visitor_id
      || consentRevision !== initialConsentRevision || consentStamp() !== initialStamp
      || productConsentChoice() !== 'granted' || privacySignal()
      || accountRevision !== initialAccountRevision || !accountAllowed(currentAccount) || currentAccount.token !== account.token
      || liveAccount && (!accountAllowed(liveAccount) || liveAccount.token !== account.token)) return false;
    try {
      const response = await fetch('/api/traffic', {
        method: 'POST', headers: {'Content-Type': 'application/json', Authorization: `Bearer ${account.token}`},
        body: JSON.stringify(parsed.data), keepalive: true, signal: AbortSignal.timeout(2500),
      });
      if (!response.ok) return false;
      const result = await response.json();
      return result?.recorded === true;
    } catch { return false; }
  });
}
