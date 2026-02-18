import { beforeEach, describe, expect, it, vi } from 'vitest';

const chartMock = vi.fn();

vi.mock('yahoo-finance2', () => ({
  default: { chart: chartMock },
}));

describe('getAdjustedSeries fallback behavior', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.STUB_DATA = 'false';
    process.env.NODE_ENV = 'test';
    process.env.PORT = '8080';
  });

  it('falls back to Stooq when Yahoo is rate-limited', async () => {
    chartMock.mockRejectedValue(new Error('429 too many requests'));

    const csv = [
      'Date,Open,High,Low,Close,Volume',
      '2024-01-02,10,11,9,10.5,1000',
      '2024-01-03,11,12,10,11.5,1000',
      '2024-01-04,12,13,11,12.5,1000',
    ].join('\n');

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => csv,
    });
    vi.stubGlobal('fetch', fetchMock);

    const { getAdjustedSeries } = await import('../src/lib/prices.js');
    const series = await getAdjustedSeries('AAPL', '2024-01-02', '2024-01-04');

    expect(series).toEqual([
      { date: '2024-01-02', adj_close: 10.5 },
      { date: '2024-01-03', adj_close: 11.5 },
      { date: '2024-01-04', adj_close: 12.5 },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
