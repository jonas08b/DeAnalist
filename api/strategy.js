// /api/strategy.js — Vercel Serverless Function
// Haalt live marktdata op + genereert AI-strategie analyse
import { GoogleGenerativeAI } from '@google/generative-ai';

const YF_BASE = 'https://query1.finance.yahoo.com';
const YF_BASE_2 = 'https://query2.finance.yahoo.com';
const HEADERS = { 'User-Agent': 'Mozilla/5.0 (compatible; DeAnalist/1.0)' };

async function fetchQuote(symbol) {
    for (const base of [YF_BASE, YF_BASE_2]) {
        try {
            const res = await fetch(
                `${base}/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=2d`,
                { headers: HEADERS }
            );
            if (!res.ok) continue;
            const data = await res.json();
            const meta = data?.chart?.result?.[0]?.meta;
            if (!meta) continue;
            const price = meta.regularMarketPrice;
            const prev  = meta.previousClose || meta.chartPreviousClose || price;
            const chgPct = prev ? ((price - prev) / prev) * 100 : 0;
            return { symbol, price, prev, chgPct, name: meta.shortName || symbol };
        } catch { continue; }
    }
    return null;
}

async function fetchAllQuotes() {
    const symbols = {
        sp500:  '^GSPC',
        nasdaq: '^IXIC',
        vix:    '^VIX',
        yield10y: '^TNX',
        yield2y:  '^IRX',
        dxy:    'DX-Y.NYB',
        oil:    'CL=F',
        gold:   'GC=F',
        hyg:    'HYG',   // HY credit proxy
        xlk:    'XLK',   // Tech sector
        xlf:    'XLF',   // Financials
        xle:    'XLE',   // Energy
    };
    const results = await Promise.all(
        Object.entries(symbols).map(async ([key, sym]) => [key, await fetchQuote(sym)])
    );
    return Object.fromEntries(results.filter(([, v]) => v));
}

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    if (req.method === 'OPTIONS') return res.status(200).end();

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY ontbreekt.' });

    try {
        // 1. Live marktdata ophalen
        const markt = await fetchAllQuotes();

        // Bereken yield curve spread (10Y - 2Y, proxy)
        const yieldSpread = markt.yield10y && markt.yield2y
            ? (markt.yield10y.price - markt.yield2y.price).toFixed(2)
            : null;

        const dataStr = JSON.stringify({
            timestamp: new Date().toISOString(),
            markt,
            yieldCurveSpread: yieldSpread ? `${yieldSpread}%` : 'N/B',
        }, null, 2);

        // 2. Gemini analyse
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: 'gemini-3.5-flash' });

        const prompt = `Je bent een senior macro-strateeg bij een institutioneel beleggingsresearchbureau — denk Gavekal, BCA Research.
Schrijf UITSLUITEND in het NEDERLANDS. Toon: opiniërend, zelfverzekerd, institutioneel. Geen retail-taal.

TAAK: analyseer de onderstaande live marktdata en genereer een volledig marktregime-rapport.

MARKTDATA (real-time):
${dataStr}

SCORINGSINSTRUCTIES voor de 5 indicatoren (elk 0-100, waar 0=zeer bearish, 50=neutraal, 100=zeer bullish):
- Macro & Groei: kijk naar S&P 500 momentum, sectordynamiek XLK vs XLF vs XLE
- Monetair Beleid: yield curve spread, richting rates, financial conditions (DXY impact)
- Positionering: VIX-niveau en richting (hoog VIX = bearish positionering = kans), HYG als credit proxy
- Momentum: S&P 500 en Nasdaq dagrendement en relatieve sterkte
- Kredietmarkt: HYG koers en richting als proxy voor credit spreads

REGIME-DEFINITIE:
- Offensief: gewogen gemiddelde score > 60
- Neutraal: gewogen gemiddelde score 40-60
- Defensief: gewogen gemiddelde score < 40

Geef je antwoord UITSLUITEND als geldig JSON. Geen markdown, geen extra tekst:

{
  "regime": "Offensief of Neutraal of Defensief",
  "regimeScore": 0-100,
  "indicators": [
    { "naam": "Macro & Groei",    "score": 0-100, "richting": "positief of neutraal of negatief", "toelichting": "één zin, concreet getal" },
    { "naam": "Monetair Beleid",  "score": 0-100, "richting": "positief of neutraal of negatief", "toelichting": "één zin, concreet getal" },
    { "naam": "Positionering",    "score": 0-100, "richting": "positief of neutraal of negatief", "toelichting": "één zin, concreet getal" },
    { "naam": "Momentum",         "score": 0-100, "richting": "positief of neutraal of negatief", "toelichting": "één zin, concreet getal" },
    { "naam": "Kredietmarkt",     "score": 0-100, "richting": "positief of neutraal of negatief", "toelichting": "één zin, concreet getal" }
  ],
  "visie": {
    "tag": "Strategy Note",
    "titel": "Prikkelende, opiniërende titel — max 12 woorden — geen clichés",
    "conclusie": "Onze conclusie in één zin: concreet, directioneel, geen open deuren",
    "tekst": "Twee alinea's. Eerste: wat de marktdata zegt, met concrete getallen uit de data. Tweede: wat de markt mist — de mispricing of het risico dat niet geprijsd is. Institutionele toon. Sluit af met een concrete aanbeveling.",
    "datum": "${new Date().toLocaleDateString('nl-NL', { day: 'numeric', month: 'long', year: 'numeric' })}"
  },
  "marktdata": {
    "sp500":   { "prijs": 0, "changePct": 0 },
    "nasdaq":  { "prijs": 0, "changePct": 0 },
    "vix":     { "waarde": 0, "changePct": 0 },
    "yield10y":{ "waarde": 0, "changePct": 0 },
    "dxy":     { "waarde": 0, "changePct": 0 },
    "oil":     { "waarde": 0, "changePct": 0 }
  }
}`;

        const result = await model.generateContent(prompt);
        const raw = result.response.text().replace(/```json|```/g, '').trim();
        const parsed = JSON.parse(raw);

        // Vul marktdata aan met echte waarden (AI kan die soms afronden)
        if (markt.sp500)   { parsed.marktdata.sp500   = { prijs: +markt.sp500.price.toFixed(2),   changePct: +markt.sp500.chgPct.toFixed(2) }; }
        if (markt.nasdaq)  { parsed.marktdata.nasdaq  = { prijs: +markt.nasdaq.price.toFixed(2),  changePct: +markt.nasdaq.chgPct.toFixed(2) }; }
        if (markt.vix)     { parsed.marktdata.vix     = { waarde: +markt.vix.price.toFixed(2),    changePct: +markt.vix.chgPct.toFixed(2) }; }
        if (markt.yield10y){ parsed.marktdata.yield10y = { waarde: +markt.yield10y.price.toFixed(2), changePct: +markt.yield10y.chgPct.toFixed(2) }; }
        if (markt.dxy)     { parsed.marktdata.dxy     = { waarde: +markt.dxy.price.toFixed(2),    changePct: +markt.dxy.chgPct.toFixed(2) }; }
        if (markt.oil)     { parsed.marktdata.oil     = { waarde: +markt.oil.price.toFixed(2),    changePct: +markt.oil.chgPct.toFixed(2) }; }

        return res.status(200).json(parsed);

    } catch (err) {
        console.error('[strategy]', err);
        return res.status(500).json({ error: `Strategie-analyse mislukt: ${err.message}` });
    }
}
