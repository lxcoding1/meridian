import { StockDefinition, StockRuntimeState } from './types';

export interface DailyPricePoint {
  isoDate: string; // YYYY-MM-DD
  label: string; // e.g. "Nov 14"
  close: number;
  changeFromStartPct: number;
}

export interface StockHistory30dSummary {
  points: DailyPricePoint[];
  startPrice: number;
  endPrice: number;
  minPrice: number;
  maxPrice: number;
  periodChangePct: number;
  isPositive: boolean;
}

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatUtcDayLabel(epochSeconds: number): { isoDate: string; label: string } {
  const d = new Date(epochSeconds * 1000);
  const year = d.getUTCFullYear();
  const monthIdx = d.getUTCMonth();
  const day = d.getUTCDate();
  const mm = String(monthIdx + 1).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return {
    isoDate: `${year}-${mm}-${dd}`,
    label: `${MONTH_SHORT[monthIdx]} ${day}`,
  };
}

export function summarize30dPoints(rawPoints: Array<{ isoDate: string; label: string; close: number }>): StockHistory30dSummary {
  if (rawPoints.length === 0) {
    return {
      points: [],
      startPrice: 0,
      endPrice: 0,
      minPrice: 0,
      maxPrice: 0,
      periodChangePct: 0,
      isPositive: true,
    };
  }

  const startPrice = rawPoints[0].close;
  const endPrice = rawPoints[rawPoints.length - 1].close;
  let minPrice = startPrice;
  let maxPrice = startPrice;

  const points: DailyPricePoint[] = rawPoints.map((pt) => {
    if (pt.close < minPrice) minPrice = pt.close;
    if (pt.close > maxPrice) maxPrice = pt.close;
    const changeFromStartPct =
      startPrice > 0 ? Number((((pt.close - startPrice) / startPrice) * 100).toFixed(2)) : 0;
    return {
      isoDate: pt.isoDate,
      label: pt.label,
      close: Number(pt.close.toFixed(2)),
      changeFromStartPct,
    };
  });

  const periodChangePct =
    startPrice > 0 ? Number((((endPrice - startPrice) / startPrice) * 100).toFixed(2)) : 0;

  return {
    points,
    startPrice: Number(startPrice.toFixed(2)),
    endPrice: Number(endPrice.toFixed(2)),
    minPrice: Number(minPrice.toFixed(2)),
    maxPrice: Number(maxPrice.toFixed(2)),
    periodChangePct,
    isPositive: periodChangePct >= 0,
  };
}

export function parseYahooDaily30dSeries(rawJson: unknown): DailyPricePoint[] {
  if (!rawJson || typeof rawJson !== 'object') return [];
  const chart = (rawJson as { chart?: { result?: Array<Record<string, unknown>> } }).chart;
  const result = chart?.result?.[0];
  if (!result || typeof result !== 'object') return [];

  const timestamps = Array.isArray(result.timestamp) ? result.timestamp : [];
  const indicators = (result.indicators ?? {}) as {
    quote?: Array<{ close?: Array<number | null> }>;
  };
  const closes = Array.isArray(indicators.quote?.[0]?.close) ? indicators.quote[0].close : [];
  const meta = (result.meta ?? {}) as Record<string, unknown>;

  const dedupedByDay = new Map<string, { isoDate: string; label: string; close: number }>();
  const len = Math.min(timestamps.length, closes.length);

  for (let i = 0; i < len; i++) {
    const ts = timestamps[i];
    const closeVal = closes[i];
    if (
      typeof ts !== 'number' ||
      !Number.isFinite(ts) ||
      typeof closeVal !== 'number' ||
      !Number.isFinite(closeVal) ||
      closeVal <= 0
    ) {
      continue;
    }
    const { isoDate, label } = formatUtcDayLabel(ts);
    dedupedByDay.set(isoDate, {
      isoDate,
      label,
      close: Number(closeVal.toFixed(2)),
    });
  }

  // Ensure regularMarketPrice updates today's bar if present
  const regularPrice =
    typeof meta.regularMarketPrice === 'number' && Number.isFinite(meta.regularMarketPrice) && meta.regularMarketPrice > 0
      ? Number(meta.regularMarketPrice.toFixed(2))
      : null;
  const marketTime =
    typeof meta.regularMarketTime === 'number' && Number.isFinite(meta.regularMarketTime)
      ? meta.regularMarketTime
      : null;

  if (regularPrice !== null && marketTime !== null) {
    const { isoDate, label } = formatUtcDayLabel(marketTime);
    dedupedByDay.set(isoDate, { isoDate, label, close: regularPrice });
  }

  const ordered = Array.from(dedupedByDay.values()).sort((a, b) => a.isoDate.localeCompare(b.isoDate));
  const last30 = ordered.slice(-30);
  return summarize30dPoints(last30).points;
}

// Deterministic 30-day fallback/simulated series anchored to current stock price & beta
export function buildSimulated30dSeries(
  def: StockDefinition,
  runtime: StockRuntimeState | undefined,
  referenceEpochMs = Date.now(),
): DailyPricePoint[] {
  const days = 30;
  const endPrice = runtime?.price ?? def.basePrice;
  const dailyVol = Math.max(0.006, ((runtime?.volatility ?? 18) / 100) / Math.sqrt(252));

  // Deterministic hash per symbol so each ticker has a unique realistic curve
  let hash = 2166136261;
  for (let i = 0; i < def.symbol.length; i++) {
    hash ^= def.symbol.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  let state = (hash >>> 0) || 1;
  const nextRand = () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  // Walk backwards from endPrice so the final point equals current price cleanly
  const prices = new Array<number>(days);
  prices[days - 1] = endPrice;
  const trendBias = ((runtime?.changePct ?? 0) >= 0 ? 0.0012 : -0.0012);

  for (let i = days - 2; i >= 0; i--) {
    const shock = (nextRand() - 0.5) * 2 * dailyVol * 1.45 + trendBias;
    const prevPrice = prices[i + 1] / Math.max(0.5, 1 + shock);
    prices[i] = Math.max(1, Number(prevPrice.toFixed(2)));
  }

  const rawPoints: Array<{ isoDate: string; label: string; close: number }> = [];
  const dayMs = 86_400_000;
  for (let i = 0; i < days; i++) {
    const dayEpochSec = Math.floor((referenceEpochMs - (days - 1 - i) * dayMs) / 1000);
    const { isoDate, label } = formatUtcDayLabel(dayEpochSec);
    rawPoints.push({
      isoDate,
      label,
      close: prices[i],
    });
  }

  return summarize30dPoints(rawPoints).points;
}
