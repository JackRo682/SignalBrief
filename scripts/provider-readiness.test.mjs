import {test} from 'node:test';
import assert from 'node:assert/strict';
import {inspectProviders, summarizeStatus} from './provider-readiness.mjs';
import {verificationPlan, runVerification, verificationProviders} from '../supabase/functions/signalbrief-api/verification.ts';

const status = (overrides = {}) => ({credentials: {fmp: true}, fmp_display: true, checks: [{provider: 'fmp', status: 'verified', checked_at: new Date().toISOString(), code: null}], ...overrides});
const response = value => new Response(JSON.stringify(value));

test('FMP-only verification never invokes other providers', async () => {
  const calls = [];
  const checks = Object.fromEntries(verificationProviders.map(provider => [provider, async () => {calls.push(provider); return {status: 'verified'};}]));
  assert.deepEqual(await runVerification(verificationPlan(['fmp', 'fmp']), checks), {fmp: {status: 'verified'}});
  assert.deepEqual(calls, ['fmp']);
});
test('legacy empty body preserves existing verification plan', () => assert.deepEqual(verificationPlan(undefined), [...verificationProviders]));
test('invalid provider plans are rejected in full before execution', () => {
  for (const value of [null, [], 'fmp', ['fmp', 'bad'], [null], ['constructor'], Array(7).fill('fmp')]) assert.throws(() => verificationPlan(value), /invalid_verification_providers/);
});
test('missing credentials and rights have distinct next actions', () => {
  assert.equal(summarizeStatus(status({credentials: {fmp: false}})).next_step, 'register_fmp_key');
  assert.equal(summarizeStatus(status({fmp_display: false})).next_step, 'confirm_display_agreement');
});
test('old and future checks never count as current verification', () => {
  for (const checked_at of ['2000-01-01', '2099-01-01', 'invalid']) {
    assert.equal(summarizeStatus(status({checks: [{provider: 'fmp', status: 'verified', checked_at}]})).recent_connection_verified, false);
  }
});
test('unrecognized status response is rejected', () => assert.throws(() => summarizeStatus({}), /invalid_status_response/));
test('readiness check is read-only and has no authorization header', async () => {
  const calls = [];
  await inspectProviders({fetcher: async (url, init) => {calls.push({url, init}); return response(status());}});
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://signalbrief.online/api/us/status');
  assert.equal(calls[0].init.headers, undefined);
  assert.equal(calls[0].init.redirect, 'error');
});
test('explicit FMP test uses only a bearer session and FMP plan', async () => {
  const calls = [];
  const token = 'private_session_token_123456';
  const result = await inspectProviders({verifyFmp: true, token, fetcher: async (url, init) => {
    calls.push({url, init});
    if (url.endsWith('/health')) return response({selective_verification: true});
    if (url.endsWith('/verify')) return response({fmp: {status: 'verified', detail: {}}});
    return response(status());
  }});
  const mutation = calls.find(call => call.init.method === 'POST');
  assert.deepEqual(JSON.parse(mutation.init.body), {providers: ['fmp']});
  assert.equal(mutation.init.headers.Authorization, `Bearer ${token}`);
  assert.equal(JSON.stringify(result).includes(token), false);
});
test('legacy deployed API is not invoked for FMP-only check', async () => {
  let posted = false;
  await assert.rejects(inspectProviders({verifyFmp: true, token: 'private_session_token_123456', fetcher: async (url, init) => {
    if (init.method === 'POST') posted = true;
    return response(url.endsWith('/health') ? {} : status());
  }}), /selective_verification_not_deployed/);
  assert.equal(posted, false);
});
test('failed API and provider responses cannot leak secrets', async () => {
  await assert.rejects(inspectProviders({fetcher: async () => {throw new Error('apikey=PRIVATE_SECRET');}}), error => !error.message.includes('PRIVATE_SECRET'));
  assert.equal(JSON.stringify(summarizeStatus(status({checks: [{provider: 'fmp', status: 'blocked', code: 'https://example.com?key=PRIVATE_SECRET'}]}))).includes('PRIVATE_SECRET'), false);
});
test('verification needs an admin session and stops before any POST when key is missing', async () => {
  await assert.rejects(inspectProviders({verifyFmp: true, fetcher: async () => response(status())}), /admin_session_required/);
  let count = 0;
  const result = await inspectProviders({verifyFmp: true, token: 'private_session_token_123456', fetcher: async () => {count++; return response(status({credentials: {fmp: false}}));}});
  assert.equal(count, 1);
  assert.equal(result.next_step, 'register_fmp_key');
});
