import { describe, expect, it } from 'vitest';
import type { LibraryRecord } from '@/src/core/domain/entities';
import { summaryUsageStats } from '@/src/core/summaryUsage';

function record(overrides: Partial<LibraryRecord>): LibraryRecord {
  return {
    id: 'record-1',
    createdAt: '2026-07-08T00:00:00.000Z',
    updatedAt: '2026-07-08T00:00:00.000Z',
    ...overrides,
  };
}

describe('summary usage stats', () => {
  it('counts resummaries as separate summary runs', () => {
    const stats = summaryUsageStats([
      record({
        summaryUsageHistory: [
          {
            id: 'run-1',
            generatedAt: '2026-07-08T01:00:00.000Z',
            usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 },
          },
          {
            id: 'run-2',
            generatedAt: '2026-07-08T02:00:00.000Z',
            usage: { inputTokens: 110, outputTokens: 25, totalTokens: 135 },
          },
        ],
      }),
    ]);

    expect(stats.events).toHaveLength(2);
    expect(stats.eventsWithUsage).toHaveLength(2);
    expect(stats.totals).toEqual({ input: 210, output: 45, total: 255 });
  });

  it('separates today from all-time usage by local date', () => {
    const stats = summaryUsageStats(
      [
        record({
          summaryUsageHistory: [
            {
              id: 'today',
              generatedAt: '2026-07-08T01:00:00.000Z',
              usage: { inputTokens: 50, outputTokens: 10, totalTokens: 60 },
            },
            {
              id: 'yesterday',
              generatedAt: '2026-07-07T01:00:00.000Z',
              usage: { inputTokens: 80, outputTokens: 15, totalTokens: 95 },
            },
          ],
        }),
      ],
      new Date('2026-07-08T12:00:00.000Z'),
    );

    expect(stats.todayEvents.map((event) => event.id)).toEqual(['today']);
    expect(stats.todayTotals).toEqual({ input: 50, output: 10, total: 60 });
    expect(stats.totals).toEqual({ input: 130, output: 25, total: 155 });
  });

  it('backfills one usage event for legacy records without history', () => {
    const stats = summaryUsageStats([
      record({
        id: 'legacy',
        summaryGeneratedAt: '2026-07-08T03:00:00.000Z',
        summaryTokenUsage: { inputTokens: 5, outputTokens: 2, totalTokens: 7 },
      }),
    ]);

    expect(stats.events).toHaveLength(1);
    expect(stats.events[0].id).toBe('legacy:latest-summary');
    expect(stats.totals).toEqual({ input: 5, output: 2, total: 7 });
  });
});
