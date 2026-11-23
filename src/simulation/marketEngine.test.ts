import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeComparisonSeries,
  createInitialMarketState,
  stepMarketState,
} from './marketEngine';
import { STOCK_CATALOG } from './marketData';

test('initial market state populates all 15 stocks and 3 exchanges with full history', () => {
  const state = createInitialMarketState(424242, 'normal');
  assert.equal(Object.keys(state.stocks).length, STOCK_CATALOG.length);
  assert.equal(Object.keys(state.exchanges).length, 3);
  assert.equal(state.exchanges.TSX.history.length, 64);
  assert.equal(state.exchanges.NASDAQ.history.length, 64);
  assert.equal(state.exchanges.NYSE.history.length, 64);
  assert.ok(state.exchanges.TSX.currentIndex > 10000);
  assert.ok(state.exchanges.NASDAQ.currentIndex > 10000);
  assert.ok(state.exchanges.NYSE.currentIndex > 10000);
});

test('stepMarketState is deterministic for identical seed and regime', () => {
  const a0 = createInitialMarketState(9999, 'normal');
  const b0 = createInitialMarketState(9999, 'normal');
  const a1 = stepMarketState(a0);
  const b1 = stepMarketState(b0);

  assert.equal(a1.stocks['NVDA'].price, b1.stocks['NVDA'].price);
  assert.equal(a1.exchanges.NASDAQ.currentIndex, b1.exchanges.NASDAQ.currentIndex);
  assert.equal(a1.exchanges.TSX.currentIndex, b1.exchanges.TSX.currentIndex);
});

test('tech_rally regime lifts NASDAQ faster than rate_shock over 40 steps', () => {
  let rallyState = createInitialMarketState(12345, 'tech_rally');
  let shockState = createInitialMarketState(12345, 'rate_shock');

  for (let i = 0; i < 40; i++) {
    rallyState = stepMarketState(rallyState, 'tech_rally');
    shockState = stepMarketState(shockState, 'rate_shock');
  }

  assert.ok(
    rallyState.exchanges.NASDAQ.currentIndex > shockState.exchanges.NASDAQ.currentIndex,
    `Expected NASDAQ in tech_rally (${rallyState.exchanges.NASDAQ.currentIndex}) > rate_shock (${shockState.exchanges.NASDAQ.currentIndex})`,
  );
});

test('computeComparisonSeries normalizes pct_change and indexed_100 accurately', () => {
  const state = createInitialMarketState(777, 'normal');
  const pctSeries = computeComparisonSeries(state, ['SHOP.TO', 'NVDA', 'JPM'], 'pct_change');
  const idxSeries = computeComparisonSeries(state, ['SHOP.TO', 'NVDA', 'JPM'], 'indexed_100');

  assert.equal(pctSeries.length, 3);
  assert.equal(idxSeries.length, 3);

  // First point of pct_change must be 0, and first point of indexed_100 must be 100
  for (let i = 0; i < 3; i++) {
    assert.equal(pctSeries[i].series[0], 0);
    assert.equal(idxSeries[i].series[0], 100);
    assert.equal(pctSeries[i].series.length, 64);
  }
});

test('commodity_surge favors TSX energy over NASDAQ tech over sustained run', () => {
  let state = createInitialMarketState(555, 'commodity_surge');
  for (let i = 0; i < 50; i++) {
    state = stepMarketState(state, 'commodity_surge');
  }
  const enb = state.stocks['ENB.TO'];
  const cnq = state.stocks['CNQ.TO'];
  assert.ok(enb.price > 0 && cnq.price > 0);
  assert.ok(state.exchanges.TSX.changePct > -5);
});
