import { afterEach, it, expect, vi } from 'vitest';

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });
it('deduplicates bootstrap config across Strict Mode remounts', async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({ demo_mode: true, demo_admin_enabled: false, auth_mode: 'demo' }));
  vi.stubGlobal('fetch', fetcher);
  const { runtimeConfig } = await import('../src/lib/runtime-config');
  const [first, second] = await Promise.all([runtimeConfig(), runtimeConfig()]);
  expect(first).toEqual(second);
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it('allows a real retry after config fails', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({}, { status: 503 }))
    .mockResolvedValueOnce(Response.json({ demo_mode: false, demo_admin_enabled: false, auth_mode: 'supabase' }));
  vi.stubGlobal('fetch', fetcher);
  const { runtimeConfig } = await import('../src/lib/runtime-config');
  await expect(runtimeConfig()).rejects.toThrow();
  await expect(runtimeConfig()).resolves.toMatchObject({ auth_mode: 'supabase' });
  expect(fetcher).toHaveBeenCalledTimes(2);
});
