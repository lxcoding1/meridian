import { useCallback, useEffect, useRef, useState } from 'react';
import { ControlDock, DataSourceMode, DockTabId, FeedStatus } from './components/ControlDock';
import { HeatmapOverlay2D } from './components/HeatmapOverlay2D';
import { NewsMarquee } from './components/NewsMarquee';
import { TopMarketHeader } from './components/TopMarketHeader';
import { WorldLabelsOverlay } from './components/WorldLabelsOverlay';
import { MarketSceneController, ProjectedLabel } from './scene/MarketSceneController';
import { HeatmapMode } from './simulation/heatmap';
import {
  applyLiveMarketSnapshot,
  LiveMarketSnapshot,
  MarketRangeId,
} from './simulation/liveMarketAdapter';
import { DEFAULT_COMPARE_SYMBOLS } from './simulation/marketData';
import { createInitialMarketState, stepMarketState } from './simulation/marketEngine';
import {
  CameraPreset,
  ComparisonMetricMode,
  ExchangeId,
  MarketRegimeId,
  MarketSimulationState,
  ViewMode,
} from './simulation/types';

export default function App() {
  const [marketState, setMarketState] = useState<MarketSimulationState>(() =>
    createInitialMarketState(20261123, 'normal'),
  );
  const [dataSource, setDataSource] = useState<DataSourceMode>('live');
  const [liveRange, setLiveRange] = useState<MarketRangeId>('1d');
  const [feedStatus, setFeedStatus] = useState<FeedStatus>('loading');
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
  const [feedError, setFeedError] = useState<string | null>(null);

  const [viewMode, setViewMode] = useState<ViewMode>('overview');
  const [compareSymbols, setCompareSymbols] = useState<string[]>(DEFAULT_COMPARE_SYMBOLS);
  const [metricMode, setMetricMode] = useState<ComparisonMetricMode>('pct_change');
  const [cameraPreset, setCameraPreset] = useState<CameraPreset>('panoramic');
  const [selectedExchange, setSelectedExchange] = useState<ExchangeId | null>(null);
  const [selectedStock, setSelectedStock] = useState<string | null>(null);
  const [hoveredItem, setHoveredItem] = useState<{
    kind: 'exchange' | 'stock';
    id: string;
  } | null>(null);

  const [isPlaying, setIsPlaying] = useState<boolean>(true);
  const [speedMultiplier, setSpeedMultiplier] = useState<1 | 2 | 5>(1);
  const [dockCollapsed, setDockCollapsed] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<DockTabId>('markets');
  const [heatmapMode, setHeatmapMode] = useState<HeatmapMode>('3d');
  const [momentumEmitters, setMomentumEmitters] = useState<string[]>([]);

  const mountRef = useRef<HTMLDivElement | null>(null);
  const controllerRef = useRef<MarketSceneController | null>(null);
  const labelRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // Keep latest callbacks in refs so Three.js scene mounts once and never tears down
  const callbacksRef = useRef({
    onSelectExchange: (exchangeId: ExchangeId) => {
      setSelectedExchange(exchangeId);
      setSelectedStock(null);
      setCameraPreset(exchangeId);
      controllerRef.current?.setCameraPreset(exchangeId);
      controllerRef.current?.setSelection(exchangeId, null);
    },
    onSelectStock: (symbol: string) => {
      setSelectedStock(symbol);
      setActiveTab('inspector');
      controllerRef.current?.setSelection(null, symbol);
    },
    onHoverItem: (item: { kind: 'exchange' | 'stock'; id: string } | null) => {
      setHoveredItem(item);
    },
    onLabelsFrame: (labels: Record<string, ProjectedLabel>) => {
      for (const key of Object.keys(labels)) {
        const el = labelRefs.current[key];
        if (!el) continue;
        const info = labels[key];
        if (!info.visible) {
          el.style.opacity = '0';
        } else {
          el.style.opacity = '1';
          el.style.transform = `translate3d(${info.x.toFixed(1)}px, ${info.y.toFixed(1)}px, 0) translate(-50%, -100%)`;
        }
      }
    },
    onMomentumChange: (symbols: string[]) => {
      setMomentumEmitters(symbols);
    },
  });

  const registerLabelRef = useCallback((key: string, el: HTMLDivElement | null) => {
    labelRefs.current[key] = el;
  }, []);

  const fetchLiveMarketSnapshot = useCallback(
    async (range: MarketRangeId, forceRefresh = false) => {
      setFeedStatus('loading');
      setFeedError(null);
      try {
        const res = await fetch(
          `/api/market/snapshot?range=${encodeURIComponent(range)}${
            forceRefresh ? '&refresh=1' : ''
          }`,
        );
        if (!res.ok) {
          throw new Error(`Market feed HTTP ${res.status}`);
        }
        const snapshot = (await res.json()) as LiveMarketSnapshot;
        setMarketState((prev) => applyLiveMarketSnapshot(prev, snapshot));
        setLastUpdatedAt(snapshot.fetchedAt);
        setFeedStatus('live');
      } catch {
        setFeedStatus('error');
        setFeedError('Yahoo Finance feed temporarily unavailable — click Refresh to retry.');
      }
    },
    [],
  );

  // Initialize Three.js WebGL scene once
  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const controller = new MarketSceneController(
      container,
      {
        onSelectExchange: (id) => callbacksRef.current.onSelectExchange(id),
        onSelectStock: (sym) => callbacksRef.current.onSelectStock(sym),
        onHoverItem: (item) => callbacksRef.current.onHoverItem(item),
        onLabelsFrame: (labels) => callbacksRef.current.onLabelsFrame(labels),
        onMomentumChange: (symbols) => callbacksRef.current.onMomentumChange(symbols),
      },
      marketState,
      compareSymbols,
    );

    controllerRef.current = controller;

    return () => {
      controller.dispose();
      controllerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync market state updates into 3D scene
  useEffect(() => {
    controllerRef.current?.syncMarketState(marketState);
  }, [marketState]);

  // Sync view mode / comparison selections into 3D scene
  useEffect(() => {
    controllerRef.current?.setViewMode(viewMode, compareSymbols, metricMode);
  }, [viewMode, compareSymbols, metricMode]);

  // Sync 2D-to-3D heatmap overlay mode into 3D scene
  useEffect(() => {
    controllerRef.current?.setHeatmapMode(heatmapMode);
  }, [heatmapMode]);

  // Live Yahoo Finance polling OR Simulated Scenario loop
  useEffect(() => {
    if (dataSource === 'live') {
      void fetchLiveMarketSnapshot(liveRange, false);
      if (!isPlaying) return;
      const pollId = window.setInterval(() => {
        void fetchLiveMarketSnapshot(liveRange, true);
      }, 15_000);
      return () => window.clearInterval(pollId);
    }

    if (!isPlaying) return;
    const intervalMs = speedMultiplier === 5 ? 350 : speedMultiplier === 2 ? 700 : 1200;
    const simId = window.setInterval(() => {
      setMarketState((prev) => stepMarketState(prev));
    }, intervalMs);
    return () => window.clearInterval(simId);
  }, [dataSource, liveRange, isPlaying, speedMultiplier, fetchLiveMarketSnapshot]);

  // Keyboard shortcut 'H' to toggle HUD dock
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }
      if (e.key === 'h' || e.key === 'H') {
        setDockCollapsed((prev) => !prev);
      } else if (e.key === ' ') {
        e.preventDefault();
        setIsPlaying((prev) => !prev);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const handleChangeViewMode = useCallback((mode: ViewMode) => {
    setViewMode(mode);
    setCameraPreset(mode === 'compare' ? 'compare_front' : 'panoramic');
    if (mode === 'compare') {
      setActiveTab('compare');
    } else {
      setSelectedExchange(null);
    }
  }, []);

  const handleFocusExchange = useCallback((exchangeId: ExchangeId) => {
    setViewMode('overview');
    setSelectedExchange(exchangeId);
    setSelectedStock(null);
    setCameraPreset(exchangeId);
    controllerRef.current?.setCameraPreset(exchangeId);
    controllerRef.current?.setSelection(exchangeId, null);
  }, []);

  const handleChangeRegime = useCallback((regime: MarketRegimeId) => {
    setDataSource('simulated');
    setMarketState((prev) => stepMarketState({ ...prev, regime }, regime));
  }, []);

  const handleStep = useCallback(() => {
    setMarketState((prev) => stepMarketState(prev));
  }, []);

  const handleReset = useCallback(() => {
    setMarketState((prev) => createInitialMarketState(prev.seed, prev.regime));
  }, []);

  const handleToggleCompareSymbol = useCallback((symbol: string) => {
    setCompareSymbols((prev) => {
      if (prev.includes(symbol)) {
        if (prev.length <= 1) return prev;
        return prev.filter((s) => s !== symbol);
      }
      if (prev.length >= 4) return prev;
      return [...prev, symbol];
    });
  }, []);

  const handleSelectCameraPreset = useCallback((preset: CameraPreset) => {
    setCameraPreset(preset);
    if (preset === 'compare_front' || preset === 'compare_iso') {
      setViewMode('compare');
    } else if (preset === 'panoramic' || preset === 'TSX' || preset === 'NASDAQ' || preset === 'NYSE') {
      setViewMode('overview');
    }
    controllerRef.current?.setCameraPreset(preset);
  }, []);

  const handleSelectStock = useCallback((symbol: string) => {
    setSelectedStock(symbol);
    setActiveTab('inspector');
    controllerRef.current?.setSelection(null, symbol);
  }, []);

  const handleHoverHeatmapStock = useCallback((symbol: string | null) => {
    controllerRef.current?.setHoveredStock(symbol);
    setHoveredItem(symbol ? { kind: 'stock', id: symbol } : null);
  }, []);

  const handleClearStock = useCallback(() => {
    setSelectedStock(null);
    controllerRef.current?.setSelection(selectedExchange, null);
  }, [selectedExchange]);

  return (
    <main
      className="relative w-screen h-screen overflow-hidden bg-[#0a0f18]"
      data-source={dataSource}
      data-feed-status={feedStatus}
      data-view-mode={viewMode}
      data-heatmap-mode={heatmapMode}
      data-regime={marketState.regime}
      data-tick={marketState.tick}
      data-playing={String(isPlaying)}
      data-compared-count={compareSymbols.length}
      data-momentum-count={momentumEmitters.length}
      data-momentum-emitters={momentumEmitters.join(',')}
    >
      {/* Isolated WebGL Canvas Container */}
      <div
        ref={mountRef}
        data-testid="market-canvas-mount"
        className="absolute inset-0 cursor-grab active:cursor-grabbing"
      />

      {/* World-Projected 3D Ticker & Exchange Labels */}
      <WorldLabelsOverlay
        state={marketState}
        viewMode={viewMode}
        compareSymbols={compareSymbols}
        hoveredItem={hoveredItem}
        selectedStock={selectedStock}
        registerLabelRef={registerLabelRef}
      />

      {/* Single-Row Top Header */}
      <TopMarketHeader
        viewMode={viewMode}
        onChangeViewMode={handleChangeViewMode}
        exchanges={marketState.exchanges}
        selectedExchange={selectedExchange}
        onFocusExchange={handleFocusExchange}
        comparedCount={compareSymbols.length}
      />

      {/* 2D-to-3D Activity Heatmap Strip */}
      <HeatmapOverlay2D
        state={marketState}
        heatmapMode={heatmapMode}
        onChangeHeatmapMode={setHeatmapMode}
        viewMode={viewMode}
        compareSymbols={compareSymbols}
        selectedStock={selectedStock}
        onSelectStock={handleSelectStock}
        onHoverStock={handleHoverHeatmapStock}
      />

      {/* Collapsible Unified Bottom Control Dock */}
      <ControlDock
        collapsed={dockCollapsed}
        onToggleCollapse={() => setDockCollapsed((p) => !p)}
        activeTab={activeTab}
        onChangeTab={setActiveTab}
        dataSource={dataSource}
        onChangeDataSource={setDataSource}
        liveRange={liveRange}
        onChangeLiveRange={setLiveRange}
        feedStatus={feedStatus}
        lastUpdatedAt={lastUpdatedAt}
        feedError={feedError}
        onRefreshLive={() => void fetchLiveMarketSnapshot(liveRange, true)}
        isPlaying={isPlaying}
        onTogglePlay={() => setIsPlaying((p) => !p)}
        onStep={handleStep}
        onReset={handleReset}
        speedMultiplier={speedMultiplier}
        onChangeSpeed={setSpeedMultiplier}
        state={marketState}
        onChangeRegime={handleChangeRegime}
        viewMode={viewMode}
        onChangeViewMode={handleChangeViewMode}
        compareSymbols={compareSymbols}
        onToggleCompareSymbol={handleToggleCompareSymbol}
        metricMode={metricMode}
        onChangeMetricMode={setMetricMode}
        cameraPreset={cameraPreset}
        onSelectCameraPreset={handleSelectCameraPreset}
        selectedExchange={selectedExchange}
        selectedStock={selectedStock}
        onSelectStock={handleSelectStock}
        heatmapMode={heatmapMode}
        onChangeHeatmapMode={setHeatmapMode}
      />

      {/* Bottom Scrolling Financial News Marquee */}
      <NewsMarquee
        selectedStock={selectedStock}
        onClearStock={handleClearStock}
      />
    </main>
  );
}
