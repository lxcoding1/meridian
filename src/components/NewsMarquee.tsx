import React, { useEffect, useState } from 'react';
import { Newspaper } from 'lucide-react';
import { getStockDefinition } from '../simulation/marketEngine';
import { getFallbackMarketNews, MarketNewsItem } from '../simulation/marketNews';

interface NewsMarqueeProps {
  selectedStock: string | null;
  onClearStock: () => void;
}

const clientNewsCache = new Map<string, MarketNewsItem[]>();

export const NewsMarquee: React.FC<NewsMarqueeProps> = ({ selectedStock, onClearStock }) => {
  const cacheKey = selectedStock ?? '__MARKET__';
  const [items, setItems] = useState<MarketNewsItem[]>(
    () => clientNewsCache.get(cacheKey) ?? getFallbackMarketNews(selectedStock),
  );
  const [newsSource, setNewsSource] = useState<'loading' | 'yahoo' | 'fallback'>(() =>
    clientNewsCache.has(cacheKey) ? 'yahoo' : 'loading',
  );

  useEffect(() => {
    const cached = clientNewsCache.get(cacheKey);
    if (cached && cached.length > 0) {
      setItems(cached);
      setNewsSource('yahoo');
      return;
    }

    const controller = new AbortController();
    setNewsSource('loading');

    const url = selectedStock
      ? `/api/market/news?symbol=${encodeURIComponent(selectedStock)}`
      : '/api/market/news';

    fetch(url, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as { items?: MarketNewsItem[] };
        if (!Array.isArray(json.items) || json.items.length === 0) {
          throw new Error('No headlines');
        }
        clientNewsCache.set(cacheKey, json.items);
        setItems(json.items);
        setNewsSource('yahoo');
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setItems(getFallbackMarketNews(selectedStock));
        setNewsSource('fallback');
      });

    return () => controller.abort();
  }, [cacheKey, selectedStock]);

  const stockDef = selectedStock ? getStockDefinition(selectedStock) : null;

  const renderSegment = (isDuplicate: boolean) => (
    <div
      key={isDuplicate ? 'dup' : 'primary'}
      aria-hidden={isDuplicate || undefined}
      className="flex items-center shrink-0"
    >
      {items.map((item) => {
        const hasValidLink = item.link !== '#';
        return (
          <div key={`${isDuplicate ? 'd' : 'p'}-${item.id}`} className="flex items-center shrink-0">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-sky-400/90 mr-1.5">
              {item.publisher}
            </span>
            {hasValidLink ? (
              <a
                href={item.link}
                target="_blank"
                rel="noopener noreferrer"
                tabIndex={isDuplicate ? -1 : undefined}
                className="text-xs text-slate-200 hover:text-white hover:underline transition-colors whitespace-nowrap"
              >
                {item.title}
              </a>
            ) : (
              <span className="text-xs text-slate-200 whitespace-nowrap">{item.title}</span>
            )}
            <span className="text-[10px] font-mono-tabular text-slate-500 ml-1.5">
              {item.relativeTime}
            </span>
            <span className="mx-4 text-slate-700 select-none" aria-hidden="true">
              •
            </span>
          </div>
        );
      })}
    </div>
  );

  return (
    <aside
      aria-label="Live financial news marquee"
      data-testid="news-marquee"
      data-news-scope={selectedStock ?? 'market'}
      data-news-source={newsSource}
      data-news-count={items.length}
      className="fixed bottom-0 left-0 right-0 z-30 h-8 bg-[#070b13]/96 border-t border-slate-800/90 flex items-center"
    >
      {/* Left Anchor Badge */}
      <div className="shrink-0 h-full flex items-center gap-2 px-3 bg-[#0b111e] border-r border-slate-800">
        <Newspaper className="w-3.5 h-3.5 text-sky-400 shrink-0" aria-hidden="true" />
        {stockDef && (
          <span
            className="w-2 h-2 rounded-xs shrink-0"
            style={{ backgroundColor: stockDef.color }}
            aria-hidden="true"
          />
        )}
        <span className="text-[11px] font-semibold tracking-wide text-slate-100 whitespace-nowrap">
          {selectedStock ? `${selectedStock} NEWS` : 'MARKET WIRE'}
        </span>
        {selectedStock && (
          <button
            type="button"
            onClick={onClearStock}
            aria-label="Switch news marquee to general market headlines"
            className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors cursor-pointer whitespace-nowrap"
          >
            All Market
          </button>
        )}
      </div>

      {/* Continuous Horizontal Ticker Viewport */}
      <div className="flex-1 h-full overflow-hidden marquee-viewport flex items-center">
        <div className="marquee-track">
          {renderSegment(false)}
          {renderSegment(true)}
        </div>
      </div>
    </aside>
  );
};
