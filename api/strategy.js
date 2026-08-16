// api/strategy.js — Marktregime-analyse & Premium Strategy Note
// Primair: Gemini Flash  |  Fallback: Groq llama-3.3-70b-versatile
// Dagelijkse server-side cache via Vercel Blob (per thema)

import { callAI, parseJsonResponse } from './_ai-helper.js';
import { put, head }                  from '@vercel/blob';

const YF_BASE   = 'https://query1.finance.yahoo.com';
const YF_BASE_2 = 'https://query2.finance.yahoo.com';
const HEADERS   = { 'User-Agent': 'Mozilla/5.0 (compatible; DeAnalist/1.0)' };

function cacheKey(thema) {
    const d = new Date().toISOString().slice(0, 10);
    const slug = thema ? `-${thema.replace(/[^a-z0-9]/gi, '_').toLowerCase()}` : '';
    return `strategie-cache/regime-${d}${slug}.json`;
}

async function readCache(token, thema) {
    try {
        const blob = await head(cacheKey(thema), { token });
        if (!blob?.url) return null;
        const res = await fetch(blob.url);
        if (!res.ok) return null;
        return await res.json();
    } catch { return null; }
}

async function writeCache(data, token, thema) {
    try {
        await put(cacheKey(thema), JSON.stringify(data), {
            access: 'public',
            token,
            addRandomSuffix: false,
            contentType: 'application/json',
        });
    } catch (e) {
        console.warn('[strategy] Blob schrijven mislukt:', e.message);
    }
}

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
            const price  = meta.regularMarketPrice;
            const prev   = meta.previousClose || meta.chartPreviousClose || price;
            const chgPct = prev ? ((price - prev) / prev) * 100 : 0;
            return { symbol, price, prev, chgPct, name: meta.shortName || symbol };
        } catch { continue; }
    }
    return null;
}

async function fetchAllQuotes() {
    const symbols = {
        sp500:    '^GSPC',
        nasdaq:   '^IXIC',
        vix:      '^VIX',
        yield10y: '^TNX',
        yield2y:  '^IRX',
        bund:     'GDBR10=X',   // 10Y Duits Bund rendement
        dxy:      'DX-Y.NYB',
        eurusd:   'EURUSD=X',
        oil:      'CL=F',
        gold:     'GC=F',
        hyg:      'HYG',
        xlk:      'XLK',
        xlf:      'XLF',
        xle:      'XLE',
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

    const geminiKey = process.env.GEMINI_API_KEY;
    const groqKey   = process.env.GROQ_API_KEY;
    const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
    const thema     = (req.query.thema || '').trim();

    if (!geminiKey) return res.status(500).json({ error: 'GEMINI_API_KEY ontbreekt.' });

    try {
        // ── 1. Controleer Blob-cache ──────────────────────────────────────
        if (blobToken) {
            const cached = await readCache(blobToken, thema);
            if (cached) {
                return res.status(200).json({ ...cached, _cached: true });
            }
        }

        // ── 2. Verse marktdata ophalen ────────────────────────────────────
        const markt = await fetchAllQuotes();

        const yieldSpread = markt.yield10y && markt.yield2y
            ? (markt.yield10y.price - markt.yield2y.price).toFixed(2)
            : null;

        const bundYield = markt.bund?.price?.toFixed(2) ?? 'N/B';

        const dataStr = JSON.stringify({
            timestamp: new Date().toISOString(),
            markt,
            yieldCurveSpread_US: yieldSpread ? `${yieldSpread}%` : 'N/B',
            bund10Y: bundYield !== 'N/B' ? `${bundYield}%` : 'N/B',
        }, null, 2);

        // ── 3. AI-analyse (Gemini Flash → Groq fallback) ─────────────────
        const themaFocus = thema
            ? `\nFOCUS THEMA: ${thema} — verdiep je analyse specifiek in dit thema. Geef historische context, huidige niveaus, en voorwaartse implicaties voor dit thema.`
            : '';

        const prompt = `Je bent een senior macro-strateeg bij een institutioneel beleggingsresearchbureau — denk Gavekal, BCA Research, Bridgewater. Je schrijft voor professionele beleggers die geen basisinformatie nodig hebben.
Schrijf UITSLUITEND in het NEDERLANDS. Toon: opiniërend, contrariaans waar de data dit rechtvaardigt, institutioneel. Geen retail-taal. Geen beschrijving van wat er al is — uitsluitend forward-looking strategie.
${themaFocus}

TAAK: analyseer de onderstaande live marktdata en schrijf een premium strategy note in de stijl van een Equity Research rapport.

MARKTDATA (real-time):
${dataStr}

STRIKTE EISEN:
1. GEEN FEITCONSTATERING — niet beschrijven wat er al is gebeurd. Alleen: wat impliceert dit voor de komende 5–20 handelsdagen?
2. EIGEN EDGE — geef een visie die afwijkt van de consensus wanneer de data dit rechtvaardigt. Benoem expliciet wat de markt mispriced.
3. KWANTITATIEVE ONDERBOUWING — noem concrete niveaus (S&P 500 support/weerstand, VIX drempel, Bund yield range, DXY pivot, etc.) en historische context (bijv. "spread laagste punt sinds Q3 2007", "VIX percentiel").
4. DRIE VOLLEDIGE SCENARIO'S — bull/base/bear met kansgewichten die optellen tot exact 100%. Elke trigger en implicatie moet concreet zijn met niveau en timeframe.
5. MINIMAAL 3 KERNRISICO'S — zowel opwaartse als neerwaartse risico's met concrete triggers en historische precedenten.

Geef je antwoord UITSLUITEND als geldig JSON. Geen markdown, geen backticks, geen extra tekst buiten de JSON:

{
  "regime": "Offensief of Neutraal of Defensief",
  "regimeScore": 0,
  "indicators": [
    { "naam": "Macro & Groei",   "score": 0, "richting": "positief of neutraal of negatief", "toelichting": "één zin: concreet getal + forward implicatie (niet wat er al is)" },
    { "naam": "Monetair Beleid", "score": 0, "richting": "positief of neutraal of negatief", "toelichting": "één zin: concreet getal + forward implicatie" },
    { "naam": "Positionering",   "score": 0, "richting": "positief of neutraal of negatief", "toelichting": "één zin: concreet getal + forward implicatie" },
    { "naam": "Momentum",        "score": 0, "richting": "positief of neutraal of negatief", "toelichting": "één zin: concreet getal + forward implicatie" },
    { "naam": "Kredietmarkt",    "score": 0, "richting": "positief of neutraal of negatief", "toelichting": "één zin: concreet getal + forward implicatie" }
  ],
  "visie": {
    "tag": "Strategy Note",
    "titel": "Prikkelende contrariaanse titel — max 12 woorden — geen clichés, geen 'de markt'",
    "conclusie": "Eén directionale zin: concreet niveau, timeframe, catalyst — geen open deuren",
    "tekst": "Twee alinea's. §1: wat de marktdata impliceert voor de komende weken — met concrete niveaus en historische context (bijv. 'voor het eerst sinds...'). §2: de specifieke mispricing of het risico dat de consensus negeert. Sluit af met een concrete aanbeveling inclusief entry zone en conditie.",
    "datum": "${new Date().toLocaleDateString('nl-NL', { day: 'numeric', month: 'long', year: 'numeric' })}"
  },
  "scenarios": [
    {
      "label": "Bull Case",
      "kans": 30,
      "trigger": "concreet event of niveau dat dit scenario activeert — bijv. 'S&P 500 sluit boven 5.650 op volume >1.5× gemiddelde'",
      "implicatie": "concreet koersdoel of sectorrotatie met timeframe — bijv. 'ruimte naar 5.900 binnen 6 weken; overweeg XLK vs XLE'"
    },
    {
      "label": "Base Case",
      "kans": 50,
      "trigger": "beschrijf het pad dat moet aanhouden — concrete condities",
      "implicatie": "verwachte range met sectorpositioning — concreet"
    },
    {
      "label": "Bear Case",
      "kans": 20,
      "trigger": "concreet event of niveau dat dit scenario activeert",
      "implicatie": "concreet neerwaarts niveau en defensieve positionering — bijv. 'VIX naar 30+, uitwijken naar treasuries en goud'"
    }
  ],
  "kernrisicos": [
    { "titel": "Korte risiconaam", "richting": "neerwaarts", "toelichting": "Trigger: [concreet event]. Niveau: [concreet]. Precedent: [historische referentie]." },
    { "titel": "Korte risiconaam", "richting": "opwaarts",  "toelichting": "Trigger: [concreet event]. Niveau: [concreet]. Precedent: [historische referentie]." },
    { "titel": "Korte risiconaam", "richting": "neerwaarts", "toelichting": "Trigger: [concreet event]. Niveau: [concreet]. Precedent: [historische referentie]." }
  ],
  "positioning": {
    "aanbeveling": "Long / Short / Neutraal [asset of sector] — één zin",
    "entryZone": "concreet niveau of conditie voor entry",
    "target": "concreet koersdoel",
    "horizon": "timeframe in handelsdagen of weken"
  },
  "marktdata": {
    "sp500":    { "prijs": 0, "changePct": 0 },
    "nasdaq":   { "prijs": 0, "changePct": 0 },
    "vix":      { "waarde": 0, "changePct": 0 },
    "yield10y": { "waarde": 0, "changePct": 0 },
    "bund":     { "waarde": 0, "changePct": 0 },
    "dxy":      { "waarde": 0, "changePct": 0 },
    "oil":      { "waarde": 0, "changePct": 0 }
  }
}`;

        const { text, provider } = await callAI(prompt, { geminiKey, groqKey });
        const parsed = parseJsonResponse(text);

        // Overschrijf marktdata met echte waarden
        if (markt.sp500)    { parsed.marktdata.sp500    = { prijs: +markt.sp500.price.toFixed(2),     changePct: +markt.sp500.chgPct.toFixed(2) }; }
        if (markt.nasdaq)   { parsed.marktdata.nasdaq   = { prijs: +markt.nasdaq.price.toFixed(2),    changePct: +markt.nasdaq.chgPct.toFixed(2) }; }
        if (markt.vix)      { parsed.marktdata.vix      = { waarde: +markt.vix.price.toFixed(2),      changePct: +markt.vix.chgPct.toFixed(2) }; }
        if (markt.yield10y) { parsed.marktdata.yield10y = { waarde: +markt.yield10y.price.toFixed(2), changePct: +markt.yield10y.chgPct.toFixed(2) }; }
        if (markt.bund)     { parsed.marktdata.bund     = { waarde: +markt.bund.price.toFixed(2),     changePct: +markt.bund.chgPct.toFixed(2) }; }
        if (markt.dxy)      { parsed.marktdata.dxy      = { waarde: +markt.dxy.price.toFixed(2),      changePct: +markt.dxy.chgPct.toFixed(2) }; }
        if (markt.oil)      { parsed.marktdata.oil      = { waarde: +markt.oil.price.toFixed(2),      changePct: +markt.oil.chgPct.toFixed(2) }; }

        parsed._provider = provider;
        parsed._thema    = thema || null;

        // ── 4. Sla op in Blob ─────────────────────────────────────────────
        if (blobToken) {
            await writeCache(parsed, blobToken, thema);
        }

        return res.status(200).json({ ...parsed, _cached: false });

    } catch (err) {
        console.error('[strategy]', err);
        return res.status(500).json({ error: `Strategie-analyse mislukt: ${err.message}` });
    }
}
