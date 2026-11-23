import React, { useEffect, useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  buildSimulated30dSeries,
  DailyPricePoint,
  summarize30dPoints,
} from '../simulation/stockHistory30d';
import { StockDefinition, StockRuntimeState } from '../simulation/types';

export type ChartDataSourceMode = 'live' | 'simulated';

interface StockMiniChart30dProps {
  stockDef: StockDefinition;
  stockRuntime: StockRuntimeState | undefined;
  dataSource: ChartDataSourceMode;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{ payload: DailyPricePoint }>;
  currency: 'CAD' | 'USD';
}

const clientHistoryCache = new Map<string, DailyPricePoint[]>();

const MiniChartTooltip: React.FC<CustomTooltipProps> = ({ active, payload, currency }) => {
  if (!active || !payload || payload.length === 0) return null;
  const pt = payload[0].payload;
  const isUp = pt.changeFromStartPct >= 0;

  return (
    <div className="bg-[#0a0f18] border border-slate-700 rounded-md px-2.5 py-1.5 shadow-xl text-[11px]">
      <div className="text-slate-400 font-medium">{pt.isoDate}</div>
      <div className="flex items-center gap-2 mt-0.5 font-mono-tabular">
        <span className="text-slate-100 font-semibold">
          {currency} {pt.close.toFixed(2)}
        </span>
        <span className={isUp ? 'text-emerald-400' : 'text-rose-400'}>
          ({isUp ? '+' : ''}
          {pt.changeFromStartPct.toFixed(2)}%)
        </span>
      </div>
    </div>
  );
};

export const StockMiniChart30d: React.FC<StockMiniChart30dProps> = ({
  stockDef,
  stockRuntime,
  dataSource,
}) => {
  const [livePoints, setLivePoints] = useState<DailyPricePoint[] | null>(() =>
    clientHistoryCache.get(stockDef.symbol) ?? null,
  );
  const [feedTag, setFeedTag] = useState<'loading' | 'yahoo' | 'simulated'>(
    dataSource === 'live'
      ? clientHistoryCache.has(stockDef.symbol)
        ? 'yahoo'
        : 'loading'
      : 'simulated',
  );

  useEffect(() => {
    if (dataSource !== 'live') {
      setFeedTag('simulated');
      return;
    }

    const cached = clientHistoryCache.get(stockDef.symbol);
    if (cached) {
      setLivePoints(cached);
      setFeedTag('yahoo');
      return;
    }

    const controller = new AbortController();
    setLivePoints(null);
    setFeedTag('loading');

    fetch(`/api/market/history?symbol=${encodeURIComponent(stockDef.symbol)}`, {
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as { points?: DailyPricePoint[] };
        if (!Array.isArray(json.points) || json.points.length === 0) {
          throw new Error('Empty points');
        }
        clientHistoryCache.set(stockDef.symbol, json.points);
        setLivePoints(json.points);
        setFeedTag('yahoo');
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setFeedTag('simulated');
      });

    return () => controller.abort();
  }, [stockDef.symbol, dataSource]);

  const points = useMemo(() => {
    if (dataSource === 'live' && livePoints && livePoints.length > 0) {
      return livePoints;
    }
    return buildSimulated30dSeries(stockDef, stockRuntime);
  }, [dataSource, livePoints, stockDef, stockRuntime]);

  const summary = useMemo(() => summarize30dPoints(points), [points]);
  const strokeHex = summary.isPositive ? '#10b981' : '#f43f5e';
  const gradientId = `mini-30d-${stockDef.symbol.replace(/[^a-zA-Z0-9]/g, '_')}`;

  return (
    <section
      aria-label={`Last 30 days price performance for ${stockDef.symbol}`}
      data-testid="inspector-30d-chart"
      data-chart-symbol={stockDef.symbol}
      data-chart-source={feedTag}
      className="bg-slate-900/80 border border-slate-800 rounded-lg px-3 py-2"
    >
      <div className="flex items-center justify-between gap-2 mb-1">
        <div className="flex items-center gap-2 text-[11px]">
          <span className="font-semibold text-slate-200">30D Performance</span>
          <span
            className={`font-mono-tabular font-semibold ${
              summary.isPositive ? 'text-emerald-400' : 'text-rose-400'
            }`}
          >
            {summary.isPositive ? '+' : ''}
            {summary.periodChangePct.toFixed(2)}%
          </span>
          <span className="text-[10px] text-slate-500">
            {feedTag === 'loading'
              ? 'Syncing 30D...'
              : feedTag === 'yahoo'
                ? 'Yahoo Daily'
                : 'Simulated 30D'}
          </span>
        </div>

        <div className="text-[10px] font-mono-tabular text-slate-400 whitespace-nowrap">
          L {summary.minPrice.toFixed(2)} · H {summary.maxPrice.toFixed(2)}
        </div>
      </div>

      <div className="w-full h-[94px] min-w-[240px]">
        <ResponsiveContainer width="100%" height={94}>
          <AreaChart data={points} margin={{ top: 4, right: 6, left: -12, bottom: 0 }}>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={strokeHex} stopOpacity={0.34} />
                <stop offset="95%" stopColor={strokeHex} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="label"
              minTickGap={26}
              tick={{ fontSize: 10, fill: '#64748b' }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              domain={['auto', 'auto']}
              width={52}
              tick={{ fontSize: 10, fill: '#64748b' }}
              tickFormatter={(val: number) => val.toFixed(val >= 100 ? 0 : 1)}
              axisLine={false}
              tickLine={false}
            />
            <ReferenceLine
              y={summary.startPrice}
              stroke="#475569"
              strokeDasharray="3 3"
              strokeWidth={1}
            />
            <Tooltip
              content={<MiniChartTooltip currency={stockDef.currency} />}
              cursor={{ stroke: '#475569', strokeWidth: 1 }}
            />
            <Area
              type="monotone"
              dataKey="close"
              stroke={strokeHex}
              strokeWidth={1.75}
              fill={`url(#${gradientId})`}
              isAnimationActive={false}
              activeDot={{ r: 3.5, fill: strokeHex, stroke: '#0f172a', strokeWidth: 1.5 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
};
