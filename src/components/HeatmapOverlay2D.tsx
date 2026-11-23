import React from 'react';
import {
  buildExchangeHeatmapTiles,
  computeHeatScaleMax,
  HeatmapMode,
} from '../simulation/heatmap';
import { ExchangeId, MarketSimulationState, ViewMode } from '../simulation/types';

interface HeatmapOverlay2DProps {
  state: MarketSimulationState;
  heatmapMode: HeatmapMode;
  onChangeHeatmapMode: (mode: HeatmapMode) => void;
  viewMode: ViewMode;
  compareSymbols: string[];
  selectedStock: string | null;
  onSelectStock: (symbol: string) => void;
  onHoverStock: (symbol: string | null) => void;
}

const EXCHANGES: ExchangeId[] = ['TSX', 'NASDAQ', 'NYSE'];

function formatShortTicker(symbol: string): string {
  return symbol.endsWith('.TO') ? symbol.slice(0, -3) : symbol;
}

export const HeatmapOverlay2D: React.FC<HeatmapOverlay2DProps> = ({
  state,
  heatmapMode,
  onChangeHeatmapMode,
  viewMode,
  compareSymbols,
  selectedStock,
  onSelectStock,
  onHoverStock,
}) => {
  if (heatmapMode === 'off') return null;

  const tilesByExchange = buildExchangeHeatmapTiles(state);
  const scaleMax = computeHeatScaleMax(state);

  return (
    <section
      aria-label="2D-to-3D Market Activity Heatmap"
      className="fixed top-14 left-1/2 -translate-x-1/2 z-10 w-[min(960px,95vw)] bg-[#0c1320]/94 border border-slate-800/90 rounded-lg px-3 py-2 shadow-xl"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 mb-1.5">
        <div className="flex items-center gap-3">
          <span className="text-[11px] font-semibold tracking-tight text-slate-200">
            Activity Heatmap
          </span>
          <div className="flex items-center gap-1.5 text-[10px] font-mono-tabular text-slate-400">
            <span>-{scaleMax.toFixed(1)}%</span>
            <span
              className="w-20 h-2 rounded-xs border border-slate-700/80"
              style={{
                background: 'linear-gradient(90deg, #e42648 0%, #1e293b 50%, #10c47c 100%)',
              }}
              aria-hidden="true"
            />
            <span>+{scaleMax.toFixed(1)}%</span>
          </div>
        </div>

        <div
          role="group"
          aria-label="Heatmap overlay projection mode"
          className="flex items-center gap-0.5 p-0.5 bg-slate-900 border border-slate-800 rounded-md"
        >
          {(
            [
              { id: 'off', label: 'Hide' },
              { id: '2d', label: '2D Flat' },
              { id: '3d', label: '3D Relief' },
            ] as { id: HeatmapMode; label: string }[]
          ).map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => onChangeHeatmapMode(opt.id)}
              aria-pressed={heatmapMode === opt.id}
              className={`px-2 py-0.5 text-[10px] font-semibold rounded transition-colors cursor-pointer whitespace-nowrap ${
                heatmapMode === opt.id
                  ? 'bg-sky-500 text-slate-950'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        {EXCHANGES.map((exId) => {
          const ex = state.exchanges[exId];
          const isExUp = ex.changePct >= 0;
          const tiles = tilesByExchange[exId];

          return (
            <div
              key={exId}
              className="flex flex-col gap-1 bg-slate-950/60 border border-slate-800/80 rounded-md px-2 py-1"
            >
              <div className="flex items-center justify-between text-[10px]">
                <span className="font-semibold text-slate-300 tracking-wide">{exId}</span>
                <span
                  className={`font-mono-tabular font-semibold ${
                    isExUp ? 'text-emerald-400' : 'text-rose-400'
                  }`}
                >
                  {isExUp ? '+' : ''}
                  {ex.changePct.toFixed(2)}%
                </span>
              </div>

              <div className="grid grid-cols-5 gap-1">
                {tiles.map((tile) => {
                  const isUp = tile.changePct >= 0;
                  const isHighlighted =
                    selectedStock === tile.symbol ||
                    (viewMode === 'compare' && compareSymbols.includes(tile.symbol));

                  return (
                    <button
                      key={tile.symbol}
                      type="button"
                      onClick={() => onSelectStock(tile.symbol)}
                      onMouseEnter={() => onHoverStock(tile.symbol)}
                      onMouseLeave={() => onHoverStock(null)}
                      aria-label={`${tile.symbol} ${tile.name}: ${isUp ? '+' : ''}${tile.changePct.toFixed(2)}%`}
                      className={`relative flex flex-col items-center justify-center rounded px-1 py-1 transition-transform hover:-translate-y-px cursor-pointer overflow-hidden border ${
                        isHighlighted
                          ? 'border-sky-300 ring-1 ring-sky-400/70'
                          : 'border-slate-700/60 hover:border-slate-400'
                      }`}
                      style={{
                        backgroundColor: tile.colorHex,
                        color: tile.textColorHex,
                      }}
                    >
                      <span className="text-[10px] font-bold leading-none tracking-tight">
                        {formatShortTicker(tile.symbol)}
                      </span>
                      <span className="text-[9px] font-mono-tabular leading-tight mt-0.5 opacity-95">
                        {isUp ? '+' : ''}
                        {tile.changePct.toFixed(1)}%
                      </span>
                      <span
                        className="absolute bottom-0 left-0 h-0.5 bg-white/60"
                        style={{ width: `${Math.round(tile.activityScore * 100)}%` }}
                        aria-hidden="true"
                      />
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
};
