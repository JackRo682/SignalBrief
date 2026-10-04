import type { Row } from './controller';

const row = (value: unknown): Row => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
const rows = (value: unknown): Row[] => Array.isArray(value) ? value.map(row) : [];

/** Allows the web and Edge releases to roll out separately. Compact responses
 * never request details; older responses enrich already visible cards in the background.
 */
export async function hydrateLegacySummaries(
  events: Row[], fetchDetail: (id: string) => Promise<Row>,
  onUpdate: (event: Row) => void, signal: AbortSignal,
): Promise<void> {
  const pending = events.filter(event => !Object.hasOwn(event, 'change_summary'));
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(4, pending.length) }, async () => {
    while (!signal.aborted && cursor < pending.length) {
      const event = pending[cursor++];
      try {
        const detail = await fetchDetail(String(event.id));
        if (signal.aborted) return;
        const brief = row(detail.brief);
        Object.assign(event, {
          fact_summary: rows(detail.facts).find(fact => fact.validation_status === 'supported')?.quote ?? event.what_happened,
          change_summary: rows(detail.changes).slice(0, 2),
          interpretation: brief.interpretation ?? null,
          source_document: row(detail.document),
        });
        onUpdate(event);
      } catch {
        // Keep the visible feed summary; detail failures must not gate primary content.
      }
    }
  }));
}
