import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildExchangeHeatmapTiles,
  collectHeatSources,
  generateHeatmapFieldData,
  heatIntensityToRgb,
  normalizeHeatIntensity,
} from './heatmap';
import { createInitialMarketState } from './marketEngine';

test('heatIntensityToRgb maps positive growth to green and negative contraction to red', () => {
  const [gr, gg, gb] = heatIntensityToRgb(1.0);
  const [rr, rg, rb] = heatIntensityToRgb(-1.0);
  const [nr, ng, nb] = heatIntensityToRgb(0.0);

  assert.ok(gg > gr && gg > gb, 'Growth color should be green-dominant');
  assert.ok(rr > rg && rr > rb, 'Contraction color should be red-dominant');
  assert.equal(nr, 30);
  assert.equal(ng, 41);
  assert.equal(nb, 59);
});

test('normalizeHeatIntensity clamps within [-1, 1]', () => {
  assert.equal(normalizeHeatIntensity(10, 4), 1);
  assert.equal(normalizeHeatIntensity(-10, 4), -1);
  assert.equal(normalizeHeatIntensity(2, 4), 0.5);
});

test('buildExchangeHeatmapTiles populates 5 tiles per exchange', () => {
  const state = createInitialMarketState(2026, 'normal');
  const tiles = buildExchangeHeatmapTiles(state);
  assert.equal(tiles.TSX.length, 5);
  assert.equal(tiles.NASDAQ.length, 5);
  assert.equal(tiles.NYSE.length, 5);
});

test('generateHeatmapFieldData produces valid RGBA buffer and elevated energy near heat sources', () => {
  const state = createInitialMarketState(2026, 'tech_rally');
  const sources = collectHeatSources(state, 'overview', []);
  assert.equal(sources.length, 18); // 3 exchanges + 15 stocks

  const { rgba, elevations } = generateHeatmapFieldData(sources, 4.0, 32, 20, 44, 24, 0.5);
  assert.equal(rgba.length, 32 * 20 * 4);
  assert.equal(elevations.length, 32 * 20);

  // At least some cells near exchange pavilions must have non-zero alpha and elevation
  let nonZeroAlpha = 0;
  let maxElev = 0;
  for (let i = 0; i < elevations.length; i++) {
    if (rgba[i * 4 + 3] > 0) nonZeroAlpha++;
    if (elevations[i] > maxElev) maxElev = elevations[i];
  }
  assert.ok(nonZeroAlpha > 20);
  assert.ok(maxElev > 0.05);
});
