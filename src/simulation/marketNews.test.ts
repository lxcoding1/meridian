import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildYahooNewsSearchQuery,
  formatRelativeTime,
  parseYahooNewsResponse,
  sanitizeNewsUrl,
} from './marketNews';

test('sanitizeNewsUrl only permits http and https URLs', () => {
  assert.equal(sanitizeNewsUrl('https://finance.yahoo.com/news/test.html'), 'https://finance.yahoo.com/news/test.html');
  assert.equal(sanitizeNewsUrl('javascript:alert(1)'), '#');
  assert.equal(sanitizeNewsUrl('data:text/html,xss'), '#');
  assert.equal(sanitizeNewsUrl(null), '#');
});

test('formatRelativeTime formats seconds, minutes, hours, and days cleanly', () => {
  const now = 1_795_500_000;
  assert.equal(formatRelativeTime(now - 20, now), 'Just now');
  assert.equal(formatRelativeTime(now - 14 * 60, now), '14m ago');
  assert.equal(formatRelativeTime(now - 3 * 3600, now), '3h ago');
  assert.equal(formatRelativeTime(now - 2 * 86400, now), '2d ago');
});

test('buildYahooNewsSearchQuery formats TSX company queries and US tickers cleanly', () => {
  assert.equal(buildYahooNewsSearchQuery(null), 'stock market');
  assert.equal(buildYahooNewsSearchQuery('NVDA'), 'NVDA');
  assert.equal(buildYahooNewsSearchQuery('SHOP.TO'), 'Shopify');
  assert.equal(buildYahooNewsSearchQuery('RY.TO'), 'Royal Bank of Canada');
});

test('parseYahooNewsResponse deduplicates titles, sanitizes links, and caps count', () => {
  const now = 1_795_500_000;
  const parsed = parseYahooNewsResponse(
    {
      news: [
        {
          uuid: 'a1',
          title: 'NVDA surges on datacenter demand',
          publisher: 'Reuters',
          link: 'https://finance.yahoo.com/news/nvda-1',
          providerPublishTime: now - 600,
          relatedTickers: ['NVDA'],
        },
        {
          uuid: 'a2',
          title: 'NVDA surges on datacenter demand', // duplicate
          publisher: 'Reuters',
          link: 'https://finance.yahoo.com/news/nvda-1',
          providerPublishTime: now - 600,
        },
        {
          uuid: 'a3',
          title: 'Unsafe headline link gets neutralized',
          publisher: 'Wire',
          link: 'javascript:alert(1)',
          providerPublishTime: now - 3600,
        },
      ],
    },
    now,
    10,
  );

  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].relativeTime, '10m ago');
  assert.equal(parsed[0].link, 'https://finance.yahoo.com/news/nvda-1');
  assert.equal(parsed[1].link, '#');
  assert.equal(parsed[1].relativeTime, '1h ago');
});
