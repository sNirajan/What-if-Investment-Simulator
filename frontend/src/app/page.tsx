
'use client';

// NOTE: This file is intentionally **heavily commented**
// The comments explain *what* each line does and *why* I wrote it that way.

import { useEffect, useMemo, useRef, useState } from 'react'; // React hooks for state, lifecycle, memoization, and refs
import { postBacktest, type BacktestResponse } from '../lib/api'; // Our typed API client to call the backend (adjust the path if needed)

/**
 * What‑If Simulator — Page (Query‑permalink edition, fully annotated)
 * ------------------------------------------------------------------
 * This page:
 *   1) Renders a dark, modern UI with a lightweight SVG chart (no extra chart lib)
 *   2) Calls `/api/v1/backtest` using a typed API client (`postBacktest`)
 *   3) Implements **frontend‑only permalinks** via URL query parameters:
 *        - On first load: read `?ticker&amount&start&end` → prefill inputs
 *        - If all query values are valid: auto‑run backtest **once**
 *        - After a successful run: keep the URL in sync with the current inputs
 *        - "Copy Permalink" copies a shareable URL with those query params
 *
 * Important mental model:
 *   - Inputs (ticker, amount, dates) live in React state
 *   - Clicking "Run backtest" posts that state to the backend → returns JSON
 *   - We compute a derived array `chartData = series * shares` to plot **portfolio value**
 *   - We format numbers for display only (no business logic in formatting)
 */
export default function Page() {
  // 
  // Controlled input state (what the user types)
  // Default values make snapping visible (start is a weekend)
  // 
  const [ticker, setTicker] = useState('TSLA'); // e.g., stock symbol
  const [amount, setAmount] = useState<number>(100); // how many dollars to invest at start
  const [start, setStart] = useState('2016-01-03'); // requested start date (YYYY‑MM‑DD)
  const [end, setEnd] = useState('2016-12-30'); // requested end date (YYYY‑MM‑DD)
  const [copied, setCopied] = useState(false);  // copy status for copy permalink 

  // 
  // Request lifecycle state
  // `data` holds the last successful backtest result from the server
  // `error` holds a human message if the call fails (e.g., bad ticker)
  // `loading` flips while the request is in flight
  // `queriedAt` is a human timestamp for when results were fetched
  //
  const [data, setData] = useState<BacktestResponse | null>(null);
  const [error, setError] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [queriedAt, setQueriedAt] = useState<string>('');

  // Permalink helpers
  const [loadedFromURL, setLoadedFromURL] = useState(false); // shows a badge if we hydrated from URL
  const hasAutoRun = useRef(false); // prevents double auto‑run in React strict/dev

  // 
  // Presentational format helpers (UI only; keep logic elsewhere)
  // 
  const fmtCurrency = (n: number) => // $X,XXX.XX formatted with the user's locale
    n.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
  const fmtPct = (n: number) => `${(n * 100).toFixed(2)}%`; // convert 0.1234 → "12.34%" for display

  // 
  // Core action: POST current inputs to the backend and handle results
  // Also keeps the URL query in sync so refresh/bookmark/share reproduces inputs
  // 
  async function runBacktest() {
    setLoading(true); // start spinner
    setError(''); // clear older error, if any
    setData(null); // clear older data until we have fresh results
    try {
      // Call the typed API client. Backend validates and computes the result.
      const res = await postBacktest({
        ticker,
        amount: Number(amount), // ensure number type
        start_date: start,
        end_date: end,
        cadence: 'lump_sum', // MVP cadence (buy once at start)
      });

      setData(res); // store successful result (series, shares, final_value, etc.)
      setQueriedAt(new Date().toLocaleString()); // capture when we fetched it (for the header)

      // Sync the URL with the current inputs so reload/bookmark works
      try {
        const q = new URLSearchParams({
          ticker,
          amount: String(amount),
          start,
          end,
        }).toString();
        const next = `${window.location.pathname}?${q}`; // keep same path, update query
        window.history.replaceState({}, '', next); // mutate URL without navigation
      } catch {
        // If History API is unavailable for some reason, silently ignore
      }
    } catch (e: unknown) {
      // The client surfaces human errors (e.g., Zod validation message)
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setLoading(false); // stop spinner regardless of success/failure
    }
  }

  // 
  // Allow pressing Enter to trigger the run from anywhere in the form
  // 
  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault(); // prevent submitting a real HTML form or reloading
      if (!loading) void runBacktest(); // ignore Enter while already loading
    }
  }

  //
  // Frontend‑only permalinks: read query ONCE on first mount
  // If all four values are present and valid → auto‑run a single backtest
  // 
  useEffect(() => {
    if (hasAutoRun.current) return; // guard against strict‑mode double mount
    hasAutoRun.current = true;

    const params = new URLSearchParams(window.location.search); // read ?key=value pairs
    const qTicker = params.get('ticker'); // string | null
    const qAmount = params.get('amount'); // string | null
    const qStart = params.get('start'); // string | null
    const qEnd = params.get('end'); // string | null


    const iso = /^\d{4}-\d{2}-\d{2}$/; // simple YYYY‑MM‑DD check
    let changed = false; // track if we touched any state

    if (qTicker) { setTicker(qTicker.toUpperCase()); changed = true; } // normalize ticker case
    if (qAmount && !Number.isNaN(Number(qAmount))) { setAmount(Number(qAmount)); changed = true; }
    if (qStart && iso.test(qStart)) { setStart(qStart); changed = true; }
    if (qEnd && iso.test(qEnd)) { setEnd(qEnd); changed = true; }

    if (changed) setLoadedFromURL(true); // show a small badge in the header

    // If all are provided and the dates look valid → run once (after state settles)
    if (qTicker && qAmount && qStart && qEnd && iso.test(qStart) && iso.test(qEnd)) {
      Promise.resolve().then(() => runBacktest()); // microtask lets setState "stick" first
    }
    // eslint‑disable next line avoids React complaining that runBacktest is a dep; we want one‑time behavior
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 
  // Derived data for the chart: portfolio value per day
  // series[i].adj_close = adjusted close price on day i
  // data.shares        = how many shares our dollars bought at start (fees applied if any)
  // value[i]           = shares * adj_close[i]  (this is what a user cares about)
  //
  const chartData = useMemo(() => {
    if (!data) return [] as { date: string; value: number }[]; // empty when no result yet
    return data.series.map((p) => ({ date: p.date, value: p.adj_close * data.shares }));
  }, [data]); // recompute only when the result changes

  // 
  // NEW (clarity feature): Start/End adjusted prices for cross‑checking with Yahoo
  // Why: users often compare our **portfolio value** with the last **stock price** they
  // see on Yahoo. Showing both start/end **adjusted close** prices makes the math obvious:
  // final portfolio value ≈ shares × (end adjusted price).
  // We memoize to recompute only when a new backtest result arrives.
  const startPrice = useMemo(() => (data ? data.series[0]?.adj_close ?? null : null), [data]);
  const endPrice   = useMemo(() => (data ? data.series[data.series.length - 1]?.adj_close ?? null : null), [data]);
  // 

  // 
  // Download CSV of the series with derived portfolio value
  // Structure: date, adj_close, shares, value
  // 
  function downloadCSV() {
    if (!data) return; // nothing to download yet
    const header = 'date,adj_close,shares,value\n'; // CSV header row
    const rows = data.series
      .map((p) => `${p.date},${p.adj_close},${data.shares},${(p.adj_close * data.shares).toFixed(6)}`)
      .join('\n'); // each day becomes one CSV line
    const csv = header + rows + '\n'; // join header + body
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' }); // create a file in memory
    const url = URL.createObjectURL(blob); // temporary URL for the blob
    const a = document.createElement('a'); // invisible link element
    a.href = url; // point to the blob
    a.download = `${ticker.toUpperCase()}_${start}_${end}.csv`; // suggested filename
    document.body.appendChild(a); // attach to DOM so click works in all browsers
    a.click(); // trigger download
    document.body.removeChild(a); // cleanup DOM
    URL.revokeObjectURL(url); // free memory
  }

  // 
  // Copy a clean permalink reflecting the **current inputs** (not the last failed run)
  // This uses window.location.{origin,pathname} so it works even if the app path changes later
  // 
  async function copyPermalink() {
    const { origin, pathname } = window.location; // e.g., https://app.com and "/"
    const q = new URLSearchParams({ ticker, amount: String(amount), start, end }).toString(); // build query
    const link = `${origin}${pathname}?${q}`; // compose full URL
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);                 //  flip label to "Copied"
      setTimeout(() => setCopied(false), 1500); // revert after 1.5s
    } catch {
      // (optional) surface an error if you like
      setError('Could not copy link');
    }
  }

  // 
  // Render UI
  // 
  return (
    <main className="min-h-screen bg-gradient-to-b from-zinc-950 via-zinc-900 to-black text-zinc-100">{/* dark gradient background */}
      {/* soft radial accents add depth without heavy graphics */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(60rem_40rem_at_50%_-20%,rgba(59,130,246,0.12),transparent),radial-gradient(40rem_30rem_at_80%_-10%,rgba(168,85,247,0.10),transparent)]" />

      <section className="relative mx-auto max-w-6xl px-6 py-10" onKeyDown={onKeyDown}>{/* key handler at section level */}
        {/* Header with micro‑copy about data source and snapping policy */}
        <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">What‑If Simulator</h1>
            <p className="mt-1 text-sm text-zinc-400">
              <Badge>Backtest (factual)</Badge> {/* small capsule label */}
              Prices: Yahoo Finance (adjusted close)
              {queriedAt && <span className="ml-2 text-zinc-500">· {queriedAt}</span>} {/* show last run time if present */}
              {loadedFromURL && <span className="ml-2"><Badge>Loaded from URL</Badge></span>} {/* show if hydrated from query */}
            </p>
            <p className="mt-1 text-sm text-zinc-400">{/* explain snap policy briefly */}
              <span className="text-zinc-300">Start</span> snaps to <span className="text-zinc-200">next</span> trading day,
              <span className="text-zinc-300"> end</span> to <span className="text-zinc-200">previous</span>.
            </p>
          </div>
          <div className="flex items-center gap-2">{/* actions: CSV + Permalink */}
            <button
              onClick={downloadCSV}
              disabled={!data}
              className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-zinc-100 shadow transition hover:bg-white/10 disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-indigo-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-900"
            >
              Download CSV
            </button>
            <button
              onClick={copyPermalink}
              className={
                `rounded-xl border px-3 py-2 text-sm text-zinc-100 shadow transition focus-visible:ring-2
     focus-visible:ring-indigo-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-900
     ${copied
                  ? 'border-emerald-400/40 bg-emerald-400/10'
                  : 'border-white/10 bg-white/5 hover:bg-white/10'}`
              }
              aria-live="polite"                 // announce the change to screen readers
            >
              {copied ? 'Copied' : 'Copy Permalink'}
            </button>
          </div>
        </header>

        {/* Input form (controlled) */}
        <div className="grid gap-4 sm:grid-cols-2">{/* stack on mobile, 2 columns on small+ */}
          <Field label="Ticker">{/* labelled input wrapper for accessibility/consistency */}
            <input
              className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-zinc-100 placeholder-zinc-400 outline-none transition focus-visible:ring-2 focus-visible:ring-indigo-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-900"
              value={ticker} // controlled value mirrors state
              onChange={(e) => setTicker(e.target.value)} // update state on keystroke
              placeholder="e.g., TSLA" // guide the user
            />
          </Field>

          <Field label="Amount (USD)">
            <input
              className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-zinc-100 placeholder-zinc-400 outline-none transition focus-visible:ring-2 focus-visible:ring-indigo-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-900"
              type="number" // numeric input
              value={amount} // controlled value
              onChange={(e) => setAmount(Number(e.target.value))} // coerce to number
            />
          </Field>

          <Field label="Start (YYYY‑MM‑DD)">
            <input
              className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-zinc-100 placeholder-zinc-400 outline-none transition focus-visible:ring-2 focus-visible:ring-indigo-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-900"
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
          </Field>

          <Field label="End (YYYY‑MM‑DD)">
            <input
              className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-zinc-100 placeholder-zinc-400 outline-none transition focus-visible:ring-2 focus-visible:ring-indigo-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-900"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
            />
          </Field>

          {/* Run button + inline effective dates + error badge */}
          <div className="sm:col-span-2 mt-1 flex items-center gap-3">
            <button
              onClick={runBacktest}
              disabled={loading}
              className="inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-indigo-500 to-violet-500 px-5 py-2.5 font-medium text-white shadow-lg shadow-indigo-900/30 transition hover:from-indigo-400 hover:to-violet-400 disabled:opacity-60 focus-visible:ring-2 focus-visible:ring-indigo-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-900"
            >
              {loading ? 'Running…' : 'Run backtest'}
            </button>

            {/* Show effective (snapped) dates right next to the button for transparency */}
            {data && (
              <span className="text-xs text-zinc-400">
                Effective: <strong>{data.assumptions.effective_start_date}</strong> →{' '}
                <strong>{data.assumptions.effective_end_date}</strong>
              </span>
            )}

            {/* Friendly error message */}
            {error && (
              <span className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1 text-sm text-red-300">
                {error}
              </span>
            )}
          </div>
        </div>

        {/* Results panel */}
        {data && (
          <section className="mt-8 grid gap-4 lg:grid-cols-3">{/* 3 columns on large screens */}
            <InfoCard title="Window">{/* small info card describing assumptions */}
              <div className="text-sm text-zinc-200">
                <strong>{data.assumptions.effective_start_date}</strong> →{' '}
                <strong>{data.assumptions.effective_end_date}</strong>
              </div>
              <div className="mt-1 text-[11px] text-zinc-400">{data.assumptions.snap_policy}</div>
              <div className="mt-3 text-[11px] text-zinc-400">Fees: {data.assumptions.fees_bps} bps</div>
            </InfoCard>

            {/* Metric cards. We color percentages by sign (green/red). */}
            <StatCard label="Final value" value={fmtCurrency(data.final_value)} />
            <StatCard label="Total return" value={fmtPct(data.total_return_pct)} type="pct" raw={data.total_return_pct} />
            <StatCard label="CAGR" value={fmtPct(data.cagr)} type="pct" raw={data.cagr} />
            <StatCard label="Shares" value={data.shares.toFixed(6)} />

            {/* NEW: show raw stock prices (adjusted close) for cross‑checking with Yahoo */}
            {startPrice != null && <StatCard label="Start price (adj)" value={fmtCurrency(startPrice)} />}
            {endPrice   != null && <StatCard label="End price (adj)"   value={fmtCurrency(endPrice)} />}

            {/* Chart of portfolio value over time */}
            <div className="lg:col-span-3 rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur">
              <div className="mb-2 text-xs uppercase tracking-wide text-zinc-400">Portfolio value ($)</div>
              <ValueChart data={chartData} />
            </div>
          </section>
        )}
      </section>
    </main>
  );
}

// 
// Tiny presentational components to keep the page tidy
// 
function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="mr-2 inline-flex items-center gap-1 rounded-full border border-indigo-400/30 bg-indigo-400/10 px-2 py-0.5 text-[11px] font-medium text-indigo-300">
      {children}
    </span>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-zinc-400">{label}</span>
      {children}
    </label>
  );
}

function InfoCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur">
      <div className="text-xs uppercase tracking-wide text-zinc-400">{title}</div>
      <div className="mt-2">{children}</div>
    </div>
  );
}

// A small stat card. If `type="pct"` and `raw < 0`, we color the text red; otherwise green.
function StatCard({ label, value, type, raw }: { label: string; value: string; type?: 'pct' | 'plain'; raw?: number }) {
  const color = type === 'pct' && typeof raw === 'number' ? (raw >= 0 ? 'text-emerald-400' : 'text-rose-400') : 'text-zinc-100';
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur">
      <div className="mb-2 h-1.5 w-14 rounded-full bg-gradient-to-r from-indigo-500/30 to-fuchsia-400/10" />
      <div className="text-xs uppercase tracking-wide text-zinc-400">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${color}`}>{value}</div>
    </div>
  );
}

// 
// Lightweight SVG Chart
// Why custom SVG? Zero dependencies, full control, and great interview talking points.
// Hover shows a vertical rule + dot + tooltip (date, value).
// We also add y‑axis padding so the line doesn't hug the edges.
// 
function ValueChart({ data }: { data: { date: string; value: number }[] }) {
  const svgRef = useRef<SVGSVGElement | null>(null); // grab the <svg> DOM node for mouse math
  const [hover, setHover] = useState<{ i: number; x: number; y: number } | null>(null); // hover state (index + coords)

  if (!data.length) return <div className="text-sm text-zinc-400">No data</div>; // guard: nothing to draw

  // Logical canvas size (viewBox coordinates). The element stretches to container width.
  const w = 900; // width of our drawing space (not CSS pixels)
  const h = 240; // height of our drawing space
  const pad = 28; // inner padding for top/bottom/left/right

  // Compute min/max to scale the y‑axis. Add a small pad for visual headroom.
  const values = data.map((d) => d.value); // pull out the numeric series
  const minRaw = Math.min(...values);
  const maxRaw = Math.max(...values);
  const padY = Math.max((maxRaw - minRaw) * 0.08, 1e-6); // 8% of range (or a tiny epsilon)
  const min = minRaw - padY; // lower bound with padding
  const max = maxRaw + padY; // upper bound with padding

  // Mapping functions from data index/value → SVG x/y coordinates
  const x = (i: number) => pad + (i / (data.length - 1)) * (w - pad * 2); // even spacing across width
  const y = (v: number) => pad + (1 - (v - min) / (max - min || 1)) * (h - pad * 2); // invert because SVG y grows downward

  // Build a simple "move/line" path: M x0 y0 L x1 y1 L x2 y2 ...
  const dPath = data
    .map((d, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(d.value).toFixed(1)}`)
    .join(' ');

  // We'll also show a small badge for the last value at the right edge
  const last = data[data.length - 1];
  const lastY = y(last.value);

  // Mouse move handler: figure out which index is closest to the mouse X
  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = svgRef.current!.getBoundingClientRect(); // DOM rect for coordinate math
    const relX = e.clientX - rect.left; // x position relative to SVG's left edge
    const t = Math.min(Math.max((relX - pad) / (w - pad * 2), 0), 1); // normalize into [0,1]
    const i = Math.round(t * (data.length - 1)); // nearest data index
    setHover({ i, x: x(i), y: y(data[i].value) }); // store hover state for the overlays/tooltip
  }

  // When the mouse leaves the SVG, hide the tooltip
  function onLeave() { setHover(null); }

  return (
    <div className="relative">{/* wrapper so tooltip can be absolutely positioned */}
      <svg
        ref={svgRef} // keep a ref for coordinate math
        viewBox={`0 0 ${w} ${h}`} // logical drawing area
        className="h-60 w-full" // responsive height/width
        onMouseMove={onMove} // track hover position
        onMouseLeave={onLeave} // clear hover on exit
      >
        <defs>{/* gradient definition for the area fill under the line */}
          <linearGradient id="grad" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="rgba(99,102,241,0.35)" />{/* top: indigo at 35% opacity */}
            <stop offset="100%" stopColor="rgba(99,102,241,0.0)" />{/* bottom: transparent */}
          </linearGradient>
        </defs>

        <rect x="0" y="0" width={w} height={h} fill="transparent" />{/* explicit background rect */}

        {/* Area under the line (closed path back to baseline) */}
        <path d={`${dPath} L ${x(data.length - 1)} ${h - pad} L ${x(0)} ${h - pad} Z`} fill="url(#grad)" />

        {/* Main line on top of the area */}
        <path d={dPath} stroke="rgb(99,102,241)" strokeWidth="2" fill="none" />

        {/* Last‑value badge on the right edge */}
        <circle cx={w - pad} cy={lastY} r={3} fill="rgb(99,102,241)" />
        <text x={w - pad - 8} y={lastY - 8} textAnchor="end" className="fill-zinc-300 text-[10px]">
          {last.value.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })}
        </text>

        {/* Hover overlays: vertical rule + point marker */}
        {hover && (
          <>
            <line x1={hover.x} x2={hover.x} y1={pad} y2={h - pad} stroke="rgba(148,163,184,0.35)" />
            <circle cx={hover.x} cy={hover.y} r={3} fill="rgb(99,102,241)" />
          </>
        )}
      </svg>

      {/* Tooltip rendered above the SVG using absolute positioning */}
      {hover && (
        <div
          className="pointer-events-none absolute -translate-x-1/2 rounded-md border border-white/10 bg-zinc-900/90 px-2 py-1 text-[11px] text-zinc-200 shadow-lg backdrop-blur"
          style={{ left: `${hover.x}px`, top: `${hover.y - 34}px` }}
        >
          <div className="font-medium">{data[hover.i].date}</div> {/* ISO date string from series */}
          <div>
            {data[hover.i].value.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })}
          </div>
        </div>
      )}

      {/* X‑axis endpoints as a simple caption */}
      <div className="mt-1 flex items-center justify-between text-[11px] text-zinc-400">
        <span>{data[0].date}</span>
        <span>{last.date}</span>
      </div>
    </div>
  );
}






