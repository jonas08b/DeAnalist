// /api/peers.js — Vercel Serverless Function
// Haalt peer-tickers op voor een gegeven ticker en fetcht hun data parallel

const FMP_BASE = 'https://financialmodelingprep.com/api/v3';

async function fmp(path, key) {
  const sep = path.includes('?') ? '&' : '?';
  const res = await fetch(`${FMP_BASE}${path}${sep}apikey=${key}`);
  if (!res.ok) return null;
  try { return await res.json(); } catch { return null; }
}

export default async function handler(req, res) {
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

  try {
    // Stap 1: haal peer list op
    const peersData = await fmp(`/stock_peers?symbol=${t}`, key);
    const peerList = Array.isArray(peersData)
      ? (peersData[0]?.peersList || []).slice(0, 4) // max 4 peers
      : [];

    if (!peerList.length) return res.status(200).json([]);

    // Stap 2: haal quote + ratios per peer parallel op (nooit sequentieel)
    const peerResults = await Promise.all(
      peerList.map(async (peerTicker) => {
        const [quoteArr, ratiosData] = await Promise.all([
          fmp(`/quote/${peerTicker}`, key),
          fmp(`/ratios-ttm/${peerTicker}`, key),
        ]);
        const quote  = Array.isArray(quoteArr)  ? quoteArr[0]  : quoteArr  || {};
        const ratios = Array.isArray(ratiosData) ? ratiosData[0] : ratiosData || {};
        return { ticker: peerTicker, quote, ratios };
      })
    );

    // Filter mislukte ophaalingen
    const valid = peerResults.filter(p => p.quote?.symbol);

    res.status(200).json(valid);

  } catch (err) {
    console.error('[peers]', err);
    // Peers zijn optioneel — geef lege array terug bij fout
    res.status(200).json([]);
  }
}
