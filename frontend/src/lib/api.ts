/**
 * Frontend API client (typed).
 *
 * Why: keep fetch logic in one place → cleaner components, consistent errors.
 * Env: NEXT_PUBLIC_API_URL is injected at build time (browser-safe).
 */

// ---------- Types: request/response shapes we expect ----------
export type PricePoint = { date: string; adj_close: number };

export type BacktestRequest = {
  ticker: string;          // e.g., "TSLA"
  amount: number;          // e.g., 100
  start_date: string;      // "YYYY-MM-DD"
  end_date: string;        // "YYYY-MM-DD"
  cadence: 'lump_sum';     // MVP supports only lump_sum
  fees_bps?: number;       // optional basis points fee, e.g., 50 = 0.50%
};

export type BacktestResponse = {
  series: PricePoint[];
  shares: number;
  final_value: number;
  total_return_pct: number; // 0.25 = +25%
  cagr: number;             // 0.18 = 18% annualized
  assumptions: {
    adjusted_prices: boolean;
    fees_bps: number;
    dividends_reinvested: boolean;
    effective_start_date: string;
    effective_end_date: string;
    snap_policy: string;    // e.g., "start=next, end=previous"
  };
};

// ---------- Env & small guard ----------
const BASE = process.env.NEXT_PUBLIC_API_URL; // defined in .env.local
function assertBase() {
  if (!BASE) {
    throw new Error(
      'NEXT_PUBLIC_API_URL is not set. Add it to frontend/.env.local and restart next dev server.'
    );
  }
}

// ---------- Tiny fetch wrapper with typed JSON + clear errors ----------
async function request<T>(path: string, options: RequestInit): Promise<T> {
  assertBase();

  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });

  // Try to parse JSON either way (errors might not be JSON)
  const data: unknown = await res.json().catch(() => null);

  if (!res.ok) {
    const errorData = data as {
      error?: string;
      message?: string;
      detail?: string;
      details?: unknown;
    } | null;

    const baseMsg = errorData?.error || errorData?.message || `Request failed (${res.status})`;
    const msg = errorData?.detail ? `${baseMsg}: ${errorData.detail}` : baseMsg;
    const err = new Error(msg) as Error & { status?: number; detail?: string; details?: unknown };
    err.status = res.status;
    if (errorData?.detail) err.detail = errorData.detail;
    if (errorData?.details) err.details = errorData.details; // Zod validation details
    throw err;
  }

  return data as T;
}

// ---------- Domain function the UI will call ----------
export async function postBacktest(body: BacktestRequest): Promise<BacktestResponse> {
  // Light, human-friendly guards (the backend still validates strictly)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(body.start_date)) {
    throw new Error('start_date must be YYYY-MM-DD');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(body.end_date)) {
    throw new Error('end_date must be YYYY-MM-DD');
  }

  const payload: BacktestRequest = {
    ...body,
    ticker: body.ticker.toUpperCase().trim(),
    cadence: 'lump_sum',
  };

  return request<BacktestResponse>('/api/v1/backtest', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
