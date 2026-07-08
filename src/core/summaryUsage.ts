import type { LibraryRecord, SummaryUsageEvent } from './domain/entities';

export type SummaryUsageTotals = {
  input: number;
  output: number;
  total: number;
};

export type SummaryUsageStats = {
  events: SummaryUsageEvent[];
  eventsWithUsage: SummaryUsageEvent[];
  totals: SummaryUsageTotals;
  todayEvents: SummaryUsageEvent[];
  todayEventsWithUsage: SummaryUsageEvent[];
  todayTotals: SummaryUsageTotals;
};

const EMPTY_TOTALS: SummaryUsageTotals = { input: 0, output: 0, total: 0 };

export function summaryUsageEventsForRecord(record: LibraryRecord): SummaryUsageEvent[] {
  if (record.summaryUsageHistory?.length) return record.summaryUsageHistory;
  if (!record.summaryGeneratedAt && !record.summaryTokenUsage) return [];
  return [
    {
      id: `${record.id}:latest-summary`,
      generatedAt: record.summaryGeneratedAt ?? record.updatedAt,
      provider: record.summaryProvider,
      model: record.summaryModel,
      usage: record.summaryTokenUsage,
    },
  ];
}

export function summaryUsageStats(records: LibraryRecord[], now = new Date()): SummaryUsageStats {
  const events = records
    .flatMap(summaryUsageEventsForRecord)
    .sort((a, b) => b.generatedAt.localeCompare(a.generatedAt));
  const todayEvents = events.filter((event) => isSameLocalDate(event.generatedAt, now));
  return {
    events,
    eventsWithUsage: events.filter((event) => event.usage),
    totals: summaryUsageTotals(events),
    todayEvents,
    todayEventsWithUsage: todayEvents.filter((event) => event.usage),
    todayTotals: summaryUsageTotals(todayEvents),
  };
}

function summaryUsageTotals(events: SummaryUsageEvent[]): SummaryUsageTotals {
  return events.reduce(
    (totals, event) => ({
      input: totals.input + (event.usage?.inputTokens ?? 0),
      output: totals.output + (event.usage?.outputTokens ?? 0),
      total: totals.total + (event.usage?.totalTokens ?? 0),
    }),
    EMPTY_TOTALS,
  );
}

function isSameLocalDate(value: string, now: Date): boolean {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}
