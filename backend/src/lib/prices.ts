/**
 * Price series provider.
 * - If STUB_DATA=true → deterministic 2-point series for tests/dev.
 * - Else → fetch real daily adjusted closes via yahoo-finance2 chart API.
 * - Snap start to next trading day (>= start), end to previous trading day (<= end).
 * - Cache results by (ticker,start,end) to avoid repeated fetches.
 */
import yahooFinance from 'yahoo-finance2';
import { env } from './config.js';     // ← no .js extension in TS when using commonjs
import { cache } from './cache.js';

export type PricePoint = { date: string; adj_close: number };

const MAX_PROVIDER_ATTEMPTS = 4;

function isRateLimitedError(msg: string): boolean {
  const lowered = msg.toLowerCase();
  return lowered.includes('too many requests') || lowered.includes('429');
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// --- Date helpers -----------------------------------------------------------

// Strictly parse YYYY-MM-DD; throw if invalid.
function toDate(d: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  if (!m) throw Object.assign(new Error(`Invalid ISO date: ${d}`), { status: 400 });
  const year = Number(m[1]);
  const month = Number(m[2]); // 1..12
  const day = Number(m[3]);   // 1..31
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0)); // noon UTC avoids TZ edges
}

// Format Date → YYYY-MM-DD (UTC)
function fmt(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Find the last index whose date <= target (or -1 if none).
function findIdxAtOrBefore(series: PricePoint[], target: string): number {
  for (let i = series.length - 1; i >= 0; i--) {
    const row = series[i];        // local var prevents TS2532 warnings
    if (!row) continue;           // extra guard for TS narrow
    if (row.date <= target) return i;
  }
  return -1;
}

function findIdxAtOrAfter(series: PricePoint[], target: string): number {
  for (let i = 0; i < series.length; i++) {
    const row = series[i];
    if (!row) continue;
    if (row.date >= target) return i;
  }
  return -1;
}


// --- Main provider ----------------------------------------------------------

export async function getAdjustedSeries(
  ticker: string,
  startISO: string,
  endISO: string
): Promise<PricePoint[]> {
  if (env.isStub) {
    return [
      { date: startISO, adj_close: 10 },
      { date: endISO, adj_close: 15 },
    ];
  }

  const cacheKey = `prices:${ticker}:${startISO}:${endISO}`;
  const hit = cache.get(cacheKey) as PricePoint[] | undefined;
  if (hit) return hit;

  const start = toDate(startISO);
  const end = toDate(endISO);

  // Fetch with a small buffer so we can snap to prior trading days.
  const bufferBefore = new Date(start.getTime() - 10 * 86_400_000);
  const bufferAfter  = new Date(end.getTime()   +  2 * 86_400_000);

  type ChartQuote = { date?: Date | string; adjclose?: number | null; close?: number | null };

  let rows: ChartQuote[] = [];
  try {
    for (let attempt = 1; attempt <= MAX_PROVIDER_ATTEMPTS; attempt++) {
      try {
        const chart = await yahooFinance.chart(ticker, {
          period1: bufferBefore,
          period2: bufferAfter,
          interval: '1d',
          return: 'array',
        });

        rows = (chart?.quotes ?? []) as ChartQuote[];
        break;
      } catch (providerErr) {
        const msg = providerErr instanceof Error ? providerErr.message : String(providerErr);
        if (!isRateLimitedError(msg) || attempt === MAX_PROVIDER_ATTEMPTS) {
          throw providerErr;
        }

        const backoffMs = 400 * 2 ** (attempt - 1);
        await sleep(backoffMs);
      }
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const err: any = new Error('Price provider error');

    if (isRateLimitedError(msg)) {
      err.status = 429;
      err.detail = 'Rate-limited by price provider. Retry after ~30-60 seconds.';
    } else {
      err.status = 502;
      err.detail = msg;
    }

    throw err;
  }

  // Normalize to { date, adj_close } and sort ASC
  const series: PricePoint[] = (rows || [])
    .reduce<PricePoint[]>((acc, r) => {
      if (!r?.date) return acc;
      if (r.adjclose == null && r.close == null) return acc;

      acc.push({
        date: fmt(new Date(r.date)),
        adj_close: Number(r.adjclose ?? r.close),
      });

      return acc;
    }, [])
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  if (series.length === 0) {
    const err: any = new Error('No data for ticker/date range');
    err.status = 422;
    throw err;
  }

  // Snap to nearest prior trading days (≤ requested dates)
  const startStr = fmt(start);
  const endStr = fmt(end);
  const startIdx = findIdxAtOrAfter(series, startStr);    // NEXT
  const endIdx = findIdxAtOrBefore(series, endStr);       // PREVIOUS

  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
    const err: any = new Error('Insufficient data after trading-day snap');
    err.status = 422;
    throw err;
  }

  const window = series.slice(startIdx, endIdx + 1);
  cache.set(cacheKey, window);
  return window;
}
