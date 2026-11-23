import { EXCHANGE_METADATA, STOCK_CATALOG } from './marketData';
import type { ExchangeId, MarketSimulationState, ViewMode } from './types';

export type HeatmapMode = 'off' | '2d' | '3d';

export interface HeatSourcePoint {
  id: string;
  x: number;
  z: number;
  changePct: number;
  activityWeight: number; // 0.3 .. 1.6 driven by volume/volatility/magnitude
  radius: number;
}

export interface HeatmapTile {
  symbol: string;
  name: string;
  exchange: ExchangeId;
  changePct: number;
  intensity: number; // -1..+1
  activityScore: number; // 0..1
  colorHex: string;
  textColorHex: string;
}

// Compute dynamic normalization scale so both quiet 1D sessions and volatile 5D swings read clearly
export function computeHeatScaleMax(state: MarketSimulationState): number {
  let maxAbs = 2.0; // Minimum 2% full-scale clamp so tiny noise doesn't look extreme
  for (const def of STOCK_CATALOG) {
    const rt = state.stocks[def.symbol];
    if (rt) {
      const absVal = Math.abs(rt.changePct);
      if (absVal > maxAbs) maxAbs = absVal;
    }
  }
  return Math.min(12.0, maxAbs);
}

export function normalizeHeatIntensity(changePct: number, maxAbsPct: number): number {
  const denom = Math.max(1.0, maxAbsPct);
  return Math.max(-1, Math.min(1, changePct / denom));
}

// Smooth RGB color ramp: Contraction (-1: #e11d48) -> Neutral (0: #1e293b) -> Growth (+1: #10b981)
export function heatIntensityToRgb(intensity: number): [number, number, number] {
  const clamped = Math.max(-1, Math.min(1, intensity));
  // Neutral dark slate base (#1e293b)
  const nr = 30;
  const ng = 41;
  const nb = 59;

  if (clamped >= 0) {
    // Interpolate toward vivid growth emerald (#10b981 -> #22c55e)
    const t = Math.pow(clamped, 0.8);
    const gr = 16;
    const gg = 196;
    const gb = 124;
    return [
      Math.round(nr + (gr - nr) * t),
      Math.round(ng + (gg - ng) * t),
      Math.round(nb + (gb - nb) * t),
    ];
  } else {
    // Interpolate toward contraction crimson (#e11d48)
    const t = Math.pow(-clamped, 0.8);
    const rr = 228;
    const rg = 38;
    const rb = 72;
    return [
      Math.round(nr + (rr - nr) * t),
      Math.round(ng + (rg - ng) * t),
      Math.round(nb + (rb - nb) * t),
    ];
  }
}

export function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

export function buildExchangeHeatmapTiles(
  state: MarketSimulationState,
): Record<ExchangeId, HeatmapTile[]> {
  const maxAbs = computeHeatScaleMax(state);
  const result: Record<ExchangeId, HeatmapTile[]> = {
    TSX: [],
    NASDAQ: [],
    NYSE: [],
  };

  for (const def of STOCK_CATALOG) {
    const rt = state.stocks[def.symbol];
    const changePct = rt?.changePct ?? 0;
    const intensity = normalizeHeatIntensity(changePct, maxAbs);
    const [r, g, b] = heatIntensityToRgb(intensity);
    const activityScore = Math.min(
      1,
      Math.max(0.15, Math.abs(intensity) * 0.7 + ((rt?.volatility ?? 15) / 60) * 0.3),
    );

    result[def.exchange].push({
      symbol: def.symbol,
      name: def.name,
      exchange: def.exchange,
      changePct,
      intensity,
      activityScore,
      colorHex: rgbToHex(r, g, b),
      textColorHex: Math.abs(intensity) > 0.35 ? '#f8fafc' : '#cbd5e1',
    });
  }

  return result;
}

export function collectHeatSources(
  state: MarketSimulationState,
  viewMode: ViewMode,
  compareSymbols: string[],
): HeatSourcePoint[] {
  const sources: HeatSourcePoint[] = [];

  if (viewMode === 'compare') {
    const count = compareSymbols.length;
    const spacing = count <= 2 ? 4.4 : count === 3 ? 3.8 : 3.3;

    compareSymbols.forEach((sym, idx) => {
      const rt = state.stocks[sym];
      if (!rt) return;
      const laneX = (idx - (count - 1) / 2) * spacing;
      const activity = Math.min(1.6, 0.55 + Math.abs(rt.changePct) * 0.14 + (rt.volatility / 80) * 0.35);
      // Hotspot at monolith front and along lane center
      sources.push({
        id: sym,
        x: laneX,
        z: 5.5,
        changePct: rt.changePct,
        activityWeight: activity,
        radius: 3.1,
      });
      sources.push({
        id: `${sym}:lane`,
        x: laneX,
        z: 1.5,
        changePct: rt.changePct,
        activityWeight: activity * 0.85,
        radius: 3.6,
      });
    });
    return sources;
  }

  // Overview mode: Exchange Pavilions + 15 Stock Monoliths
  (['TSX', 'NASDAQ', 'NYSE'] as ExchangeId[]).forEach((exId) => {
    const meta = EXCHANGE_METADATA[exId];
    const ex = state.exchanges[exId];
    const activity = Math.min(1.6, 0.65 + Math.abs(ex.changePct) * 0.16);
    sources.push({
      id: `ex:${exId}`,
      x: meta.worldX,
      z: meta.worldZ,
      changePct: ex.changePct,
      activityWeight: activity,
      radius: 5.4,
    });
  });

  const byExchange: Record<ExchangeId, typeof STOCK_CATALOG> = {
    TSX: STOCK_CATALOG.filter((s) => s.exchange === 'TSX'),
    NASDAQ: STOCK_CATALOG.filter((s) => s.exchange === 'NASDAQ'),
    NYSE: STOCK_CATALOG.filter((s) => s.exchange === 'NYSE'),
  };

  (['TSX', 'NASDAQ', 'NYSE'] as ExchangeId[]).forEach((exId) => {
    const exMeta = EXCHANGE_METADATA[exId];
    const list = byExchange[exId];
    list.forEach((def, idx) => {
      const rt = state.stocks[def.symbol];
      if (!rt) return;
      const t = list.length > 1 ? idx / (list.length - 1) : 0.5;
      const arcAngle = (t - 0.5) * Math.PI * 0.74;
      const radius = 5.1;
      const hx = exMeta.worldX + Math.sin(arcAngle) * radius;
      const hz = exMeta.worldZ + Math.cos(arcAngle) * radius * 0.8 + 0.55;
      const activity = Math.min(1.5, 0.45 + Math.abs(rt.changePct) * 0.14 + (rt.volatility / 85) * 0.25);

      sources.push({
        id: def.symbol,
        x: hx,
        z: hz,
        changePct: rt.changePct,
        activityWeight: activity,
        radius: 2.85,
      });
    });
  });

  return sources;
}

// Rasterizes a spatial RGBA texture + per-vertex elevation array for the 3D scene heatmap overlay
export function generateHeatmapFieldData(
  sources: HeatSourcePoint[],
  maxAbsPct: number,
  gridCols: number,
  gridRows: number,
  worldWidth: number,
  worldDepth: number,
  worldCenterZ: number,
): { rgba: Uint8Array; elevations: Float32Array } {
  const rgba = new Uint8Array(gridCols * gridRows * 4);
  const elevations = new Float32Array(gridCols * gridRows);

  for (let row = 0; row < gridRows; row++) {
    const v = row / (gridRows - 1);
    const wz = worldCenterZ + (v - 0.5) * worldDepth;

    for (let col = 0; col < gridCols; col++) {
      const u = col / (gridCols - 1);
      const wx = (u - 0.5) * worldWidth;

      let weightedSignedSum = 0;
      let weightTotal = 0;
      let maxEnergy = 0;

      for (let i = 0; i < sources.length; i++) {
        const s = sources[i];
        const dx = wx - s.x;
        const dz = wz - s.z;
        const distSq = dx * dx + dz * dz;
        const sigmaSq = s.radius * s.radius;
        if (distSq > sigmaSq * 4.5) continue;

        const falloff = Math.exp(-distSq / (2 * sigmaSq * 0.55));
        const w = falloff * s.activityWeight;
        const normPct = normalizeHeatIntensity(s.changePct, maxAbsPct);
        weightedSignedSum += normPct * w;
        weightTotal += w;
        const localEnergy = falloff * (0.25 + 0.75 * Math.min(1, Math.abs(normPct) + 0.2)) * s.activityWeight;
        if (localEnergy > maxEnergy) maxEnergy = localEnergy;
      }

      const idx = row * gridCols + col;
      const rgbaIdx = idx * 4;

      if (weightTotal < 0.025) {
        rgba[rgbaIdx] = 15;
        rgba[rgbaIdx + 1] = 23;
        rgba[rgbaIdx + 2] = 42;
        rgba[rgbaIdx + 3] = 0;
        elevations[idx] = 0;
      } else {
        const avgIntensity = Math.max(-1, Math.min(1, weightedSignedSum / weightTotal));
        const [r, g, b] = heatIntensityToRgb(avgIntensity);
        const alpha = Math.min(215, Math.round(Math.min(1, maxEnergy * 1.15) * 210));
        rgba[rgbaIdx] = r;
        rgba[rgbaIdx + 1] = g;
        rgba[rgbaIdx + 2] = b;
        rgba[rgbaIdx + 3] = alpha;
        elevations[idx] = Math.min(0.68, maxEnergy * 0.42);
      }
    }
  }

  return { rgba, elevations };
}
