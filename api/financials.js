// /api/financials.js — Vercel Serverless Function
// Haalt financiële data op van Financial Modeling Prep (FMP)
// API-key nooit in frontend — enkel via process.env.FMP_API_KEY

const FMP_BASE = 'https://financialmodelingprep.com/stable';

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
    // Parallel ophalen — nieuwe stable endpoints (query param ?symbol= i.p.v. path param)
    const [quote, profile, incomeArr, balanceArr, ratiosTtm, keyMetricsTtm] = await Promise.all([
      fmp(`/quote?symbol=${t}`, key),
      fmp(`/profile?symbol=${t}`, key),
      fmp(`/income-statement?symbol=${t}&limit=3`, key),
      fmp(`/balance-sheet-statement?symbol=${t}&limit=1`, key),
      fmp(`/ratios-ttm?symbol=${t}`, key),
      fmp(`/key-metrics-ttm?symbol=${t}`, key),
    ]);

    // Premium endpoints — fail silently als plan het niet toestaat
    const [estimatesArr, consensusArr] = await Promise.all([
      fmp(`/analyst-estimates?symbol=${t}&period=annual&limit=2`, key).catch(() => []),
      fmp(`/price-target-consensus?symbol=${t}`, key).catch(() => null),
    ]);

    // Nieuwe stable API geeft object terug, geen array voor quote/profile
    const quoteData   = Array.isArray(quote)   ? quote[0]   : quote   || {};
    const profileData = Array.isArray(profile) ? profile[0] : profile || {};
    const ratios      = Array.isArray(ratiosTtm)     ? ratiosTtm[0]     : ratiosTtm     || {};
    const keyMetrics  = Array.isArray(keyMetricsTtm) ? keyMetricsTtm[0] : keyMetricsTtm || {};

    // Valideer: is ticker gevonden?
    if (!quoteData || !quoteData.symbol) {
      return res.status(404).json({ error: `Ticker "${t}" niet gevonden. Controleer de ticker en probeer opnieuw.` });
    }

    // Forward estimates: eerste toekomstige FY
    const nextEstimate = (Array.isArray(estimatesArr) ? estimatesArr : [])
      .find(e => e.estimatedRevenueLow || e.estimatedEpsLow) || {};

    const consensus = Array.isArray(consensusArr) ? consensusArr[0] : consensusArr || {};

    res.status(200).json({
      quote:   quoteData,
      profile: profileData,
      income:  Array.isArray(incomeArr)  ? incomeArr  : [],
      balance: Array.isArray(balanceArr) ? balanceArr : [],
      ratios,
      keyMetrics,
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
