// @vitest-environment node
import { NextRequest } from 'next/server';
import { afterEach, it, expect, vi } from 'vitest';
import { proxy } from '../src/proxy';

afterEach(() => vi.unstubAllEnvs());
it('redirects production aliases before login while preserving path and query', () => {
  vi.stubEnv('VERCEL_ENV', 'production');
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://signalbrief-beta.vercel.app/');
  const response = proxy(new NextRequest('https://alias.vercel.app/calendar?month=10'));
  expect(response.status).toBe(307);
  expect(response.headers.get('Location')).toBe('https://signalbrief-beta.vercel.app/calendar?month=10');
  expect(proxy(new NextRequest('https://signalbrief-beta.vercel.app/login')).headers.get('Location')).toBeNull();
  const unusual = proxy(new NextRequest('https://alias.vercel.app//outside.example/login'));
  expect(new URL(unusual.headers.get('Location')!).origin).toBe('https://signalbrief-beta.vercel.app');
});
it('keeps preview and local application routes available for development', () => {
  vi.stubEnv('VERCEL_ENV', 'preview');
  expect(proxy(new NextRequest('https://preview.vercel.app/today')).headers.get('Location')).toBeNull();
});
