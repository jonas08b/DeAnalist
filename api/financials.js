// /api/financials.js — Vercel Serverless Function
// Haalt financiële data op van Financial Modeling Prep (FMP)
// API-key nooit in frontend — enkel via process.env.FMP_API_KEY

const FMP_BASE = 'https://financialmodelingprep.com/api/v3';

// Simpele in-memory rate limiting: max 10 rapporten per IP per dag
const rateLimitMap = new Map();

function checkRateLimit(ip) {
  const now = Date.now();
  const DAY  = 24 * 60 * 60 * 1000;
  const MAX  = 10;

  const entry = rateLimitMap.get(ip);
  if (!entry || now - entry.start > DAY) {
    rateLimitMap.set(ip, { count: 1, start: now });
    return true;
  }
  if (entry.count >= MAX) return false;
  entry.count++;
  return true;
}

async function fmp(path, key) {
  const sep = path.includes('?') ? '&' : '?';
  const url = `${FMP_BASE}${path}${sep}apikey=${key}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`FMP ${path} → HTTP ${res.status}`);
  return res.json();
}

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const key = process.env.FMP_API_KEY;
  if (!key) return res.status(500).json({ error: 'FMP_API_KEY niet geconfigureerd' });

  const { ticker } = req.query;
  if (!ticker || !/^[A-Z0-9.]{1,10}$/i.test(ticker)) {
    return res.status(400).json({ error: 'Ongeldige ticker' });
  }
  const t = ticker.toUpperCase();

  // Rate limiting
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
  if (!checkRateLimit(ip)) {
    return res.status(429).json({ error: 'Dagelijkse limiet bereikt (max 10 rapporten per dag). Probeer morgen opnieuw.' });
  }

  try {
    // Parallel ophalen
    const [quoteArr, profileArr, incomeArr, balanceArr, ratiosData, estimatesArr, consensusArr] = await Promise.all([
      fmp(`/quote/${t}`, key),
      fmp(`/profile/${t}`, key),
      fmp(`/income-statement/${t}?limit=3`, key),
      fmp(`/balance-sheet-statement/${t}?limit=1`, key),
      fmp(`/ratios-ttm/${t}`, key),
      fmp(`/analyst-estimates/${t}?limit=2`, key),
      fmp(`/price-target-consensus/${t}`, key),
    ]);

    const quote   = Array.isArray(quoteArr)   ? quoteArr[0]   : quoteArr   || {};
    const profile = Array.isArray(profileArr) ? profileArr[0] : profileArr || {};
    const ratios  = Array.isArray(ratiosData) ? ratiosData[0] : ratiosData || {};

    // Valideer: is ticker gevonden?
    if (!quote || !quote.symbol) {
      return res.status(404).json({ error: `Ticker "${t}" niet gevonden. Controleer de ticker en probeer opnieuw.` });
    }

    // Forward estimates: eerste toekomstige FY
    const nextEstimate = (Array.isArray(estimatesArr) ? estimatesArr : [])
      .find(e => e.estimatedRevenueLow || e.estimatedEpsLow) || {};

    const consensus = Array.isArray(consensusArr) ? consensusArr[0] : consensusArr || {};

    res.status(200).json({
      quote,
      profile,
      income:  Array.isArray(incomeArr)  ? incomeArr  : [],
      balance: Array.isArray(balanceArr) ? balanceArr : [],
      ratios,
      estimates: {
        estimatedRevenue: nextEstimate.estimatedRevenueAvg || null,
        estimatedEps:     nextEstimate.estimatedEpsAvg     || null,
      },
      consensus: {
        targetConsensus:  consensus.targetConsensus  || null,
        targetHigh:       consensus.targetHigh       || null,
        targetLow:        consensus.targetLow        || null,
        consensusRating:  consensus.rating           || null,
        numberOfAnalysts: consensus.numberOfAnalysts || null,
      },
    });

  } catch (err) {
    console.error('[financials]', err);

    if (err.message?.includes('429') || err.message?.includes('quota')) {
      return res.status(429).json({ error: 'FMP-daglimiet bereikt (250 req/dag). Probeer later opnieuw.' });
    }

    res.status(500).json({ error: err.message || 'Onbekende fout bij ophalen data' });
  }
}
