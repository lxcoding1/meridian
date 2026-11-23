import { STOCK_CATALOG } from './marketData';
import type { MarketSimulationState, StockRuntimeState, ViewMode } from './types';

export type MomentumReason = 'calm' | 'volatility' | 'spike' | 'both';

export interface MomentumAssessment {
  active: boolean;
  intensity: number; // 0..1
  direction: -1 | 0 | 1;
  reason: MomentumReason;
  isBurst: boolean;
}

export interface MomentumEmitterSpec {
  symbol: string;
  intensity: number;
  direction: -1 | 0 | 1;
  reason: MomentumReason;
  isBurst: boolean;
  primaryHex: string;
  secondaryHex: string;
}

export const VOLATILITY_EMIT_THRESHOLD = 24.0;
export const SESSION_SPIKE_PCT_THRESHOLD = 2.1;
export const STEP_SPIKE_PCT_THRESHOLD = 0.35;

export function assessStockMomentum(
  rt: StockRuntimeState,
  prevPrice?: number,
): MomentumAssessment {
  const absChange = Math.abs(rt.changePct);
  const stepJumpPct =
    typeof prevPrice === 'number' && prevPrice > 0
      ? ((rt.price - prevPrice) / prevPrice) * 100
      : 0;
  const absStepJump = Math.abs(stepJumpPct);

  // Also inspect tail momentum inside recent history bars
  let tailSpikePct = 0;
  if (rt.history.length >= 6) {
    const latest = rt.history[rt.history.length - 1];
    const prior = rt.history[rt.history.length - 5];
    if (prior > 0) {
      tailSpikePct = ((latest - prior) / prior) * 100;
    }
  }
  const absTailSpike = Math.abs(tailSpikePct);

  const highVolatility = rt.volatility >= VOLATILITY_EMIT_THRESHOLD;
  const hasSessionSpike = absChange >= SESSION_SPIKE_PCT_THRESHOLD;
  const hasStepSpike = absStepJump >= STEP_SPIKE_PCT_THRESHOLD;
  const hasTailSpike = absTailSpike >= 1.25;
  const hasSpike = hasSessionSpike || hasStepSpike || hasTailSpike;

  if (!highVolatility && !hasSpike) {
    return {
      active: false,
      intensity: 0,
      direction: 0,
      reason: 'calm',
      isBurst: false,
    };
  }

  const volScore = highVolatility
    ? Math.min(1, (rt.volatility - VOLATILITY_EMIT_THRESHOLD) / 28 + 0.25)
    : 0;
  const spikeScore = hasSpike
    ? Math.min(
        1,
        Math.max(
          absChange / 8.0,
          absStepJump / 1.4,
          absTailSpike / 3.5,
        ),
      )
    : 0;

  const intensity = Math.max(0.22, Math.min(1, Math.max(volScore, spikeScore) * 0.8 + Math.min(volScore, spikeScore) * 0.3));

  let direction: -1 | 0 | 1 = 0;
  if (hasStepSpike) {
    direction = stepJumpPct >= 0 ? 1 : -1;
  } else if (hasSessionSpike || hasTailSpike) {
    direction = rt.changePct >= 0 ? 1 : -1;
  } else {
    direction = rt.changePct > 0.2 ? 1 : rt.changePct < -0.2 ? -1 : 0;
  }

  const reason: MomentumReason =
    highVolatility && hasSpike ? 'both' : hasSpike ? 'spike' : 'volatility';

  return {
    active: true,
    intensity: Number(intensity.toFixed(3)),
    direction,
    reason,
    isBurst: hasStepSpike || absChange >= 4.0,
  };
}

export function collectMomentumEmitters(
  state: MarketSimulationState,
  prevPrices: Record<string, number>,
  viewMode: ViewMode,
  compareSymbols: string[],
): MomentumEmitterSpec[] {
  const emitters: MomentumEmitterSpec[] = [];

  for (const def of STOCK_CATALOG) {
    if (viewMode === 'compare' && !compareSymbols.includes(def.symbol)) {
      continue;
    }
    const rt = state.stocks[def.symbol];
    if (!rt) continue;

    const assessment = assessStockMomentum(rt, prevPrices[def.symbol]);
    if (!assessment.active) continue;

    let primaryHex = '#38bdf8';
    let secondaryHex = '#facc15';

    if (assessment.direction > 0) {
      primaryHex = '#34d399';
      secondaryHex = '#38bdf8';
    } else if (assessment.direction < 0) {
      primaryHex = '#fb7185';
      secondaryHex = '#f59e0b';
    }

    emitters.push({
      symbol: def.symbol,
      intensity: assessment.intensity,
      direction: assessment.direction,
      reason: assessment.reason,
      isBurst: assessment.isBurst,
      primaryHex,
      secondaryHex,
    });
  }

  return emitters;
}
