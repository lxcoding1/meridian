import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyLiveMarketSnapshot,
  isValidTickerSymbol,
  normalizeMarketRange,
  parseYahooChartResult,
  resampleSeries,
} from './liveMarketAdapter';
import { createInitialMarketState } from './marketEngine';

test('isValidTickerSymbol validates strict ticker format and rejects injection payloads', () => {
  assert.equal(isValidTickerSymbol('NVDA'), true);
  assert.equal(isValidTickerSymbol('RY.TO'), true);
  assert.equal(isValidTickerSymbol('^GSPTSE'), true);
  assert.equal(isValidTickerSymbol('../etc/passwd'), false);
  assert.equal(isValidTickerSymbol('NVDA?foo=1'), false);
  assert.equal(isValidTickerSymbol('nvda'), false);
  assert.equal(isValidTickerSymbol(''), false);
});

test('normalizeMarketRange only permits allowed Yahoo ranges', () => {
  assert.equal(normalizeMarketRange('1d'), '1d');
  assert.equal(normalizeMarketRange('5d'), '5d');
  assert.equal(normalizeMarketRange('1mo'), '1mo');
  assert.equal(normalizeMarketRange('1y'), '1y');
  assert.equal(normalizeMarketRange('invalid'), '1d');
  assert.equal(normalizeMarketRange(null), '1d');
});

test('resampleSeries interpolates cleanly to 64 points', () => {
  const res = resampleSeries([100, 110, 120], 64);
  assert.equal(res.length, 64);
  assert.equal(res[0], 100);
  assert.equal(res[63], 120);
});

test('parseYahooChartResult parses sparse Yahoo v8 chart JSON accurately', () => {
  const mockYahooJson = {
    chart: {
      result: [
        {
          meta: {
            symbol: 'RY.TO',
            currency: 'CAD',
            regularMarketPrice: 270.81,
            chartPreviousClose: 263.05,
            regularMarketDayHigh: 271.5,
            regularMarketDayLow: 267.45,
            regularMarketVolume: 1500000,
            marketState: 'REGULAR',
          },
          indicators: {
            quote: [
              {
                close: [264.0, null, 266.5, 268.2, 270.81],
              },
            ],
          },
        },
      ],
    },
  };

  const parsed = parseYahooChartResult(mockYahooJson, 'RY.TO');
  assert.ok(parsed);
  assert.equal(parsed.symbol, 'RY.TO');
  assert.equal(parsed.currency, 'CAD');
  assert.equal(parsed.price, 270.81);
  assert.equal(parsed.previousClose, 263.05);
  assert.equal(parsed.changePct, 2.95);
  assert.equal(parsed.volumeM, 1.5);
  assert.equal(parsed.history.length, 64);
});

test('applyLiveMarketSnapshot updates exchanges and stocks without mutating previous state', () => {
  const initial = createInitialMarketState(100, 'normal');
  const nvdaPrev = initial.stocks['NVDA'].price;

  const updated = applyLiveMarketSnapshot(initial, {
    source: 'yahoo_finance',
    fetchedAt: '2026-11-23T17:30:00.000Z',
    range: '1d',
    failedSymbols: [],
    exchanges: {
      TSX: {
        symbol: '^GSPTSE',
        currency: 'CAD',
        price: 34196.47,
        previousClose: 33189.85,
        openPrice: 33953.39,
        highPrice: 34268.75,
        lowPrice: 33953.39,
        changePct: 3.03,
        volumeM: 94.6,
        volatility: 12.1,
        history: Array(64).fill(34196.47),
      },
    },
    stocks: {
      NVDA: {
        symbol: 'NVDA',
        currency: 'USD',
        price: 166.02,
        previousClose: 125.53,
        openPrice: 156.93,
        highPrice: 171.5,
        lowPrice: 156.93,
        changePct: 32.26,
        volumeM: 525.2,
        volatility: 28.4,
        history: Array(64).fill(166.02),
      },
    },
  });

  assert.equal(initial.stocks['NVDA'].price, nvdaPrev);
  assert.equal(updated.stocks['NVDA'].price, 166.02);
  assert.equal(updated.stocks['NVDA'].changePct, 32.26);
  assert.equal(updated.exchanges.TSX.currentIndex, 34196.47);
  assert.equal(updated.exchanges.TSX.changePct, 3.03);
});
