import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialMarketState } from './marketEngine';
import { assessStockMomentum, collectMomentumEmitters } from './momentumParticles';
import type { StockRuntimeState } from './types';

function makeStock(overrides: Partial<StockRuntimeState>): StockRuntimeState {
  return {
    symbol: 'TEST',
    price: 100,
    openPrice: 100,
    highPrice: 100.5,
    lowPrice: 99.5,
    changePct: 0.2,
    volumeM: 3.0,
    volatility: 14.0,
    history: [100, 100.05, 100.1, 100.15, 100.18, 100.2],
    ...overrides,
  };
}

test('calm low-volatility stock does not emit momentum particles', () => {
  const res = assessStockMomentum(makeStock({ changePct: 0.3, volatility: 14 }), 100);
  assert.equal(res.active, false);
  assert.equal(res.reason, 'calm');
  assert.equal(res.intensity, 0);
});

test('high-volatility stock emits particles even with modest price change', () => {
  const res = assessStockMomentum(makeStock({ changePct: 0.4, volatility: 38 }), 100);
  assert.equal(res.active, true);
  assert.equal(res.reason, 'volatility');
  assert.ok(res.intensity > 0.3);
});

test('positive price spike emits upward burst momentum and negative spike emits contraction momentum', () => {
  const up = assessStockMomentum(
    makeStock({ price: 105, changePct: 5.0, volatility: 32 }),
    102,
  );
  assert.equal(up.active, true);
  assert.equal(up.direction, 1);
  assert.equal(up.reason, 'both');
  assert.equal(up.isBurst, true);

  const down = assessStockMomentum(
    makeStock({ price: 96, changePct: -4.0, volatility: 18 }),
    98.5,
  );
  assert.equal(down.active, true);
  assert.equal(down.direction, -1);
  assert.equal(down.reason, 'spike');
  assert.equal(down.isBurst, true);
});

test('collectMomentumEmitters filters to compareSymbols when in compare mode', () => {
  const state = createInitialMarketState(20261123, 'volatility_spike');
  state.stocks['NVDA'] = {
    ...state.stocks['NVDA'],
    changePct: 6.5,
    volatility: 44,
  };
  state.stocks['CAT'] = {
    ...state.stocks['CAT'],
    changePct: -5.1,
    volatility: 39,
  };

  const overviewEmitters = collectMomentumEmitters(state, {}, 'overview', ['NVDA']);
  assert.ok(overviewEmitters.some((e) => e.symbol === 'NVDA'));
  assert.ok(overviewEmitters.some((e) => e.symbol === 'CAT'));

  const compareEmitters = collectMomentumEmitters(state, {}, 'compare', ['NVDA']);
  assert.deepEqual(
    compareEmitters.map((e) => e.symbol),
    ['NVDA'],
  );
});
