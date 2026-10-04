import { describe, expect, it } from 'vitest';
import { hydrateLegacySummaries } from '../src/reference/legacy-summaries';
import type { Row } from '../src/reference/controller';

describe('rolling release compatibility', () => {
  it('does not request details for compact responses, including empty verified summaries', async () => {
    let requests = 0;
    await hydrateLegacySummaries([{ id: 'compact', change_summary: [], fact_summary: null }], async () => { requests++; return {}; }, () => {}, new AbortController().signal);
    expect(requests).toBe(0);
  });

  it('bounds legacy requests and preserves supported evidence and source links', async () => {
    const events: Row[] = Array.from({ length: 12 }, (_, id) => ({ id: String(id), what_happened: 'Original summary' }));
    let active = 0, peak = 0, updates = 0;
    await hydrateLegacySummaries(events, async id => {
      active++; peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, 1));
      active--;
      if (id === '0') throw new Error('Unavailable');
      return { facts: [{ quote: 'Rejected', validation_status: 'unsupported' }, { quote: 'Supported', validation_status: 'supported' }], changes: [{ current_value: '12' }], brief: { interpretation: 'Reviewed' }, document: { source_url: 'https://example.com/source' } };
    }, () => { updates++; }, new AbortController().signal);
    expect(peak).toBe(4);
    expect(updates).toBe(11);
    expect(events[0]).toEqual({ id: '0', what_happened: 'Original summary' });
    expect(events[1]).toMatchObject({ fact_summary: 'Supported', interpretation: 'Reviewed', source_document: { source_url: 'https://example.com/source' } });
  });

  it('stops enrichment and queued requests when a page is unmounted', async () => {
    const abort = new AbortController();
    let requests = 0, updates = 0;
    await hydrateLegacySummaries(Array.from({ length: 12 }, (_, id) => ({ id })), async () => {
      requests++; abort.abort(); return { brief: { interpretation: 'Stale' } };
    }, () => { updates++; }, abort.signal);
    expect(requests).toBe(1);
    expect(updates).toBe(0);
  });
});
