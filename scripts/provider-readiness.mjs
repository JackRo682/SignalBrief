import {pathToFileURL} from 'node:url';

// Only the product's fixed origin can receive a session token.
const origin = 'https://signalbrief.online';
const safeCode = value => typeof value === 'string' && /^[a-z_0-9]{1,80}$/.test(value) ? value : 'provider_unavailable';
export function summarizeStatus(data, now = Date.now()) {
  if (!data || typeof data.credentials?.fmp !== 'boolean' || typeof data.fmp_display !== 'boolean' || !Array.isArray(data.checks)) {
    throw new Error('invalid_status_response');
  }
  const check = data.checks.find(item => item.provider === 'fmp');
  const at = Date.parse(check?.checked_at);
  const fresh = Number.isFinite(at) && at <= now + 300000 && now - at <= 86400000;
  return {
    fmp_key_registered: data.credentials.fmp,
    display_permitted: data.fmp_display,
    recent_connection_verified: check?.status === 'verified' && fresh,
    connection_code: check ? safeCode(check.code ?? (check.status === 'verified' ? 'verified' : 'provider_unavailable')) : 'not_checked',
    next_step: !data.credentials.fmp ? 'register_fmp_key' : !data.fmp_display ? 'confirm_display_agreement' : check?.status !== 'verified' || !fresh ? 'verify_fmp_connection' : 'verify_authenticated_market_screen',
  };
}
export async function inspectProviders({verifyFmp = false, token = '', fetcher = fetch} = {}) {
  async function request(path, init = {}) {
    try {
      const response = await fetcher(`${origin}/api/us/${path}`, {...init, redirect: 'error', signal: AbortSignal.timeout(55000)});
      if (!response.ok) { await response.body?.cancel(); throw new Error(`http_${response.status}`); }
      return await response.json();
    } catch (error) {
      throw new Error(/^http_\d{3}$/.test(error?.message ?? '') ? error.message : 'api_unreachable_or_invalid_response');
    }
  }
  const initial = summarizeStatus(await request('status'));
  if (!verifyFmp) return initial;
  if (!/^[A-Za-z0-9._-]{20,8192}$/.test(token)) throw new Error('admin_session_required');
  if (!initial.fmp_key_registered) return initial;
  // Refuse the previous verify API, which would invoke other paid providers.
  const capabilities = await request('health');
  if (capabilities.selective_verification !== true) throw new Error('selective_verification_not_deployed');
  const verified = await request('verify', {method: 'POST', headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'}, body: JSON.stringify({providers: ['fmp']})});
  return {...summarizeStatus(await request('status')), verification: {status: verified?.fmp?.status === 'verified' ? 'verified' : 'blocked', code: safeCode(verified?.fmp?.detail?.code ?? (verified?.fmp?.status === 'verified' ? 'verified' : 'provider_unavailable'))}};
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--verify-fmp')) {
    console.error('Usage: node scripts/provider-readiness.mjs [--verify-fmp]');
    process.exitCode = 1;
  } else {
    try {
      const result = await inspectProviders({verifyFmp: args.includes('--verify-fmp'), token: process.env.SB_ADMIN_ACCESS_TOKEN ?? ''});
      console.log(JSON.stringify(result, null, 2));
      process.exitCode = result.recent_connection_verified && result.display_permitted && result.fmp_key_registered ? 0 : 2;
    } catch (error) {
      console.error(JSON.stringify({error: safeCode(error.message)}));
      process.exitCode = 1;
    }
  }
}
