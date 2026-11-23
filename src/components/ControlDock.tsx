import React from 'react';
import {
  ChevronDown,
  ChevronUp,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  SkipForward,
} from 'lucide-react';
import { HeatmapMode } from '../simulation/heatmap';
import { ALLOWED_RANGES, MarketRangeId } from '../simulation/liveMarketAdapter';
import { MARKET_REGIMES, STOCK_CATALOG } from '../simulation/marketData';
import { computeComparisonSeries, getStockDefinition } from '../simulation/marketEngine';
import {
  CameraPreset,
  ComparisonMetricMode,
  ExchangeId,
  MarketRegimeId,
  MarketSimulationState,
  ViewMode,
} from '../simulation/types';
import { StockMiniChart30d } from './StockMiniChart30d';

export type DockTabId = 'markets' | 'compare' | 'inspector';
export type DataSourceMode = 'live' | 'simulated';
export type FeedStatus = 'loading' | 'live' | 'error';

interface ControlDockProps {
  collapsed: boolean;
  onToggleCollapse: () => void;
  activeTab: DockTabId;
  onChangeTab: (tab: DockTabId) => void;
  dataSource: DataSourceMode;
  onChangeDataSource: (source: DataSourceMode) => void;
  liveRange: MarketRangeId;
  onChangeLiveRange: (range: MarketRangeId) => void;
  feedStatus: FeedStatus;
  lastUpdatedAt: string | null;
  feedError: string | null;
  onRefreshLive: () => void;
  isPlaying: boolean;
  onTogglePlay: () => void;
  onStep: () => void;
  onReset: () => void;
  speedMultiplier: 1 | 2 | 5;
  onChangeSpeed: (speed: 1 | 2 | 5) => void;
  state: MarketSimulationState;
  onChangeRegime: (regime: MarketRegimeId) => void;
  viewMode: ViewMode;
  onChangeViewMode: (mode: ViewMode) => void;
  compareSymbols: string[];
  onToggleCompareSymbol: (symbol: string) => void;
  metricMode: ComparisonMetricMode;
  onChangeMetricMode: (mode: ComparisonMetricMode) => void;
  cameraPreset: CameraPreset;
  onSelectCameraPreset: (preset: CameraPreset) => void;
  selectedExchange: ExchangeId | null;
  selectedStock: string | null;
  onSelectStock: (symbol: string) => void;
  heatmapMode: HeatmapMode;
  onChangeHeatmapMode: (mode: HeatmapMode) => void;
}

const REGIME_LIST = Object.values(MARKET_REGIMES);
const EXCHANGES: ExchangeId[] = ['TSX', 'NASDAQ', 'NYSE'];
const RANGE_LIST = Object.values(ALLOWED_RANGES);

export const ControlDock: React.FC<ControlDockProps> = ({
  collapsed,
  onToggleCollapse,
  activeTab,
  onChangeTab,
  dataSource,
  onChangeDataSource,
  liveRange,
  onChangeLiveRange,
  feedStatus,
  lastUpdatedAt,
  feedError,
  onRefreshLive,
  isPlaying,
  onTogglePlay,
  onStep,
  onReset,
  speedMultiplier,
  onChangeSpeed,
  state,
  onChangeRegime,
  viewMode,
  onChangeViewMode,
  compareSymbols,
  onToggleCompareSymbol,
  metricMode,
  onChangeMetricMode,
  cameraPreset,
  onSelectCameraPreset,
  selectedExchange,
  selectedStock,
  onSelectStock,
  heatmapMode,
  onChangeHeatmapMode,
}) => {
  const [pickerExchange, setPickerExchange] = React.useState<ExchangeId>('TSX');
  const comparisonRows = computeComparisonSeries(state, compareSymbols, metricMode);
  const inspectedSymbol = selectedStock ?? compareSymbols[0] ?? 'NVDA';
  const inspectedDef = getStockDefinition(inspectedSymbol);
  const inspectedRt = state.stocks[inspectedSymbol];
  const currentRegime = MARKET_REGIMES[state.regime];
  const pickerStocks = STOCK_CATALOG.filter((s) => s.exchange === pickerExchange);

  const formattedUpdated = lastUpdatedAt
    ? new Date(lastUpdatedAt).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
    : null;

  return (
    <div
      className={`fixed bottom-10 left-1/2 -translate-x-1/2 z-20 w-[min(980px,95vw)] transition-transform duration-200 ease-out ${
        collapsed ? 'translate-y-[calc(100%+12px)]' : 'translate-y-0'
      }`}
    >
      {/* Collapse / Expand Handle */}
      <div className="flex justify-center -mb-px">
        <button
          type="button"
          onClick={onToggleCollapse}
          aria-expanded={!collapsed}
          className={`flex items-center gap-1.5 px-3.5 py-1 text-[11px] font-medium rounded-t-lg border border-b-0 border-slate-700/80 bg-[#0f172a] text-slate-300 hover:text-white cursor-pointer transition-colors whitespace-nowrap ${
            collapsed ? '-translate-y-9 shadow-lg' : ''
          }`}
        >
          {collapsed ? (
            <>
              <ChevronUp className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Show Controls (H)</span>
            </>
          ) : (
            <>
              <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Hide Controls (H)</span>
            </>
          )}
        </button>
      </div>

      {/* Main Dock Body (solid dark slate, zero backdrop-blur) */}
      <section
        aria-label="Market Simulation Controls"
        className="bg-[#0f172a]/96 border border-slate-700/80 rounded-xl shadow-2xl overflow-hidden"
      >
        {/* Row 1: Feed Source + Playback/Refresh + Dock Navigation Tabs */}
        <div className="flex flex-wrap items-center justify-between gap-2.5 px-4 py-2 border-b border-slate-800">
          <div className="flex flex-wrap items-center gap-2">
            {/* Live vs Simulated Switch */}
            <div
              role="group"
              aria-label="Market data source"
              className="flex items-center gap-0.5 p-0.5 bg-slate-900 border border-slate-800 rounded-md"
            >
              <button
                type="button"
                onClick={() => onChangeDataSource('live')}
                aria-pressed={dataSource === 'live'}
                className={`px-2.5 py-1 text-xs font-semibold rounded transition-colors cursor-pointer whitespace-nowrap ${
                  dataSource === 'live'
                    ? 'bg-emerald-500 text-slate-950'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                Yahoo Live
              </button>
              <button
                type="button"
                onClick={() => onChangeDataSource('simulated')}
                aria-pressed={dataSource === 'simulated'}
                className={`px-2.5 py-1 text-xs font-semibold rounded transition-colors cursor-pointer whitespace-nowrap ${
                  dataSource === 'simulated'
                    ? 'bg-sky-500 text-slate-950'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                Scenario Sim
              </button>
            </div>

            {dataSource === 'live' ? (
              <>
                {/* Timeframe Range Buttons */}
                <div
                  role="group"
                  aria-label="Yahoo Finance chart range"
                  className="flex items-center gap-0.5 p-0.5 bg-slate-900 border border-slate-800 rounded-md"
                >
                  {RANGE_LIST.map((r) => (
                    <button
                      key={r.range}
                      type="button"
                      onClick={() => onChangeLiveRange(r.range)}
                      aria-pressed={liveRange === r.range}
                      className={`px-2 py-1 text-[11px] font-mono-tabular font-medium rounded transition-colors cursor-pointer ${
                        liveRange === r.range
                          ? 'bg-slate-700 text-white'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={onRefreshLive}
                  disabled={feedStatus === 'loading'}
                  aria-label="Refresh Yahoo Finance quotes now"
                  className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md bg-slate-800 text-slate-200 hover:bg-slate-700 transition-colors cursor-pointer whitespace-nowrap disabled:opacity-60"
                >
                  <RefreshCw
                    className={`w-3.5 h-3.5 ${feedStatus === 'loading' ? 'animate-spin' : ''}`}
                    aria-hidden="true"
                  />
                  <span>{feedStatus === 'loading' ? 'Syncing' : 'Refresh'}</span>
                </button>

                <button
                  type="button"
                  onClick={onTogglePlay}
                  aria-pressed={isPlaying}
                  className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-md bg-slate-800 text-slate-200 hover:bg-slate-700 transition-colors cursor-pointer whitespace-nowrap"
                >
                  {isPlaying ? (
                    <>
                      <Pause className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Auto (15s)</span>
                    </>
                  ) : (
                    <>
                      <Play className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Paused</span>
                    </>
                  )}
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={onTogglePlay}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md bg-sky-500 text-slate-950 hover:bg-sky-400 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                >
                  {isPlaying ? (
                    <>
                      <Pause className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Pause</span>
                    </>
                  ) : (
                    <>
                      <Play className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Play</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={onStep}
                  aria-label="Advance one market tick"
                  className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-md bg-slate-800 text-slate-200 hover:bg-slate-700 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                >
                  <SkipForward className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Step</span>
                </button>

                <button
                  type="button"
                  onClick={onReset}
                  aria-label="Reset market session"
                  className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-md bg-slate-800 text-slate-200 hover:bg-slate-700 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                >
                  <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Reset</span>
                </button>

                <div
                  className="flex items-center gap-0.5 p-0.5 bg-slate-900 border border-slate-800 rounded-md"
                  role="group"
                  aria-label="Simulation speed"
                >
                  {([1, 2, 5] as const).map((spd) => (
                    <button
                      key={spd}
                      type="button"
                      onClick={() => onChangeSpeed(spd)}
                      aria-pressed={speedMultiplier === spd}
                      className={`px-2 py-1 text-[11px] font-mono-tabular font-medium rounded transition-colors cursor-pointer ${
                        speedMultiplier === spd
                          ? 'bg-slate-700 text-white'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {spd}x
                    </button>
                  ))}
                </div>
              </>
            )}

            {/* Heatmap 2D/3D Mode Control (always reachable even when overlay is Off) */}
            <div
              role="group"
              aria-label="Heatmap overlay mode"
              className="flex items-center gap-0.5 p-0.5 bg-slate-900 border border-slate-800 rounded-md"
            >
              <span className="px-1.5 text-[10px] font-medium text-slate-400">Heat:</span>
              {(
                [
                  { id: 'off', label: 'Off' },
                  { id: '2d', label: '2D' },
                  { id: '3d', label: '3D' },
                ] as { id: HeatmapMode; label: string }[]
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => onChangeHeatmapMode(opt.id)}
                  aria-pressed={heatmapMode === opt.id}
                  className={`px-1.5 py-1 text-[11px] font-semibold rounded transition-colors cursor-pointer whitespace-nowrap ${
                    heatmapMode === opt.id
                      ? 'bg-emerald-500/25 text-emerald-300'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Dock Tabs */}
          <div
            role="tablist"
            aria-label="Dock Sections"
            className="flex items-center gap-1 p-0.5 bg-slate-900 border border-slate-800 rounded-lg"
          >
            {(
              [
                { id: 'markets', label: 'Markets & Regimes' },
                { id: 'compare', label: 'Stock Comparator' },
                { id: 'inspector', label: 'Camera & Details' },
              ] as { id: DockTabId; label: string }[]
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={activeTab === tab.id}
                onClick={() => onChangeTab(tab.id)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                  activeTab === tab.id
                    ? 'bg-slate-800 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Row 2: Active Tab Panel */}
        <div className="px-4 py-2.5">
          {activeTab === 'markets' && (
            <div className="space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  {REGIME_LIST.map((reg) => {
                    const active = dataSource === 'simulated' && state.regime === reg.id;
                    return (
                      <button
                        key={reg.id}
                        type="button"
                        onClick={() => onChangeRegime(reg.id)}
                        aria-pressed={active}
                        className={`px-3 py-1.5 text-xs font-medium rounded-md border transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                          active
                            ? 'bg-sky-500/15 border-sky-400 text-sky-300'
                            : 'bg-slate-900 border-slate-800 text-slate-300 hover:border-slate-600'
                        }`}
                      >
                        {reg.label}
                      </button>
                    );
                  })}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    onChangeViewMode(viewMode === 'overview' ? 'compare' : 'overview');
                  }}
                  className="px-3 py-1.5 text-xs font-semibold rounded-md bg-slate-800 hover:bg-slate-700 text-sky-300 border border-slate-700 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                >
                  {viewMode === 'overview'
                    ? 'Shift to Compare Stocks'
                    : 'Return to Exchange Overview'}
                </button>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-4 pt-1.5 border-t border-slate-800/80 text-xs">
                <p className="text-slate-400">
                  {dataSource === 'live' ? (
                    feedError ? (
                      <span className="text-rose-300">
                        {feedError}
                      </span>
                    ) : (
                      <span>
                        Yahoo Finance Live ({ALLOWED_RANGES[liveRange].label})
                        {formattedUpdated ? ` · Updated ${formattedUpdated}` : ' · Syncing quotes'}
                      </span>
                    )
                  ) : (
                    <span>Scenario Simulation · {currentRegime.description}</span>
                  )}
                </p>
                <div className="flex items-center gap-4 font-mono-tabular text-slate-300 shrink-0">
                  {EXCHANGES.map((exId) => {
                    const ex = state.exchanges[exId];
                    const isUp = ex.changePct >= 0;
                    return (
                      <span key={exId} className="whitespace-nowrap">
                        <span className="text-slate-400 mr-1.5">{exId}</span>
                        <span>
                          {ex.advancers}/{ex.advancers + ex.decliners} up
                        </span>
                        <span
                          className={`ml-1.5 ${
                            isUp ? 'text-emerald-400' : 'text-rose-400'
                          }`}
                        >
                          ({isUp ? '+' : ''}
                          {ex.changePct.toFixed(2)}%)
                        </span>
                      </span>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'compare' && (
            <div className="space-y-2">
              {/* Compact Stock Picker Row + Metric Scale */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  {/* Exchange Filter Tabs */}
                  <div
                    role="group"
                    aria-label="Filter equities by exchange"
                    className="flex items-center gap-0.5 p-0.5 bg-slate-900 border border-slate-800 rounded-md mr-1"
                  >
                    {EXCHANGES.map((exId) => (
                      <button
                        key={exId}
                        type="button"
                        onClick={() => setPickerExchange(exId)}
                        aria-pressed={pickerExchange === exId}
                        className={`px-2 py-1 text-[11px] font-semibold rounded transition-colors cursor-pointer whitespace-nowrap ${
                          pickerExchange === exId
                            ? 'bg-slate-700 text-white'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        {exId}
                      </button>
                    ))}
                  </div>

                  {/* Equities for Selected Exchange */}
                  {pickerStocks.map((def) => {
                    const isSelected = compareSymbols.includes(def.symbol);
                    const disabled = !isSelected && compareSymbols.length >= 4;
                    const rt = state.stocks[def.symbol];
                    const isUp = (rt?.changePct ?? 0) >= 0;

                    return (
                      <button
                        key={def.symbol}
                        type="button"
                        disabled={disabled}
                        onClick={() => onToggleCompareSymbol(def.symbol)}
                        aria-pressed={isSelected}
                        className={`flex items-center gap-1.5 px-2 py-1 text-[11px] font-medium rounded border transition-colors whitespace-nowrap ${
                          isSelected
                            ? 'bg-sky-500/20 border-sky-400 text-white cursor-pointer'
                            : disabled
                              ? 'bg-slate-900/40 border-slate-800/50 text-slate-600 cursor-not-allowed'
                              : 'bg-slate-800/70 border-slate-700/80 text-slate-300 hover:border-slate-500 cursor-pointer'
                        }`}
                      >
                        <span
                          className="w-1.5 h-1.5 rounded-xs shrink-0"
                          style={{ backgroundColor: def.color }}
                          aria-hidden="true"
                        />
                        <span>{def.symbol}</span>
                        <span
                          className={`font-mono-tabular ${
                            isUp ? 'text-emerald-400' : 'text-rose-400'
                          }`}
                        >
                          {isUp ? '+' : ''}
                          {rt?.changePct.toFixed(1)}%
                        </span>
                      </button>
                    );
                  })}
                </div>

                {/* Metric Scale & Selected Count */}
                <div className="flex items-center gap-2 shrink-0">
                  <div className="flex items-center gap-0.5 p-0.5 bg-slate-900 border border-slate-800 rounded-md">
                    {(
                      [
                        { id: 'pct_change', label: '% Return' },
                        { id: 'indexed_100', label: 'Base 100' },
                        { id: 'volatility_spread', label: 'Spread %' },
                      ] as { id: ComparisonMetricMode; label: string }[]
                    ).map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => onChangeMetricMode(m.id)}
                        aria-pressed={metricMode === m.id}
                        className={`px-2 py-1 text-[11px] font-medium rounded transition-colors cursor-pointer whitespace-nowrap ${
                          metricMode === m.id
                            ? 'bg-slate-700 text-white'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                  <span className="text-[11px] text-slate-400 font-mono-tabular whitespace-nowrap">
                    {compareSymbols.length}/4
                  </span>
                  {viewMode !== 'compare' && (
                    <button
                      type="button"
                      onClick={() => onChangeViewMode('compare')}
                      className="px-2.5 py-1 text-[11px] font-semibold rounded-md bg-sky-500 text-slate-950 hover:bg-sky-400 transition-colors cursor-pointer whitespace-nowrap"
                    >
                      Open 3D Compare
                    </button>
                  )}
                </div>
              </div>

              {/* Side-by-Side Comparison Metrics Table */}
              {comparisonRows.length > 0 && (
                <div className="overflow-x-auto dock-scroll border-t border-slate-800 pt-1.5">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="text-slate-400 border-b border-slate-800/80">
                        <th className="py-1 pr-3 font-medium">Ticker</th>
                        <th className="py-1 px-2 font-medium">Exchange</th>
                        <th className="py-1 px-2 font-medium text-right">Price</th>
                        <th className="py-1 px-2 font-medium text-right">Window %</th>
                        <th className="py-1 px-2 font-medium text-right">Idx (100)</th>
                        <th className="py-1 px-2 font-medium text-right">Vol %</th>
                        <th className="py-1 px-2 font-medium text-right">P/E</th>
                        <th className="py-1 pl-2 font-medium text-right">Beta</th>
                        <th className="py-1 pl-2 font-medium text-right">Remove</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60">
                      {comparisonRows.map((row) => {
                        const isUp = row.changePct >= 0;
                        return (
                          <tr key={row.symbol} className="text-slate-200">
                            <td className="py-1 pr-3 font-semibold whitespace-nowrap">
                              <button
                                type="button"
                                onClick={() => onSelectStock(row.symbol)}
                                className="flex items-center gap-2 hover:text-sky-300 cursor-pointer"
                              >
                                <span
                                  className="w-2 h-2 rounded-xs shrink-0"
                                  style={{ backgroundColor: row.color }}
                                  aria-hidden="true"
                                />
                                <span>{row.symbol}</span>
                                <span className="text-slate-400 font-normal hidden sm:inline">
                                  {row.name}
                                </span>
                              </button>
                            </td>
                            <td className="py-1 px-2 text-slate-400 whitespace-nowrap">
                              {row.exchange}
                            </td>
                            <td className="py-1 px-2 text-right font-mono-tabular whitespace-nowrap">
                              {row.currency} {row.currentPrice.toFixed(2)}
                            </td>
                            <td
                              className={`py-1 px-2 text-right font-mono-tabular font-medium whitespace-nowrap ${
                                isUp ? 'text-emerald-400' : 'text-rose-400'
                              }`}
                            >
                              {isUp ? '+' : ''}
                              {row.changePct.toFixed(2)}%
                            </td>
                            <td className="py-1 px-2 text-right font-mono-tabular whitespace-nowrap">
                              {row.indexedValue.toFixed(2)}
                            </td>
                            <td className="py-1 px-2 text-right font-mono-tabular text-slate-300 whitespace-nowrap">
                              {row.volatility.toFixed(1)}%
                            </td>
                            <td className="py-1 px-2 text-right font-mono-tabular text-slate-300 whitespace-nowrap">
                              {row.peRatio.toFixed(1)}
                            </td>
                            <td className="py-1 pl-2 text-right font-mono-tabular text-slate-300 whitespace-nowrap">
                              {row.beta.toFixed(2)}
                            </td>
                            <td className="py-1 pl-2 text-right whitespace-nowrap">
                              <button
                                type="button"
                                disabled={compareSymbols.length <= 1}
                                onClick={() => onToggleCompareSymbol(row.symbol)}
                                aria-label={`Remove ${row.symbol} from comparison`}
                                className="px-1.5 py-0.5 text-[11px] rounded text-slate-400 hover:text-rose-300 hover:bg-slate-800 cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                              >
                                ×
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {activeTab === 'inspector' && (
            <div className="space-y-2.5">
              {/* Camera Angles + Inspected Stock Selector */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs font-medium text-slate-400 mr-1">Camera:</span>
                  {(
                    [
                      { id: 'panoramic', label: 'Panoramic All' },
                      { id: 'TSX', label: 'Focus TSX' },
                      { id: 'NASDAQ', label: 'Focus NASDAQ' },
                      { id: 'NYSE', label: 'Focus NYSE' },
                      { id: 'compare_front', label: 'Compare Front' },
                      { id: 'compare_iso', label: 'Compare Angle' },
                    ] as { id: CameraPreset; label: string }[]
                  ).map((cam) => (
                    <button
                      key={cam.id}
                      type="button"
                      onClick={() => onSelectCameraPreset(cam.id)}
                      aria-pressed={cameraPreset === cam.id}
                      className={`px-2.5 py-1 text-xs font-medium rounded-md border transition-colors cursor-pointer whitespace-nowrap ${
                        cameraPreset === cam.id
                          ? 'bg-sky-500/20 border-sky-400 text-sky-200'
                          : 'bg-slate-900 border-slate-800 text-slate-300 hover:border-slate-600'
                      }`}
                    >
                      {cam.label}
                    </button>
                  ))}
                </div>

                <label className="flex items-center gap-1.5 text-xs text-slate-400">
                  <span>Stock:</span>
                  <select
                    aria-label="Select stock to inspect"
                    value={inspectedSymbol}
                    onChange={(e) => onSelectStock(e.target.value)}
                    className="bg-slate-900 border border-slate-700 text-slate-100 text-xs font-medium rounded-md px-2 py-1 focus:outline-none focus:border-sky-400 cursor-pointer"
                  >
                    {STOCK_CATALOG.map((item) => (
                      <option key={item.symbol} value={item.symbol}>
                        {item.symbol} · {item.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {/* Inspected Security Readout + 30-Day Recharts Mini-Chart */}
              {inspectedDef && inspectedRt && (
                <div className="grid grid-cols-1 md:grid-cols-[1.05fr_1fr] gap-3 pt-2 border-t border-slate-800 items-center">
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-white">
                      <span>{inspectedDef.symbol}</span>
                      <span className="text-slate-500">·</span>
                      <span className="text-slate-300 font-normal">{inspectedDef.name}</span>
                      <span className="text-slate-500">·</span>
                      <span className="text-xs text-slate-400 font-normal">
                        {inspectedDef.exchange} / {inspectedDef.sector}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-mono-tabular text-slate-300">
                      <span>
                        Price: {inspectedDef.currency} {inspectedRt.price.toFixed(2)}
                      </span>
                      <span>
                        High/Low: {inspectedRt.highPrice.toFixed(2)} /{' '}
                        {inspectedRt.lowPrice.toFixed(2)}
                      </span>
                      <span>Cap: ${inspectedDef.marketCapB}B</span>
                      <span>P/E: {inspectedDef.peRatio}</span>
                      <span>Div: {inspectedDef.dividendYield}%</span>
                      <span>Beta: {inspectedDef.beta}</span>
                      <span>Vol: {inspectedRt.volumeM.toFixed(1)}M</span>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 pt-0.5">
                      <button
                        type="button"
                        onClick={() => onToggleCompareSymbol(inspectedDef.symbol)}
                        disabled={
                          !compareSymbols.includes(inspectedDef.symbol) &&
                          compareSymbols.length >= 4
                        }
                        className="px-3 py-1 text-xs font-semibold rounded-md bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700 transition-colors cursor-pointer disabled:opacity-40 whitespace-nowrap"
                      >
                        {compareSymbols.includes(inspectedDef.symbol)
                          ? 'Remove from Compare'
                          : 'Add to Compare'}
                      </button>
                      {selectedExchange && (
                        <span className="text-xs text-slate-400">
                          Active Exchange: {selectedExchange}
                        </span>
                      )}
                    </div>
                  </div>

                  <StockMiniChart30d
                    stockDef={inspectedDef}
                    stockRuntime={inspectedRt}
                    dataSource={dataSource}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  );
};
