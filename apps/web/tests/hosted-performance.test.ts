// @vitest-environment node
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { describe, it, expect, vi } from 'vitest';

type Row = Record<string, unknown>;
function hosted() {
  const createClient = vi.fn();
  let handler!: (request: Request) => Promise<Response>;
  const source = readFileSync(new URL('../../../supabase/functions/signalbrief-api/index.ts', import.meta.url), 'utf8')
    .replace(/^import .*\n/, '');
  const sandbox = { createClient, Request, Response, Headers, URL, TextEncoder, crypto, console,
    Deno: { env: { get: (key: string) => key === 'SUPABASE_URL' ? 'https://test.supabase.co' : 'public-key' },
      serve: (fn: typeof handler) => { handler = fn; } },
    cards: undefined as unknown as (db: unknown, events: Row[], member: unknown) => Promise<Row[]> };
  runInNewContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText, sandbox);
  return { handler, createClient, cards: sandbox.cards };
}
describe('hosted startup and batched cards', () => {
  it('serves public config without Auth or a database health round trip', async () => {
    const { handler, createClient } = hosted();
    createClient.mockImplementation(() => { throw new Error('database unavailable'); });
    const response = await handler(new Request('https://test.supabase.co/functions/v1/signalbrief-api/v1/config'));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ auth_mode: 'supabase', demo_mode: false });
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=300');
    expect(createClient).not.toHaveBeenCalled();
    const health = await handler(new Request('https://test.supabase.co/functions/v1/signalbrief-api/health/ready'));
    expect(health.status).toBe(500);
    expect(createClient).toHaveBeenCalledTimes(1);
  });
  it('returns twelve summaries with five batch queries, excluding demo sources and unsupported quotes', async () => {
    const { cards } = hosted();
    const events = Array.from({ length: 12 }, (_, i) => ({ id: `event-${i}`, company_id: `company-${i}`, document_id: `doc-${i}`, published_at: new Date().toISOString() }));
    const tables: Record<string, Row[]> = {
      companies: events.map(e => ({ id: e.company_id })),
      documents: events.map((e, i) => ({ id: e.document_id, title: 'Original', provider: 'sec', is_demo: i === 11, source_url: 'https://sec.gov/filing' })),
      briefs: events.map(e => ({ event_id: e.id, headline: 'Change', interpretation: 'Reviewed meaning' })),
      changes: events.map(e => ({ id: 'change', event_id: e.id, field: 'revenue', previous_value: '10', current_value: '12', change_type: 'increased' })),
      facts: events.flatMap(e => [{ id: '0', event_id: e.id, quote: 'Unsupported claim', validation_status: 'unsupported' }, { id: '1', event_id: e.id, quote: 'Persisted evidence', validation_status: 'supported' }]),
    };
    const from = vi.fn((table: string) => ({ select: () => ({ in: (field: string, ids: string[]) => Promise.resolve({ data: tables[table].filter(x => ids.includes(x[field] as string)), error: null }) }) }));
    const result = await cards({ from }, events, { watched: new Set(), held: new Set() });
    expect(from).toHaveBeenCalledTimes(5);
    expect(result).toHaveLength(11);
    expect(result[0]).toMatchObject({ fact_summary: 'Persisted evidence', interpretation: 'Reviewed meaning', change_summary: [{ field: 'revenue', previous_value: '10', current_value: '12' }] });
    expect(JSON.stringify(result)).not.toContain('Unsupported claim');
  });
});
