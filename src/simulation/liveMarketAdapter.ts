import { EXCHANGE_METADATA, HISTORY_LENGTH, STOCK_CATALOG } from './marketData';
import type { ExchangeId, ExchangeSummary, MarketSimulationState, StockRuntimeState } from './types';

export type MarketRangeId = '1d' | '5d' | '1mo' | '1y';

export const ALLOWED_RANGES: Record<MarketRangeId, { range: MarketRangeId; interval: string; label: string }> = {
  '1d': { range: '1d', interval: '5m', label: '1D' },
  '5d': { range: '5d', interval: '15m', label: '5D' },
  '1mo': { range: '1mo', interval: '1d', label: '1M' },
  '1y': { range: '1y', interval: '1wk', label: '1Y' },
};

export const EXCHANGE_INDEX_SYMBOLS: Record<ExchangeId, string> = {
  TSX: '^GSPTSE',
  NASDAQ: '^IXIC',
  NYSE: '^NYA',
};

export interface ParsedYahooQuote {
  symbol: string;
  currency: string;
  price: number;
  previousClose: number;
  openPrice: number;
  highPrice: number;
  lowPrice: number;
  changePct: number;
  volumeM: number;
  volatility: number;
  history: number[];
  marketState?: string;
}

export interface LiveMarketSnapshot {
  source: 'yahoo_finance';
  fetchedAt: string;
  range: MarketRangeId;
  exchanges: Partial<Record<ExchangeId, ParsedYahooQuote>>;
  stocks: Record<string, ParsedYahooQuote>;
  failedSymbols: string[];
}

const VALID_SYMBOL_REGEX = /^[A-Z0-9.^=-]{1,12}$/;

export function isValidTickerSymbol(symbol: unknown): symbol is string {
  return typeof symbol === 'string' && VALID_SYMBOL_REGEX.test(symbol);
}

export function normalizeMarketRange(range: unknown): MarketRangeId {
  if (typeof range === 'string' && range in ALLOWED_RANGES) {
    return range as MarketRangeId;
  }
  return '1d';
}

export function resampleSeries(values: number[], targetLength: number): number[] {
  if (values.length === 0) return [];
  if (values.length === 1) return Array(targetLength).fill(values[0]);
  if (values.length === targetLength) return values.slice();

  const out: number[] = [];
  const lastIdx = values.length - 1;
  for (let i = 0; i < targetLength; i++) {
    const pos = (i / (targetLength - 1)) * lastIdx;
    const lo = Math.floor(pos);
    const hi = Math.min(lastIdx, Math.ceil(pos));
    const frac = pos - lo;
    const interp = values[lo] * (1 - frac) + values[hi] * frac;
    out.push(Number(interp.toFixed(2)));
  }
  return out;
}

export function parseYahooChartResult(rawJson: unknown, fallbackSymbol: string): ParsedYahooQuote | null {
  if (!rawJson || typeof rawJson !== 'object') return null;
  const chart = (rawJson as { chart?: { result?: Array<Record<string, unknown>> } }).chart;
  const result = chart?.result?.[0];
  if (!result || typeof result !== 'object') return null;

  const meta = (result.meta ?? {}) as Record<string, unknown>;
  const indicators = (result.indicators ?? {}) as {
    quote?: Array<{ close?: Array<number | null>; high?: Array<number | null>; low?: Array<number | null>; volume?: Array<number | null> }>;
  };

  const quoteSeries = indicators.quote?.[0];
  const rawCloses = Array.isArray(quoteSeries?.close) ? quoteSeries.close : [];
  const validCloses = rawCloses.filter((v): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0);

  const regularPrice =
    typeof meta.regularMarketPrice === 'number' && Number.isFinite(meta.regularMarketPrice)
      ? meta.regularMarketPrice
      : validCloses[validCloses.length - 1];

  if (typeof regularPrice !== 'number' || !Number.isFinite(regularPrice) || regularPrice <= 0) {
    return null;
  }

  const prevClose =
    typeof meta.chartPreviousClose === 'number' && Number.isFinite(meta.chartPreviousClose) && meta.chartPreviousClose > 0
      ? meta.chartPreviousClose
      : typeof meta.previousClose === 'number' && Number.isFinite(meta.previousClose) && meta.previousClose > 0
        ? meta.previousClose
        : validCloses[0] ?? regularPrice;

  const historyRaw = validCloses.length > 0 ? validCloses : [prevClose, regularPrice];
  // Ensure latest point reflects live regularMarketPrice
  if (Math.abs(historyRaw[historyRaw.length - 1] - regularPrice) > 1e-4) {
    historyRaw.push(regularPrice);
  }
  const history = resampleSeries(historyRaw, HISTORY_LENGTH);

  const openPrice = historyRaw[0] || prevClose;
  const highPrice =
    typeof meta.regularMarketDayHigh === 'number' && Number.isFinite(meta.regularMarketDayHigh)
      ? meta.regularMarketDayHigh
      : Math.max(...historyRaw, regularPrice);
  const lowPrice =
    typeof meta.regularMarketDayLow === 'number' && Number.isFinite(meta.regularMarketDayLow)
      ? meta.regularMarketDayLow
      : Math.min(...historyRaw, regularPrice);

  const changePct = Number((((regularPrice - prevClose) / prevClose) * 100).toFixed(2));

  const rawVol =
    typeof meta.regularMarketVolume === 'number' && Number.isFinite(meta.regularMarketVolume)
      ? meta.regularMarketVolume
      : 0;
  const volumeM = Number((rawVol / 1_000_000).toFixed(2));

  // Estimate annualized volatility from valid close returns
  let sqSum = 0;
  let retCount = 0;
  for (let i = 1; i < history.length; i++) {
    const r = (history[i] - history[i - 1]) / history[i - 1];
    sqSum += r * r;
    retCount++;
  }
  const volatility = retCount > 0 ? Number((Math.sqrt(sqSum / retCount) * Math.sqrt(252) * 100).toFixed(1)) : 15.0;

  return {
    symbol: typeof meta.symbol === 'string' ? meta.symbol : fallbackSymbol,
    currency: typeof meta.currency === 'string' ? meta.currency : 'USD',
    price: Number(regularPrice.toFixed(2)),
    previousClose: Number(prevClose.toFixed(2)),
    openPrice: Number(openPrice.toFixed(2)),
    highPrice: Number(highPrice.toFixed(2)),
    lowPrice: Number(lowPrice.toFixed(2)),
    changePct,
    volumeM,
    volatility,
    history,
    marketState: typeof meta.marketState === 'string' ? meta.marketState : undefined,
  };
}

export function applyLiveMarketSnapshot(
  prev: MarketSimulationState,
  snapshot: LiveMarketSnapshot,
): MarketSimulationState {
  const nextStocks: Record<string, StockRuntimeState> = { ...prev.stocks };

  for (const def of STOCK_CATALOG) {
    const live = snapshot.stocks[def.symbol];
    if (!live) continue;

    nextStocks[def.symbol] = {
      symbol: def.symbol,
      price: live.price,
      openPrice: live.previousClose,
      highPrice: live.highPrice,
      lowPrice: live.lowPrice,
      changePct: live.changePct,
      volumeM: live.volumeM > 0 ? live.volumeM : prev.stocks[def.symbol]?.volumeM ?? 1.0,
      volatility: live.volatility,
      history: live.history.length === HISTORY_LENGTH ? live.history : resampleSeries(live.history, HISTORY_LENGTH),
    };
  }

  const nextExchanges = { ...prev.exchanges } as Record<ExchangeId, ExchangeSummary>;

  (['TSX', 'NASDAQ', 'NYSE'] as ExchangeId[]).forEach((exId) => {
    const prevEx = prev.exchanges[exId];
    const exStocks = STOCK_CATALOG.filter((s) => s.exchange === exId);
    let advancers = 0;
    let decliners = 0;
    let totalVolumeM = 0;

    for (const def of exStocks) {
      const st = nextStocks[def.symbol];
      if (!st) continue;
      if (st.changePct >= 0) advancers++;
      else decliners++;
      totalVolumeM += st.volumeM;
    }

    const liveEx = snapshot.exchanges[exId];
    if (liveEx) {
      nextExchanges[exId] = {
        ...prevEx,
        baseIndex: liveEx.previousClose,
        currentIndex: liveEx.price,
        changePct: liveEx.changePct,
        advancers,
        decliners,
        totalVolumeM: Number((liveEx.volumeM > 0 ? liveEx.volumeM : totalVolumeM).toFixed(1)),
        history: liveEx.history.length === HISTORY_LENGTH ? liveEx.history : resampleSeries(liveEx.history, HISTORY_LENGTH),
        accentColor: EXCHANGE_METADATA[exId].accentColor,
      };
    } else {
      nextExchanges[exId] = {
        ...prevEx,
        advancers,
        decliners,
        totalVolumeM: Number(totalVolumeM.toFixed(1)),
      };
    }
  });

  return {
    ...prev,
    tick: prev.tick + 1,
    stocks: nextStocks,
    exchanges: nextExchanges,
  };
}
