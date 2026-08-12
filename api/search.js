// /api/search.js — Vercel Serverless Function
// Zoekt tickers op naam via Yahoo Finance autocomplete
// Ondersteunt globale exchanges: US, EU, ASIA

const YF_BASE   = 'https://query1.finance.yahoo.com';
const YF_BASE_2 = 'https://query2.finance.yahoo.com';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; DeAnalist/1.0)',
  'Accept': 'application/json',
};

// Exchange labels voor weergave
const EXCHANGE_LABELS = {
  NMS: 'NASDAQ', NGM: 'NASDAQ', NCM: 'NASDAQ',
  NYQ: 'NYSE',   ASE: 'NYSE American',
  AMS: 'Euronext Amsterdam',  ENX: 'Euronext',
  BRU: 'Euronext Brussel',    EPA: 'Euronext Parijs',
  GER: 'XETRA',  FRA: 'Frankfurt',
  LSE: 'London',
  TOR: 'Toronto', VAN: 'TSX Venture',
  TYO: 'Tokyo',  HKG: 'Hong Kong',
  SHH: 'Shanghai', SHZ: 'Shenzhen',
  SWX: 'Swiss Exchange',
  MCE: 'Madrid',  MIL: 'Milan',
};

async function searchYahoo(q) {
  const qs = new URLSearchParams({
    q,
    quotesCount: 8,
    newsCount: 0,
    listsCount: 0,
    enableFuzzyQuery: false,
    region: 'US',
    lang: 'en-US',
  }).toString();

  for (const base of [YF_BASE, YF_BASE_2]) {
    try {
      const res = await fetch(`${base}/v1/finance/search?${qs}`, { headers: HEADERS });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      return data?.quotes || [];
    } catch {
      if (base === YF_BASE_2) return [];
    }
  }
  return [];
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { q } = req.query;
  if (!q || q.trim().length < 1) {
    return res.status(400).json({ error: 'Query verplicht' });
  }

  try {
    const raw = await searchYahoo(q.trim());

    // Filter: enkel EQUITY, geen crypto/ETF/index (tenzij expliciet)
    const results = raw
      .filter(r => r.quoteType === 'EQUITY' || r.quoteType === 'ETF')
      .slice(0, 7)
      .map(r => ({
        symbol:       r.symbol,
        shortName:    r.shortname || r.longname || r.symbol,
        longName:     r.longname  || r.shortname || r.symbol,
        exchange:     EXCHANGE_LABELS[r.exchange] || r.exchange || '',
        exchangeCode: r.exchange || '',
        type:         r.quoteType,
        sector:       r.sector || '',
        industry:     r.industry || '',
      }));

    res.status(200).json(results);

  } catch (err) {
    console.error('[search]', err);
    res.status(500).json({ error: 'Zoeken mislukt' });
  }
}
