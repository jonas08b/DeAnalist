// /api/generate-report.js
// Genereert één strategie-rapport (daily / weekly / deep) via Gemini en slaat op in Vercel Blob.
// Wordt aangeroepen door Vercel Cron of handmatig via POST.

import { GoogleGenerativeAI } from '@google/generative-ai';
import { put, list }          from '@vercel/blob';

// ─── helpers ────────────────────────────────────────────────────────────────

const YF_BASE   = 'https://query1.finance.yahoo.com';
const YF_BASE_2 = 'https://query2.finance.yahoo.com';
const YF_HDRS   = { 'User-Agent': 'Mozilla/5.0 (compatible; DeAnalist/1.0)' };

async function fetchQuote(symbol) {
    for (const base of [YF_BASE, YF_BASE_2]) {
        try {
            const r = await fetch(
                `${base}/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=2d`,
                { headers: YF_HDRS }
            );
            if (!r.ok) continue;
            const d    = await r.json();
            const meta = d?.chart?.result?.[0]?.meta;
            if (!meta) continue;
            const price  = meta.regularMarketPrice;
            const prev   = meta.previousClose || meta.chartPreviousClose || price;
            const chgPct = prev ? ((price - prev) / prev) * 100 : 0;
            return { symbol, price, prev, chgPct };
        } catch { continue; }
    }
    return null;
}

async function fetchMarktdata() {
    const syms = {
        sp500: '^GSPC', nasdaq: '^IXIC', vix: '^VIX',
        yield10y: '^TNX', yield2y: '^IRX',
        dxy: 'DX-Y.NYB', oil: 'CL=F', gold: 'GC=F',
        hyg: 'HYG', xlk: 'XLK', xlf: 'XLF', xle: 'XLE',
    };
    const entries = await Promise.all(
        Object.entries(syms).map(async ([k, s]) => [k, await fetchQuote(s)])
    );
    return Object.fromEntries(entries.filter(([, v]) => v));
}

// ─── PDF-HTML template ───────────────────────────────────────────────────────

function buildPdfHtml(type, content, datum) {
    const typeLabels = {
        daily:  { label: 'Daily Strategy Note',         kleur: '#1d4ed8' },
        weekly: { label: 'Weekly Positioning & Structure', kleur: '#7c3aed' },
        deep:   { label: 'Deep-Dive Strategic Research',  kleur: '#0f766e' },
    };
    const tl = typeLabels[type] || typeLabels.daily;

    return `<!DOCTYPE html>
<html lang="nl">
<head>
<meta charset="UTF-8">
<style>
  @import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&display=swap');
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Georgia', serif;
    background: #fff;
    color: #1a202c;
    font-size: 10.5px;
    line-height: 1.6;
  }
  .page { width: 794px; padding: 40px 48px; margin: 0 auto; }

  /* ── HEADER ── */
  .rp-header {
    border-bottom: 2px solid #0f172a;
    padding-bottom: 12px;
    margin-bottom: 16px;
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
  }
  .rp-brand {
    font-size: 7px; font-weight: 700; letter-spacing: 2.5px;
    text-transform: uppercase; color: #C8311A; margin-bottom: 5px;
    font-family: Arial, sans-serif;
  }
  .rp-title {
    font-family: 'DM Serif Display', Georgia, serif;
    font-size: 22px; color: #0f172a; line-height: 1.15; max-width: 520px;
  }
  .rp-meta { text-align: right; font-family: Arial, sans-serif; }
  .rp-type-badge {
    display: inline-block;
    font-size: 7px; font-weight: 700; letter-spacing: 1.5px; text-transform: uppercase;
    padding: 2px 8px; border-radius: 3px; margin-bottom: 6px;
    color: #fff;
    background: ${tl.kleur};
  }
  .rp-datum { font-size: 8.5px; color: #64748b; line-height: 1.8; }

  /* ── EXECUTIVE SUMMARY ── */
  .rp-exec {
    background: #f8fafc; border-left: 3px solid ${tl.kleur};
    padding: 10px 14px; margin-bottom: 16px; border-radius: 0 4px 4px 0;
  }
  .rp-exec-lbl {
    font-size: 7px; font-weight: 700; letter-spacing: 1.5px; text-transform: uppercase;
    color: ${tl.kleur}; margin-bottom: 4px; font-family: Arial, sans-serif;
  }
  .rp-exec-txt { font-size: 10px; color: #334155; line-height: 1.6; }

  /* ── BODY ── */
  .rp-section { margin-bottom: 14px; }
  .rp-section-title {
    font-size: 7.5px; font-weight: 700; text-transform: uppercase;
    letter-spacing: 1px; color: #0f172a;
    border-bottom: 1px solid #e2e8f0; padding-bottom: 3px; margin-bottom: 8px;
    font-family: Arial, sans-serif;
  }
  .rp-body { font-size: 10px; color: #334155; line-height: 1.7; text-align: justify; }
  .rp-body p { margin-bottom: 9px; }
  .rp-body strong { color: #0f172a; }

  /* ── SCENARIO / DATA GRID ── */
  .rp-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 14px; }
  .rp-grid-card {
    background: #f8fafc; border: 1px solid #e2e8f0;
    border-radius: 4px; padding: 9px 11px;
  }
  .rp-grid-lbl { font-size: 8px; font-weight: 700; color: #0f172a; margin-bottom: 4px; font-family: Arial, sans-serif; }
  .rp-grid-txt { font-size: 9px; color: #475569; line-height: 1.5; }

  /* ── MARKTDATA STRIP ── */
  .rp-strip {
    display: grid; grid-template-columns: repeat(6, 1fr);
    gap: 4px; background: #f1f5f9; padding: 7px; border-radius: 4px;
    border: 1px solid #e2e8f0; margin-bottom: 14px; text-align: center;
  }
  .rp-strip-item {}
  .rp-strip-lbl { font-size: 6px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: .5px; font-family: Arial, sans-serif; }
  .rp-strip-val { font-size: 10px; font-weight: 700; color: #0f172a; }
  .rp-strip-chg { font-size: 8px; font-weight: 600; }

  /* ── DISCLAIMER ── */
  .rp-disclaimer {
    margin-top: 24px; padding-top: 10px;
    border-top: 1px solid #e2e8f0;
    font-size: 7.5px; color: #94a3b8; line-height: 1.5;
    font-family: Arial, sans-serif;
  }
</style>
</head>
<body>
<div class="page">
  <!-- HEADER -->
  <div class="rp-header">
    <div>
      <div class="rp-brand">DeAnalist · Research &amp; Strategy Division</div>
      <div class="rp-title">${content.titel}</div>
    </div>
    <div class="rp-meta">
      <div><span class="rp-type-badge">${tl.label}</span></div>
      <div class="rp-datum">
        Datum: <strong>${datum}</strong><br>
        Vrijgegeven: 07:00 CET
      </div>
    </div>
  </div>

  ${content.marktstrip || ''}

  <!-- EXECUTIVE SUMMARY -->
  <div class="rp-exec">
    <div class="rp-exec-lbl">Conclusie</div>
    <div class="rp-exec-txt">${content.conclusie}</div>
  </div>

  ${content.secties}

  <!-- DISCLAIMER -->
  <div class="rp-disclaimer">
    <strong>DeAnalist · Research &amp; Strategy Division</strong> — Dit rapport is uitsluitend informatief van aard en vormt op geen enkele wijze beleggingsadvies. Prognoses zijn gebaseerd op publiek beschikbare marktdata en AI-analyse. Raadpleeg een erkend beleggingsadviseur voor persoonlijk advies. © DeAnalist ${new Date().getFullYear()}
  </div>
</div>
</body>
</html>`;
}

// ─── marktstrip HTML ──────────────────────────────────────────────────────────

function marktStripHtml(markt) {
    if (!markt) return '';
    const items = [
        { lbl: 'S&P 500', val: markt.sp500?.price?.toLocaleString('nl-NL', { minimumFractionDigits: 0 }), pct: markt.sp500?.chgPct },
        { lbl: 'Nasdaq',  val: markt.nasdaq?.price?.toLocaleString('nl-NL', { minimumFractionDigits: 0 }), pct: markt.nasdaq?.chgPct },
        { lbl: 'VIX',     val: markt.vix?.price?.toFixed(2), pct: markt.vix?.chgPct },
        { lbl: '10Y',     val: markt.yield10y?.price?.toFixed(2) + '%', pct: markt.yield10y?.chgPct },
        { lbl: 'DXY',     val: markt.dxy?.price?.toFixed(1), pct: markt.dxy?.chgPct },
        { lbl: 'WTI',     val: '$' + markt.oil?.price?.toFixed(1), pct: markt.oil?.chgPct },
    ].filter(i => i.val && i.val !== 'undefined%' && i.val !== 'undefined');

    const cells = items.map(i => {
        const pos = i.pct > 0, neg = i.pct < 0;
        const clr = pos ? '#16a34a' : neg ? '#dc2626' : '#64748b';
        const pctStr = i.pct != null ? ` ${pos ? '+' : ''}${(+i.pct).toFixed(2)}%` : '';
        return `<div class="rp-strip-item">
          <div class="rp-strip-lbl">${i.lbl}</div>
          <div class="rp-strip-val">${i.val}</div>
          <div class="rp-strip-chg" style="color:${clr}">${pctStr}</div>
        </div>`;
    }).join('');
    return `<div class="rp-strip">${cells}</div>`;
}

// ─── prompt builders ──────────────────────────────────────────────────────────

function buildPrompt(type, marktStr, datum) {
    const basis = `Je bent een senior strateeg bij een institutioneel beleggingsresearchbureau (denk: Gavekal, BCA Research, Goldman Sachs Global Investment Research).
Schrijf UITSLUITEND in het NEDERLANDS. Toon: opiniërend, zelfverzekerd, institutioneel. Geen retail-taal, geen vaagheden.
Geef je antwoord UITSLUITEND als geldig JSON. Geen markdown, geen extra tekst buiten de JSON.

Datum: ${datum}
LIVE MARKTDATA:
${marktStr}
`;

    if (type === 'daily') return basis + `
TAAK: Schrijf een Daily Strategy Note — gefocust op het meest materiële macro-event of marktdynamiek van vandaag.

JSON-formaat:
{
  "titel": "Prikkelende institutionele kop — max 12 woorden, geen clichés",
  "conclusie": "Onze directe aanbeveling in één zin, concreet en directioneel",
  "secties": [
    {
      "titel": "Macro-achtergrond",
      "inhoud": "Twee alinea's: wat zeggen de data van vandaag? Welke trend bevestigt of breekt?"
    },
    {
      "titel": "Directe Positionering",
      "inhoud": "Concrete sectoren, asset classes of handelsstrategie voor vandaag/deze week"
    },
    {
      "titel": "Kernrisico",
      "inhoud": "Het grootste risico dat de consensus onderwaardeert — met concreet getal of niveau"
    }
  ]
}`;

    if (type === 'weekly') return basis + `
TAAK: Schrijf een Weekly Positioning & Structure rapport — gefocust op kapitaalstromen, sectorrotatie en positionering voor de komende week.

JSON-formaat:
{
  "titel": "Prikkelende institutionele kop — max 12 woorden",
  "conclusie": "Onze wekelijkse strategische aanbeveling in één zin",
  "secties": [
    {
      "titel": "Waar zit geld klem?",
      "inhoud": "Crowded trades, overbought sectoren, positionerings-extremen (CFTC, ETF flows)"
    },
    {
      "titel": "Sectorrotatie & Flows",
      "inhoud": "Waar stroomt institutioneel kapitaal naartoe en waarom? Relatieve sterkte-analyse."
    },
    {
      "titel": "Waar dreigt paniek?",
      "inhoud": "Kredietkwaliteit, volatiliteitsregime, katalysatoren die een squeeze kunnen triggeren"
    },
    {
      "titel": "Positionering voor de week",
      "inhoud": "Concrete over- en onderwegingen per sector/asset class voor de komende 5 handelsdagen"
    }
  ]
}`;

    // deep-dive
    return basis + `
TAAK: Schrijf een Deep-Dive Strategic Research rapport — een grondig thematisch onderzoek op basis van de huidige marktomstandigheden.

Kies ZELF het meest relevante thema gezien de live marktdata (bijv. Fed-beleid, sectorrotatie, credit cycle, geopolitieke risico's, AI-capex, etc.)

JSON-formaat:
{
  "titel": "Institutionele thematitel — max 14 woorden, specifiek en prikkelend",
  "conclusie": "De centrale these in één krachtige zin",
  "secties": [
    {
      "titel": "De Centrale These",
      "inhoud": "Twee alinea's: wat is het kernargument? Waarom nu relevant?"
    },
    {
      "titel": "Marktcontext & Data",
      "inhoud": "Concreet bewijs uit de live marktdata — getallen, levels, trends"
    },
    {
      "titel": "Wat de Consensus Mist",
      "inhoud": "De mispricing of het structurele risico dat breed wordt genegeerd"
    },
    {
      "titel": "Scenario-Analyse",
      "inhoud": "Bull, base en bear case — elk met concreet koersdoel of niveau"
    },
    {
      "titel": "Beleggingsimplicaties",
      "inhoud": "Concrete sectoren, thema's of instrumenten — met tijdshorizon"
    }
  ]
}`;
}

// ─── sectie-HTML builder ──────────────────────────────────────────────────────

function sectiesToHtml(secties) {
    return secties.map(s => `
  <div class="rp-section">
    <div class="rp-section-title">${s.titel}</div>
    <div class="rp-body">${s.inhoud.split('\n').filter(Boolean).map(p => `<p>${p}</p>`).join('')}</div>
  </div>`).join('');
}

// ─── main handler ─────────────────────────────────────────────────────────────

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    if (req.method === 'OPTIONS') return res.status(200).end();

    // Cron en POST allebei toegestaan — cron stuurt GET
    const type = (req.query.type || req.body?.type || 'daily').toLowerCase();
    if (!['daily', 'weekly', 'deep'].includes(type)) {
        return res.status(400).json({ error: 'Ongeldig type. Gebruik: daily, weekly, deep.' });
    }

    const geminiKey = process.env.GEMINI_API_KEY;
    const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
    if (!geminiKey) return res.status(500).json({ error: 'GEMINI_API_KEY ontbreekt.' });
    if (!blobToken) return res.status(500).json({ error: 'BLOB_READ_WRITE_TOKEN ontbreekt.' });

    try {
        const markt  = await fetchMarktdata();
        const datum  = new Date().toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
        const datumISO = new Date().toISOString().slice(0, 10);

        // ── Gemini generatie ──
        const genAI  = new GoogleGenerativeAI(geminiKey);
        const model  = genAI.getGenerativeModel({ model: 'gemini-3.5-flash' });
        const marktStr = JSON.stringify(markt, null, 2);

        const result = await model.generateContent(buildPrompt(type, marktStr, datum));
        const raw    = result.response.text().replace(/```json|```/g, '').trim();
        const parsed = JSON.parse(raw);

        // ── PDF-HTML samenstellen ──
        const strip   = marktStripHtml(markt);
        const secties = sectiesToHtml(parsed.secties || []);
        const pdfHtml = buildPdfHtml(type, {
            titel:      parsed.titel,
            conclusie:  parsed.conclusie,
            secties,
            marktstrip: strip,
        }, datum);

        // ── Metadata opslaan als JSON in Blob ──
        const meta = {
            type,
            titel:     parsed.titel,
            conclusie: parsed.conclusie,
            datum,
            datumISO,
            aangemaakt: new Date().toISOString(),
            // Eerste sectie als intro-preview voor de kaart
            intro: (parsed.secties?.[0]?.inhoud || '').slice(0, 280).trim() + '…',
        };

        const metaPath = `strategie-rapporten/${type}/${datumISO}.json`;
        const htmlPath = `strategie-rapporten/${type}/${datumISO}.html`;

        // PDF-HTML opslaan
        await put(htmlPath, pdfHtml, {
            access: 'public', token: blobToken,
            addRandomSuffix: false, contentType: 'text/html',
        });
        // Metadata opslaan
        await put(metaPath, JSON.stringify(meta), {
            access: 'public', token: blobToken,
            addRandomSuffix: false, contentType: 'application/json',
        });

        return res.status(200).json({ success: true, type, datum, titel: parsed.titel });

    } catch (err) {
        console.error('[generate-report]', err);
        return res.status(500).json({ error: `Generatie mislukt: ${err.message}` });
    }
}
