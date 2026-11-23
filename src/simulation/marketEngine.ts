import {
  EXCHANGE_METADATA,
  HISTORY_LENGTH,
  MARKET_REGIMES,
  STOCK_CATALOG,
} from './marketData';
import {
  ComparisonMetricMode,
  ComparisonSeries,
  ExchangeId,
  ExchangeSummary,
  MarketRegimeId,
  MarketSimulationState,
  StockDefinition,
  StockRuntimeState,
} from './types';

// Deterministic Mulberry32 PRNG for reproducible tests and initial histories
export function createSeededRng(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

// Box-Muller normal variate from uniform RNG
export function sampleNormal(rng: () => number): number {
  const u1 = Math.max(1e-7, rng());
  const u2 = rng();
  return Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
}

const STOCK_BY_SYMBOL: Record<string, StockDefinition> = Object.fromEntries(
  STOCK_CATALOG.map((s) => [s.symbol, s]),
);

export function getStockDefinition(symbol: string): StockDefinition | undefined {
  return STOCK_BY_SYMBOL[symbol];
}

export function computeExchangeIndex(
  exchangeId: ExchangeId,
  stocks: Record<string, StockRuntimeState>,
): { indexValue: number; changePct: number; advancers: number; decliners: number; totalVolumeM: number } {
  const meta = EXCHANGE_METADATA[exchangeId];
  const exchangeStocks = STOCK_CATALOG.filter((s) => s.exchange === exchangeId);

  let weightedReturnSum = 0;
  let totalCap = 0;
  let advancers = 0;
  let decliners = 0;
  let totalVolumeM = 0;

  for (const def of exchangeStocks) {
    const rt = stocks[def.symbol];
    if (!rt) continue;
    const ret = (rt.price - rt.openPrice) / rt.openPrice;
    weightedReturnSum += ret * def.marketCapB;
    totalCap += def.marketCapB;
    if (ret >= 0) advancers++;
    else decliners++;
    totalVolumeM += rt.volumeM;
  }

  const avgRet = totalCap > 0 ? weightedReturnSum / totalCap : 0;
  const indexValue = Number((meta.baseIndex * (1 + avgRet)).toFixed(2));
  const changePct = Number((avgRet * 100).toFixed(2));

  return {
    indexValue,
    changePct,
    advancers,
    decliners,
    totalVolumeM: Number(totalVolumeM.toFixed(1)),
  };
}

export function createInitialMarketState(
  seed = 20261123,
  regime: MarketRegimeId = 'normal',
): MarketSimulationState {
  const stocks: Record<string, StockRuntimeState> = {};

  for (const def of STOCK_CATALOG) {
    stocks[def.symbol] = {
      symbol: def.symbol,
      price: def.basePrice,
      openPrice: def.basePrice,
      highPrice: def.basePrice,
      lowPrice: def.basePrice,
      changePct: 0,
      volumeM: Number((def.marketCapB * 0.035 + 1.4).toFixed(2)),
      volatility: Number((14 * def.beta).toFixed(1)),
      history: [def.basePrice],
    };
  }

  const exchanges = {} as Record<ExchangeId, ExchangeSummary>;
  (['TSX', 'NASDAQ', 'NYSE'] as ExchangeId[]).forEach((exId) => {
    const meta = EXCHANGE_METADATA[exId];
    exchanges[exId] = {
      id: exId,
      name: meta.name,
      city: meta.city,
      currency: meta.currency,
      baseIndex: meta.baseIndex,
      currentIndex: meta.baseIndex,
      changePct: 0,
      advancers: STOCK_CATALOG.filter((s) => s.exchange === exId).length,
      decliners: 0,
      totalVolumeM: 0,
      history: [meta.baseIndex],
      accentColor: meta.accentColor,
    };
  });

  let state: MarketSimulationState = {
    tick: 0,
    regime,
    seed,
    stocks,
    exchanges,
  };

  // Warm up deterministic initial history so charts and 3D ribbons start rich
  for (let i = 0; i < HISTORY_LENGTH - 1; i++) {
    state = stepMarketState(state);
  }

  return state;
}

export function stepMarketState(
  prev: MarketSimulationState,
  overrideRegime?: MarketRegimeId,
): MarketSimulationState {
  const regimeId = overrideRegime ?? prev.regime;
  const regime = MARKET_REGIMES[regimeId];
  const nextTick = prev.tick + 1;
  const rng = createSeededRng((prev.seed + nextTick * 7919) >>> 0);

  // Common market factor + per-exchange factors + per-sector factors
  const globalShock = sampleNormal(rng);
  const exchangeShocks: Record<ExchangeId, number> = {
    TSX: sampleNormal(rng),
    NASDAQ: sampleNormal(rng),
    NYSE: sampleNormal(rng),
  };

  const nextStocks: Record<string, StockRuntimeState> = {};

  for (const def of STOCK_CATALOG) {
    const prevStock = prev.stocks[def.symbol];
    const idioShock = sampleNormal(rng);

    const exFactor = exchangeShocks[def.exchange];
    const corr = regime.correlationFactor;
    const compositeShock =
      corr * (0.6 * globalShock + 0.4 * exFactor) +
      Math.sqrt(Math.max(0.05, 1 - corr * corr)) * idioShock;

    const drift =
      regime.driftByExchange[def.exchange] +
      regime.driftBySector[def.sector] -
      // Gentle mean reversion anchor if price strays very far (>22%)
      ((prevStock.price - prevStock.openPrice) / prevStock.openPrice) * 0.012;

    const stepVol = 0.0028 * def.beta * regime.volatilityMultiplier;
    const pctMove = drift + stepVol * compositeShock;
    const clampedMove = Math.max(-0.045, Math.min(0.045, pctMove));

    const nextPrice = Number(
      Math.max(def.basePrice * 0.45, prevStock.price * (1 + clampedMove)).toFixed(2),
    );
    const nextHistory = [...prevStock.history, nextPrice].slice(-HISTORY_LENGTH);

    // Estimate rolling volatility from recent returns
    let sqSum = 0;
    let count = 0;
    for (let i = 1; i < nextHistory.length; i++) {
      const r = (nextHistory[i] - nextHistory[i - 1]) / nextHistory[i - 1];
      sqSum += r * r;
      count++;
    }
    const rmsVol = count > 0 ? Math.sqrt(sqSum / count) * Math.sqrt(252) * 100 : 15;

    const volSurge = 1 + Math.abs(clampedMove) * 45;
    const nextVolumeM = Number(
      (prevStock.volumeM + (0.12 + rng() * 0.25) * volSurge * (def.marketCapB / 400 + 0.3)).toFixed(2),
    );

    nextStocks[def.symbol] = {
      symbol: def.symbol,
      price: nextPrice,
      openPrice: prevStock.openPrice,
      highPrice: Math.max(prevStock.highPrice, nextPrice),
      lowPrice: Math.min(prevStock.lowPrice, nextPrice),
      changePct: Number((((nextPrice - prevStock.openPrice) / prevStock.openPrice) * 100).toFixed(2)),
      volumeM: nextVolumeM,
      volatility: Number(rmsVol.toFixed(1)),
      history: nextHistory,
    };
  }

  const nextExchanges = {} as Record<ExchangeId, ExchangeSummary>;
  (['TSX', 'NASDAQ', 'NYSE'] as ExchangeId[]).forEach((exId) => {
    const prevEx = prev.exchanges[exId];
    const stats = computeExchangeIndex(exId, nextStocks);
    nextExchanges[exId] = {
      ...prevEx,
      currentIndex: stats.indexValue,
      changePct: stats.changePct,
      advancers: stats.advancers,
      decliners: stats.decliners,
      totalVolumeM: stats.totalVolumeM,
      history: [...prevEx.history, stats.indexValue].slice(-HISTORY_LENGTH),
    };
  });

  return {
    tick: nextTick,
    regime: regimeId,
    seed: prev.seed,
    stocks: nextStocks,
    exchanges: nextExchanges,
  };
}

export function computeComparisonSeries(
  state: MarketSimulationState,
  symbols: string[],
  metricMode: ComparisonMetricMode,
): ComparisonSeries[] {
  const result: ComparisonSeries[] = [];

  for (const sym of symbols) {
    const def = STOCK_BY_SYMBOL[sym];
    const rt = state.stocks[sym];
    if (!def || !rt || rt.history.length === 0) continue;

    const anchor = rt.history[0];
    let series: number[];

    if (metricMode === 'pct_change') {
      series = rt.history.map((p) => Number((((p - anchor) / anchor) * 100).toFixed(2)));
    } else if (metricMode === 'indexed_100') {
      series = rt.history.map((p) => Number(((p / anchor) * 100).toFixed(2)));
    } else {
      // Rolling deviation from window average (spread intensity)
      const mean = rt.history.reduce((acc, v) => acc + v, 0) / rt.history.length;
      series = rt.history.map((p) => Number((((p - mean) / mean) * 100).toFixed(2)));
    }

    const lastIdxVal = Number(((rt.price / anchor) * 100).toFixed(2));
    const windowPct = Number((((rt.price - anchor) / anchor) * 100).toFixed(2));

    result.push({
      symbol: def.symbol,
      name: def.name,
      exchange: def.exchange,
      sector: def.sector,
      color: def.color,
      currentPrice: rt.price,
      currency: def.currency,
      changePct: windowPct,
      indexedValue: lastIdxVal,
      volatility: rt.volatility,
      marketCapB: def.marketCapB,
      peRatio: def.peRatio,
      beta: def.beta,
      series,
    });
  }

  return result;
}
