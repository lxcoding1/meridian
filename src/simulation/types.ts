export type ExchangeId = 'TSX' | 'NASDAQ' | 'NYSE';

export type SectorId =
  | 'Technology'
  | 'Financials'
  | 'Energy'
  | 'Consumer'
  | 'Healthcare'
  | 'Industrials';

export type MarketRegimeId =
  | 'normal'
  | 'tech_rally'
  | 'rate_shock'
  | 'commodity_surge'
  | 'volatility_spike';

export type ViewMode = 'overview' | 'compare';

export type CameraPreset = 'panoramic' | 'TSX' | 'NASDAQ' | 'NYSE' | 'compare_front' | 'compare_iso';

export type ComparisonMetricMode = 'pct_change' | 'indexed_100' | 'volatility_spread';

export interface StockDefinition {
  symbol: string;
  name: string;
  exchange: ExchangeId;
  sector: SectorId;
  currency: 'CAD' | 'USD';
  basePrice: number;
  marketCapB: number; // Billions
  peRatio: number;
  dividendYield: number; // %
  beta: number;
  color: string;
}

export interface StockRuntimeState {
  symbol: string;
  price: number;
  openPrice: number;
  highPrice: number;
  lowPrice: number;
  changePct: number;
  volumeM: number; // Millions of shares
  volatility: number; // Rolling annualized % estimate
  history: number[]; // Price series (most recent last)
}

export interface ExchangeSummary {
  id: ExchangeId;
  name: string;
  city: string;
  currency: 'CAD' | 'USD';
  baseIndex: number;
  currentIndex: number;
  changePct: number;
  advancers: number;
  decliners: number;
  totalVolumeM: number;
  history: number[]; // Index series
  accentColor: string;
}

export interface MarketSimulationState {
  tick: number;
  regime: MarketRegimeId;
  seed: number;
  stocks: Record<string, StockRuntimeState>;
  exchanges: Record<ExchangeId, ExchangeSummary>;
}

export interface RegimeDefinition {
  id: MarketRegimeId;
  label: string;
  description: string;
  driftByExchange: Record<ExchangeId, number>;
  driftBySector: Record<SectorId, number>;
  volatilityMultiplier: number;
  correlationFactor: number;
}

export interface ComparisonSeries {
  symbol: string;
  name: string;
  exchange: ExchangeId;
  sector: SectorId;
  color: string;
  currentPrice: number;
  currency: 'CAD' | 'USD';
  changePct: number;
  indexedValue: number;
  volatility: number;
  marketCapB: number;
  peRatio: number;
  beta: number;
  series: number[]; // Normalized series according to metric mode
}
