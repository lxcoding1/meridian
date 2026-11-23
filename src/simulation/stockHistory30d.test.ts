import test from 'node:test';
import assert from 'node:assert/strict';
import { STOCK_CATALOG } from './marketData';
import {
  buildSimulated30dSeries,
  parseYahooDaily30dSeries,
  summarize30dPoints,
} from './stockHistory30d';

test('parseYahooDaily30dSeries parses daily timestamps, filters nulls, and computes cumulative change', () => {
  const baseTs = Date.UTC(2026, 10, 1, 14, 30, 0) / 1000;
  const mockYahoo = {
    chart: {
      result: [
        {
          meta: {
            symbol: 'NVDA',
            regularMarketPrice: 120,
            regularMarketTime: baseTs + 3 * 86400,
          },
          timestamp: [baseTs, baseTs + 86400, baseTs + 2 * 86400, baseTs + 3 * 86400],
          indicators: {
            quote: [
              {
                close: [100, null, 110, 118],
              },
            ],
          },
        },
      ],
    },
  };

  const points = parseYahooDaily30dSeries(mockYahoo);
  assert.equal(points.length, 3);
  assert.equal(points[0].isoDate, '2026-11-01');
  assert.equal(points[0].label, 'Nov 1');
  assert.equal(points[0].close, 100);
  assert.equal(points[0].changeFromStartPct, 0);
  assert.equal(points[1].close, 110);
  assert.equal(points[1].changeFromStartPct, 10);
  assert.equal(points[2].close, 120);
  assert.equal(points[2].changeFromStartPct, 20);
});

test('summarize30dPoints calculates min, max, start, end, and positive/negative return', () => {
  const summary = summarize30dPoints([
    { isoDate: '2026-11-01', label: 'Nov 1', close: 200 },
    { isoDate: '2026-11-02', label: 'Nov 2', close: 215 },
    { isoDate: '2026-11-03', label: 'Nov 3', close: 180 },
  ]);

  assert.equal(summary.startPrice, 200);
  assert.equal(summary.endPrice, 180);
  assert.equal(summary.minPrice, 180);
  assert.equal(summary.maxPrice, 215);
  assert.equal(summary.periodChangePct, -10);
  assert.equal(summary.isPositive, false);
});

test('buildSimulated30dSeries builds deterministic 30-day curve anchored to current price', () => {
  const def = STOCK_CATALOG.find((s) => s.symbol === 'SHOP.TO')!;
  const fixedNow = Date.UTC(2026, 10, 23, 17, 0, 0);
  const runtime = {
    symbol: 'SHOP.TO',
    price: 194.25,
    openPrice: 190.0,
    highPrice: 195.0,
    lowPrice: 189.0,
    changePct: 2.24,
    volumeM: 4.5,
    volatility: 28.0,
    history: [190, 194.25],
  };

  const a = buildSimulated30dSeries(def, runtime, fixedNow);
  const b = buildSimulated30dSeries(def, runtime, fixedNow);

  assert.equal(a.length, 30);
  assert.equal(a[a.length - 1].close, 194.25);
  assert.deepEqual(a, b);
});
