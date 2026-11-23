import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  ALLOWED_RANGES,
  EXCHANGE_INDEX_SYMBOLS,
  isValidTickerSymbol,
  LiveMarketSnapshot,
  MarketRangeId,
  normalizeMarketRange,
  ParsedYahooQuote,
  parseYahooChartResult,
} from './src/simulation/liveMarketAdapter';
import { STOCK_CATALOG } from './src/simulation/marketData';
import {
  buildYahooNewsSearchQuery,
  MarketNewsItem,
  parseYahooNewsResponse,
} from './src/simulation/marketNews';
import { DailyPricePoint, parseYahooDaily30dSeries } from './src/simulation/stockHistory30d';
import type { ExchangeId } from './src/simulation/types';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = 3000;
const CACHE_TTL_MS = 15_000;

interface CacheEntry {
  expiresAt: number;
  data: LiveMarketSnapshot;
}

const snapshotCache = new Map<MarketRangeId, CacheEntry>();

const ALLOWED_STOCK_SYMBOLS = new Set(STOCK_CATALOG.map((s) => s.symbol));
const HISTORY_CACHE_TTL_MS = 5 * 60_000;
const stockHistoryCache = new Map<
  string,
  { expiresAt: number; points: DailyPricePoint[]; fetchedAt: string }
>();

async function fetchYahoo30dHistory(
  symbol: string,
): Promise<{ points: DailyPricePoint[]; fetchedAt: string } | null> {
  if (!isValidTickerSymbol(symbol) || !ALLOWED_STOCK_SYMBOLS.has(symbol)) {
    return null;
  }

  const cached = stockHistoryCache.get(symbol);
  if (cached && cached.expiresAt > Date.now()) {
    return { points: cached.points, fetchedAt: cached.fetchedAt };
  }

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    symbol,
  )}?interval=1d&range=1mo`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 7000);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; MeridianMarkets/1.0)',
        Accept: 'application/json',
      },
    });
    if (!res.ok) return null;
    const json = await res.json();
    const points = parseYahooDaily30dSeries(json);
    if (points.length === 0) return null;

    const fetchedAt = new Date().toISOString();
    stockHistoryCache.set(symbol, {
      expiresAt: Date.now() + HISTORY_CACHE_TTL_MS,
      points,
      fetchedAt,
    });
    return { points, fetchedAt };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

const NEWS_CACHE_TTL_MS = 3 * 60_000;
const marketNewsCache = new Map<
  string,
  { expiresAt: number; items: MarketNewsItem[]; fetchedAt: string }
>();

async function queryYahooNewsSearch(query: string): Promise<MarketNewsItem[]> {
  const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(
    query,
  )}&quotesCount=0&newsCount=10`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 7000);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; MeridianMarkets/1.0)',
        Accept: 'application/json',
      },
    });
    if (!res.ok) return [];
    const json = await res.json();
    return parseYahooNewsResponse(json);
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchYahooNews(
  symbol: string | null,
): Promise<{ items: MarketNewsItem[]; fetchedAt: string } | null> {
  const cacheKey = symbol ?? '__MARKET__';
  const cached = marketNewsCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return { items: cached.items, fetchedAt: cached.fetchedAt };
  }

  const primaryQuery = buildYahooNewsSearchQuery(symbol);
  let items = await queryYahooNewsSearch(primaryQuery);

  // Secondary fallback for sparse Canadian (.TO) tickers (e.g. TD.TO -> TD, then general TSX/market)
  if (items.length === 0 && symbol) {
    const stripped = symbol.replace(/\.TO$/i, '');
    if (stripped !== primaryQuery) {
      items = await queryYahooNewsSearch(stripped);
    }
    if (items.length === 0) {
      items = await queryYahooNewsSearch('stock market');
    }
  }

  if (items.length === 0) return null;

  const fetchedAt = new Date().toISOString();
  marketNewsCache.set(cacheKey, {
    expiresAt: Date.now() + NEWS_CACHE_TTL_MS,
    items,
    fetchedAt,
  });
  return { items, fetchedAt };
}

async function fetchYahooChart(symbol: string, range: MarketRangeId): Promise<ParsedYahooQuote | null> {
  if (!isValidTickerSymbol(symbol)) {
    return null;
  }
  const { interval } = ALLOWED_RANGES[range];
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    symbol,
  )}?interval=${encodeURIComponent(interval)}&range=${encodeURIComponent(range)}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 7000);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; MeridianMarkets/1.0)',
        Accept: 'application/json',
      },
    });
    if (!res.ok) return null;
    const json = await res.json();
    return parseYahooChartResult(json, symbol);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function getMarketSnapshot(range: MarketRangeId, forceRefresh = false): Promise<LiveMarketSnapshot> {
  const cached = snapshotCache.get(range);
  if (!forceRefresh && cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  const exchangeEntries = (Object.entries(EXCHANGE_INDEX_SYMBOLS) as Array<[ExchangeId, string]>).map(
    ([exId, sym]) => ({ kind: 'exchange' as const, exId, symbol: sym }),
  );
  const stockEntries = STOCK_CATALOG.map((s) => ({ kind: 'stock' as const, symbol: s.symbol }));
  const allTasks = [...exchangeEntries, ...stockEntries];

  const settled = await Promise.allSettled(
    allTasks.map((t) => fetchYahooChart(t.symbol, range)),
  );

  const exchanges: Partial<Record<ExchangeId, ParsedYahooQuote>> = {};
  const stocks: Record<string, ParsedYahooQuote> = {};
  const failedSymbols: string[] = [];

  settled.forEach((outcome, idx) => {
    const task = allTasks[idx];
    if (outcome.status === 'fulfilled' && outcome.value) {
      if (task.kind === 'exchange') {
        exchanges[task.exId] = outcome.value;
      } else {
        stocks[task.symbol] = outcome.value;
      }
    } else {
      failedSymbols.push(task.symbol);
    }
  });

  const snapshot: LiveMarketSnapshot = {
    source: 'yahoo_finance',
    fetchedAt: new Date().toISOString(),
    range,
    exchanges,
    stocks,
    failedSymbols,
  };

  if (Object.keys(stocks).length > 0 || Object.keys(exchanges).length > 0) {
    snapshotCache.set(range, {
      expiresAt: Date.now() + CACHE_TTL_MS,
      data: snapshot,
    });
  }

  return snapshot;
}

async function startServer() {
  const app = express();
  app.disable('x-powered-by');

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.get('/api/market/snapshot', async (req, res) => {
    const range = normalizeMarketRange(req.query.range);
    const forceRefresh = req.query.refresh === '1';

    try {
      const snapshot = await getMarketSnapshot(range, forceRefresh);
      const totalSuccess = Object.keys(snapshot.stocks).length + Object.keys(snapshot.exchanges).length;
      if (totalSuccess === 0) {
        res.status(502).json({ error: 'Unable to fetch market quotes from Yahoo Finance right now.' });
        return;
      }
      res.setHeader('Cache-Control', 'no-store');
      res.json(snapshot);
    } catch {
      res.status(500).json({ error: 'Market feed service error.' });
    }
  });

  app.get('/api/market/history', async (req, res) => {
    const rawSymbol = typeof req.query.symbol === 'string' ? req.query.symbol.trim() : '';
    if (!isValidTickerSymbol(rawSymbol) || !ALLOWED_STOCK_SYMBOLS.has(rawSymbol)) {
      res.status(400).json({ error: 'Unsupported or invalid ticker symbol.' });
      return;
    }

    try {
      const result = await fetchYahoo30dHistory(rawSymbol);
      if (!result) {
        res.status(502).json({ error: 'Unable to fetch 30-day chart history.' });
        return;
      }
      res.setHeader('Cache-Control', 'no-store');
      res.json({
        symbol: rawSymbol,
        source: 'yahoo_finance',
        fetchedAt: result.fetchedAt,
        points: result.points,
      });
    } catch {
      res.status(500).json({ error: 'History service error.' });
    }
  });

  app.get('/api/market/news', async (req, res) => {
    const rawSymbol = typeof req.query.symbol === 'string' ? req.query.symbol.trim() : '';
    let validatedSymbol: string | null = null;
    if (rawSymbol.length > 0) {
      if (!isValidTickerSymbol(rawSymbol) || !ALLOWED_STOCK_SYMBOLS.has(rawSymbol)) {
        res.status(400).json({ error: 'Unsupported or invalid ticker symbol.' });
        return;
      }
      validatedSymbol = rawSymbol;
    }

    try {
      const result = await fetchYahooNews(validatedSymbol);
      if (!result) {
        res.status(502).json({ error: 'Unable to fetch financial news headlines.' });
        return;
      }
      res.setHeader('Cache-Control', 'no-store');
      res.json({
        symbol: validatedSymbol,
        source: 'yahoo_finance',
        fetchedAt: result.fetchedAt,
        items: result.items,
      });
    } catch {
      res.status(500).json({ error: 'News service error.' });
    }
  });

  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      const indexPath = path.join(distDir, 'index.html');
      if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
      } else {
        res.status(404).send('Build artifacts not found.');
      }
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Meridian Markets server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
