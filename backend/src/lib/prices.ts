import yahooFinance from 'yahoo-finance2';
import { env } from './config.js';
import { cache } from './cache.js';

export type PricePoint = { date: string; adj_close: number };

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function parseYahooRateLimit(err: unknown): boolean {
  const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  return msg.includes('429') || msg.includes('too many requests') || msg.includes('rate limit');
}

async function fetchFromYahoo(ticker: string, start: string, end: string): Promise<PricePoint[]> {
  const data = await yahooFinance.chart(ticker, {
    period1: `${start}T00:00:00Z`,
    period2: `${end}T23:59:59Z`,
    interval: '1d',
    events: 'div,splits',
  });

  const result = data.quotes
    .map((q) => ({ date: q.date ? toIsoDate(q.date) : '', adj_close: Number(q.adjclose ?? q.close) }))
    .filter((p) => p.date && Number.isFinite(p.adj_close))
    .sort((a, b) => a.date.localeCompare(b.date));

  return result;
}

async function fetchFromStooq(ticker: string): Promise<PricePoint[]> {
  const symbol = `${ticker.toLowerCase()}.us`;
  const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(symbol)}&i=d`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Stooq fetch failed (${res.status})`);

  const text = await res.text();
  const lines = text.trim().split('\n');
  if (lines.length <= 1) return [];

  return lines
    .slice(1)
    .map((line) => line.split(','))
    .map((cols) => ({ date: cols[0] ?? '', adj_close: Number(cols[4]) }))
    .filter((p) => /^\d{4}-\d{2}-\d{2}$/.test(p.date) && Number.isFinite(p.adj_close))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function withinWindow(series: PricePoint[], start: string, end: string): PricePoint[] {
  return series.filter((p) => p.date >= start && p.date <= end);
}

function stubSeries(start: string, end: string): PricePoint[] {
  const startDate = new Date(`${start}T00:00:00Z`);
  const endDate = new Date(`${end}T00:00:00Z`);
  const out: PricePoint[] = [];
  let idx = 0;

  for (let d = new Date(startDate); d <= endDate; d.setUTCDate(d.getUTCDate() + 1)) {
    const day = d.getUTCDay();
    if (day === 0 || day === 6) continue;
    out.push({ date: toIsoDate(d), adj_close: 100 + idx * 0.5 });
    idx += 1;
  }

  return out;
}

export async function getAdjustedSeries(ticker: string, start: string, end: string): Promise<PricePoint[]> {
  if (env.isStub) return stubSeries(start, end);

  const key = `${ticker.toUpperCase()}:${start}:${end}`;
  const cached = cache.get(key) as PricePoint[] | undefined;
  if (cached) return cached;

  try {
    const yahooSeries = await fetchFromYahoo(ticker, start, end);
    if (yahooSeries.length >= 2) {
      cache.set(key, yahooSeries);
      return yahooSeries;
    }
  } catch (err) {
    if (!parseYahooRateLimit(err)) throw err;
  }

  try {
    const stooqSeries = withinWindow(await fetchFromStooq(ticker), start, end);
    if (stooqSeries.length >= 2) {
      cache.set(key, stooqSeries);
      return stooqSeries;
    }
  } catch {
    // Ignore and throw consistent error below.
  }

  const error = new Error('Price provider error') as Error & { status: number; detail?: string };
  error.status = 429;
  error.detail = 'Rate-limited by price provider. Retry after ~30-60 seconds.';
  throw error;
}
