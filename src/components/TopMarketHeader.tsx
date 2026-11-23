import React from 'react';
import { ExchangeId, ExchangeSummary, ViewMode } from '../simulation/types';

interface TopMarketHeaderProps {
  viewMode: ViewMode;
  onChangeViewMode: (mode: ViewMode) => void;
  exchanges: Record<ExchangeId, ExchangeSummary>;
  selectedExchange: ExchangeId | null;
  onFocusExchange: (exchangeId: ExchangeId) => void;
  comparedCount: number;
}

const EXCHANGE_ORDER: ExchangeId[] = ['TSX', 'NASDAQ', 'NYSE'];

export const TopMarketHeader: React.FC<TopMarketHeaderProps> = ({
  viewMode,
  onChangeViewMode,
  exchanges,
  selectedExchange,
  onFocusExchange,
  comparedCount,
}) => {
  return (
    <header className="relative z-20 flex items-center justify-between gap-6 px-5 py-2.5 bg-[#0a0f18]/92 border-b border-slate-800/80">
      {/* Zone 1: Single-line Brand Wordmark */}
      <div className="flex items-center gap-4 shrink-0">
        <span className="text-base font-bold tracking-tight text-slate-50 whitespace-nowrap shrink-0">
          Meridian Markets
        </span>
      </div>

      {/* Zone 2: Primary View Mode Shift Switcher */}
      <nav
        aria-label="Simulation View Mode"
        className="flex items-center gap-1 p-1 bg-slate-900 border border-slate-800 rounded-lg shrink-0"
      >
        <button
          type="button"
          onClick={() => onChangeViewMode('overview')}
          aria-pressed={viewMode === 'overview'}
          className={`px-3.5 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-sky-400 ${
            viewMode === 'overview'
              ? 'bg-sky-500 text-slate-950'
              : 'text-slate-300 hover:text-white hover:bg-slate-800/80'
          }`}
        >
          Exchange Overview
        </button>
        <button
          type="button"
          onClick={() => onChangeViewMode('compare')}
          aria-pressed={viewMode === 'compare'}
          className={`px-3.5 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-sky-400 ${
            viewMode === 'compare'
              ? 'bg-sky-500 text-slate-950'
              : 'text-slate-300 hover:text-white hover:bg-slate-800/80'
          }`}
        >
          Compare Stocks ({comparedCount})
        </button>
      </nav>

      {/* Zone 3: Clickable Exchange Index Summary */}
      <div className="hidden lg:flex items-center gap-2 shrink-0">
        {EXCHANGE_ORDER.map((exId) => {
          const ex = exchanges[exId];
          const isUp = ex.changePct >= 0;
          const isActive = viewMode === 'overview' && selectedExchange === exId;

          return (
            <button
              key={exId}
              type="button"
              onClick={() => onFocusExchange(exId)}
              aria-label={`Focus ${ex.name} (${ex.currentIndex.toLocaleString()}, ${isUp ? '+' : ''}${ex.changePct.toFixed(2)}%)`}
              className={`flex items-center gap-2.5 px-3 py-1.5 rounded-md border text-xs transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-sky-400 ${
                isActive
                  ? 'bg-slate-800 border-slate-500 text-white'
                  : 'bg-slate-900/90 border-slate-800 text-slate-200 hover:border-slate-600'
              }`}
            >
              <span
                className="w-1.5 h-3.5 rounded-xs shrink-0"
                style={{ backgroundColor: ex.accentColor }}
                aria-hidden="true"
              />
              <span className="font-semibold tracking-tight">{ex.id}</span>
              <span className="font-mono-tabular text-slate-300">
                {ex.currentIndex.toLocaleString('en-US', {
                  minimumFractionDigits: 0,
                  maximumFractionDigits: 0,
                })}
              </span>
              <span
                className={`font-mono-tabular font-medium ${
                  isUp ? 'text-emerald-400' : 'text-rose-400'
                }`}
              >
                {isUp ? '+' : ''}
                {ex.changePct.toFixed(2)}%
              </span>
            </button>
          );
        })}
      </div>
    </header>
  );
};
