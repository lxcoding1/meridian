import { STOCK_CATALOG } from './marketData';

export interface MarketNewsItem {
  id: string;
  title: string;
  publisher: string;
  link: string;
  publishedAt: number; // unix epoch seconds
  relativeTime: string;
  relatedTickers: string[];
}

export function sanitizeNewsUrl(raw: unknown): string {
  if (typeof raw !== 'string') return '#';
  const trimmed = raw.trim();
  if (!trimmed) return '#';
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      return parsed.toString();
    }
    return '#';
  } catch {
    return '#';
  }
}

export function formatRelativeTime(epochSeconds: number, nowSeconds = Math.floor(Date.now() / 1000)): string {
  if (!Number.isFinite(epochSeconds) || epochSeconds <= 0) return 'Live';
  const diff = Math.max(0, Math.floor(nowSeconds - epochSeconds));
  if (diff < 60) return 'Just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function buildYahooNewsSearchQuery(symbol: string | null | undefined): string {
  if (!symbol) return 'stock market';
  const def = STOCK_CATALOG.find((s) => s.symbol === symbol);
  if (!def) return symbol;
  if (symbol.endsWith('.TO')) {
    return def.name.replace(/\b(?:Inc|Corp|Res|Co)\.?(?=\s|$)/gi, '').trim();
  }
  return def.symbol;
}

export function parseYahooNewsResponse(
  rawJson: unknown,
  nowSeconds = Math.floor(Date.now() / 1000),
  limit = 10,
): MarketNewsItem[] {
  if (!rawJson || typeof rawJson !== 'object') return [];
  const rawNews = (rawJson as { news?: unknown[] }).news;
  if (!Array.isArray(rawNews)) return [];

  const seenTitles = new Set<string>();
  const items: MarketNewsItem[] = [];

  for (const entry of rawNews) {
    if (!entry || typeof entry !== 'object') continue;
    const rec = entry as Record<string, unknown>;
    const title = typeof rec.title === 'string' ? rec.title.trim() : '';
    if (!title) continue;

    const normKey = title.toLowerCase();
    if (seenTitles.has(normKey)) continue;
    seenTitles.add(normKey);

    const publisher =
      typeof rec.publisher === 'string' && rec.publisher.trim()
        ? rec.publisher.trim()
        : 'Market Wire';
    const publishedAt =
      typeof rec.providerPublishTime === 'number' && Number.isFinite(rec.providerPublishTime)
        ? rec.providerPublishTime
        : nowSeconds;
    const id =
      typeof rec.uuid === 'string' && rec.uuid.trim()
        ? rec.uuid.trim()
        : `news-${items.length}-${publishedAt}`;
    const link = sanitizeNewsUrl(rec.link);
    const relatedTickers = Array.isArray(rec.relatedTickers)
      ? rec.relatedTickers.filter((t): t is string => typeof t === 'string')
      : [];

    items.push({
      id,
      title,
      publisher,
      link,
      publishedAt,
      relativeTime: formatRelativeTime(publishedAt, nowSeconds),
      relatedTickers,
    });

    if (items.length >= limit) break;
  }

  return items;
}

export function getFallbackMarketNews(selectedSymbol: string | null): MarketNewsItem[] {
  const nowSec = Math.floor(Date.now() / 1000);
  if (selectedSymbol) {
    const def = STOCK_CATALOG.find((s) => s.symbol === selectedSymbol);
    const label = def ? `${def.symbol} (${def.name})` : selectedSymbol;
    return [
      {
        id: `fb-${selectedSymbol}-1`,
        title: `${label} trading momentum tracked across live ${def?.exchange ?? 'market'} session`,
        publisher: 'Meridian Wire',
        link: '#',
        publishedAt: nowSec - 300,
        relativeTime: '5m ago',
        relatedTickers: [selectedSymbol],
      },
      {
        id: `fb-${selectedSymbol}-2`,
        title: `${def?.sector ?? 'Equity'} sector liquidity and volatility dispersion remain in focus`,
        publisher: 'Meridian Wire',
        link: '#',
        publishedAt: nowSec - 1800,
        relativeTime: '30m ago',
        relatedTickers: [selectedSymbol],
      },
    ];
  }

  return [
    {
      id: 'fb-mkt-1',
      title: 'North American equities advance as TSX, NASDAQ, and NYSE volume accelerates',
      publisher: 'Meridian Wire',
      link: '#',
      publishedAt: nowSec - 240,
      relativeTime: '4m ago',
      relatedTickers: ['^GSPTSE', '^IXIC', '^NYA'],
    },
    {
      id: 'fb-mkt-2',
      title: 'Semiconductors, financials, and energy leaders drive cross-exchange breadth',
      publisher: 'Meridian Wire',
      link: '#',
      publishedAt: nowSec - 1500,
      relativeTime: '25m ago',
      relatedTickers: ['NVDA', 'SHOP.TO', 'JPM'],
    },
  ];
}
