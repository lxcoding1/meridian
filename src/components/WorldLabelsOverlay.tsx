import React from 'react';
import { STOCK_CATALOG } from '../simulation/marketData';
import { ExchangeId, MarketSimulationState, ViewMode } from '../simulation/types';

interface WorldLabelsOverlayProps {
  state: MarketSimulationState;
  viewMode: ViewMode;
  compareSymbols: string[];
  hoveredItem: { kind: 'exchange' | 'stock'; id: string } | null;
  selectedStock: string | null;
  registerLabelRef: (key: string, el: HTMLDivElement | null) => void;
}

const EXCHANGE_IDS: ExchangeId[] = ['TSX', 'NASDAQ', 'NYSE'];

export const WorldLabelsOverlay: React.FC<WorldLabelsOverlayProps> = ({
  state,
  viewMode,
  compareSymbols,
  hoveredItem,
  selectedStock,
  registerLabelRef,
}) => {
  return (
    <div
      className="pointer-events-none fixed inset-0 z-10 overflow-hidden"
      aria-hidden="true"
    >
      {/* Exchange Pavilion World Labels */}
      {EXCHANGE_IDS.map((exId) => {
        const ex = state.exchanges[exId];
        const isUp = ex.changePct >= 0;
        return (
          <div
            key={`ex:${exId}`}
            ref={(el) => registerLabelRef(`ex:${exId}`, el)}
            style={{ opacity: 0, transform: 'translate3d(-9999px, -9999px, 0)' }}
            className="absolute top-0 left-0 will-change-transform"
          >
            <div className="px-2.5 py-1 rounded bg-[#0c121e]/90 border border-slate-700/80 text-center shadow-lg">
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-100 whitespace-nowrap">
                <span>{ex.id}</span>
                <span className="text-slate-500">·</span>
                <span className="font-mono-tabular text-slate-200">
                  {ex.currentIndex.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                </span>
                <span
                  className={`font-mono-tabular ${
                    isUp ? 'text-emerald-400' : 'text-rose-400'
                  }`}
                >
                  {isUp ? '+' : ''}
                  {ex.changePct.toFixed(2)}%
                </span>
              </div>
            </div>
          </div>
        );
      })}

      {/* Stock Monolith World Labels */}
      {STOCK_CATALOG.map((def) => {
        const rt = state.stocks[def.symbol];
        if (!rt) return null;
        const isUp = rt.changePct >= 0;
        const isHighlighted =
          (viewMode === 'compare' && compareSymbols.includes(def.symbol)) ||
          (hoveredItem?.kind === 'stock' && hoveredItem.id === def.symbol) ||
          selectedStock === def.symbol;

        return (
          <div
            key={`st:${def.symbol}`}
            ref={(el) => registerLabelRef(`st:${def.symbol}`, el)}
            style={{ opacity: 0, transform: 'translate3d(-9999px, -9999px, 0)' }}
            className="absolute top-0 left-0 will-change-transform"
          >
            {isHighlighted && (
              <div className="px-2.5 py-1 rounded bg-[#0c121e]/92 border border-slate-700/80 shadow-md">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold text-white whitespace-nowrap">
                  <span
                    className="w-2 h-2 rounded-xs shrink-0"
                    style={{ backgroundColor: def.color }}
                  />
                  <span>{def.symbol}</span>
                  <span className="text-slate-500">·</span>
                  <span className="font-mono-tabular text-slate-200">
                    ${rt.price.toFixed(2)}
                  </span>
                  <span
                    className={`font-mono-tabular ${
                      isUp ? 'text-emerald-400' : 'text-rose-400'
                    }`}
                  >
                    {isUp ? '+' : ''}
                    {rt.changePct.toFixed(2)}%
                  </span>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
