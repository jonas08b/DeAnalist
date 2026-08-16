// api/generate-report.js
// Genereert één strategie-rapport (daily / weekly / deep) via Gemini 3.5 Flash
// met Groq llama-3.3-70b-versatile als fallback bij rate limits.
// Slaat metadata + HTML op in Vercel Blob.
// Wordt aangeroepen door Vercel Cron (GET) of handmatig (GET/POST).

import { callAI, parseJsonResponse } from './_ai-helper.js';
import { put, list }                  from '@vercel/blob';

// ─── Yahoo Finance helpers ───────────────────────────────────────────────────

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
        sp500:   '^GSPC',  nasdaq:   '^IXIC',  vix:      '^VIX',
        yield10y:'^TNX',   yield2y:  '^IRX',
        dxy:     'DX-Y.NYB', oil:    'CL=F',   gold:     'GC=F',
        hyg:     'HYG',    xlk:      'XLK',    xlf:      'XLF',   xle: 'XLE',
    };
    const entries = await Promise.all(
        Object.entries(syms).map(async ([k, s]) => [k, await fetchQuote(s)])
    );
    return Object.fromEntries(entries.filter(([, v]) => v));
}

// ─── Marktstrip HTML ─────────────────────────────────────────────────────────

function marktStripHtml(markt) {
    if (!markt) return '';
    const items = [
        { lbl: 'S&P 500', val: markt.sp500?.price?.toLocaleString('nl-NL',   { minimumFractionDigits: 0 }), pct: markt.sp500?.chgPct },
        { lbl: 'Nasdaq',  val: markt.nasdaq?.price?.toLocaleString('nl-NL',  { minimumFractionDigits: 0 }), pct: markt.nasdaq?.chgPct },
        { lbl: 'VIX',     val: markt.vix?.price?.toFixed(2),                                                pct: markt.vix?.chgPct },
        { lbl: '10Y',     val: markt.yield10y?.price?.toFixed(2) + '%',                                     pct: markt.yield10y?.chgPct },
        { lbl: 'DXY',     val: markt.dxy?.price?.toFixed(1),                                                pct: markt.dxy?.chgPct },
        { lbl: 'WTI',     val: '$' + markt.oil?.price?.toFixed(1),                                          pct: markt.oil?.chgPct },
    ].filter(i => i.val && !i.val.startsWith('undefined'));

    const cells = items.map(i => {
        const pos = i.pct > 0, neg = i.pct < 0;
        const clr = pos ? '#16a34a' : neg ? '#dc2626' : '#64748b';
        const pctStr = i.pct != null ? `${pos ? '+' : ''}${(+i.pct).toFixed(2)}%` : '';
        return `<div class="rp-strip-item">
          <div class="rp-strip-lbl">${i.lbl}</div>
          <div class="rp-strip-val">${i.val}</div>
          <div class="rp-strip-chg" style="color:${clr}">${pctStr}</div>
        </div>`;
    }).join('');

    return `<div class="rp-strip">${cells}</div>`;
}

// ─── Secties HTML ─────────────────────────────────────────────────────────────

function sectiesToHtml(secties) {
    return secties.map(s => `
  <div class="rp-section">
    <div class="rp-section-title">${s.titel}</div>
    <div class="rp-body">${
        s.inhoud.split('\n').filter(Boolean).map(p => `<p>${p}</p>`).join('')
    }</div>
  </div>`).join('');
}

// ─── Professionele PDF-HTML template ─────────────────────────────────────────

function buildPdfHtml(type, content, datum) {
    const typeConfig = {
        daily:  { label: 'Daily Strategy Note',             kleur: '#1d4ed8', kleurLicht: '#eff6ff', kleurBorder: '#bfdbfe' },
        weekly: { label: 'Weekly Positioning & Structure',  kleur: '#7c3aed', kleurLicht: '#f5f3ff', kleurBorder: '#ddd6fe' },
        deep:   { label: 'Deep-Dive Strategic Research',    kleur: '#0f766e', kleurLicht: '#f0fdfa', kleurBorder: '#99f6e4' },
    };
    const tc = typeConfig[type] || typeConfig.daily;
    const jaar = new Date().getFullYear();

    return `<!DOCTYPE html>
<html lang="nl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>DeAnalist — ${tc.label} — ${datum}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=Inter:wght@400;500;600;700&display=swap');

  * { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    font-family: 'Inter', -apple-system, sans-serif;
    background: #ffffff;
    color: #1a202c;
    font-size: 11px;
    line-height: 1.65;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  .page {
    width: 794px;
    min-height: 1123px;
    margin: 0 auto;
    padding: 0;
    position: relative;
  }

  /* ── TOPBAR ── */
  .rp-topbar {
    background: #0f172a;
    padding: 10px 48px;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .rp-topbar-brand {
    font-family: 'DM Serif Display', Georgia, serif;
    font-size: 16px;
    color: #ffffff;
    letter-spacing: -0.3px;
  }
  .rp-topbar-brand span { color: #C8311A; }
  .rp-topbar-division {
    font-size: 8px;
    font-weight: 600;
    letter-spacing: 2px;
    text-transform: uppercase;
    color: #64748b;
  }

  /* ── TYPE BANNER ── */
  .rp-banner {
    background: ${tc.kleur};
    padding: 6px 48px;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .rp-banner-type {
    font-size: 8px;
    font-weight: 700;
    letter-spacing: 2px;
    text-transform: uppercase;
    color: rgba(255,255,255,0.9);
  }
  .rp-banner-datum {
    font-size: 9px;
    color: rgba(255,255,255,0.75);
  }

  /* ── CONTENT AREA ── */
  .rp-content {
    padding: 32px 48px 40px;
  }

  /* ── TITLE BLOCK ── */
  .rp-title-block {
    margin-bottom: 24px;
    padding-bottom: 20px;
    border-bottom: 2px solid #e2e8f0;
  }
  .rp-eyebrow {
    font-size: 8px;
    font-weight: 700;
    letter-spacing: 2px;
    text-transform: uppercase;
    color: ${tc.kleur};
    margin-bottom: 8px;
  }
  .rp-title {
    font-family: 'DM Serif Display', Georgia, serif;
    font-size: 26px;
    color: #0f172a;
    line-height: 1.2;
    letter-spacing: -0.5px;
    margin-bottom: 12px;
    max-width: 580px;
  }
  .rp-meta-row {
    display: flex;
    align-items: center;
    gap: 16px;
    flex-wrap: wrap;
  }
  .rp-meta-item {
    font-size: 9px;
    color: #64748b;
    display: flex;
    align-items: center;
    gap: 5px;
  }
  .rp-meta-item strong { color: #334155; font-weight: 600; }

  /* ── MARKTSTRIP ── */
  .rp-strip {
    display: grid;
    grid-template-columns: repeat(6, 1fr);
    gap: 1px;
    background: #e2e8f0;
    border: 1px solid #e2e8f0;
    border-radius: 6px;
    overflow: hidden;
    margin-bottom: 22px;
  }
  .rp-strip-item {
    background: #f8fafc;
    padding: 8px 10px;
    text-align: center;
  }
  .rp-strip-lbl { font-size: 7px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 2px; }
  .rp-strip-val { font-size: 11px; font-weight: 700; color: #0f172a; }
  .rp-strip-chg { font-size: 9px; font-weight: 600; margin-top: 1px; }

  /* ── CONCLUSIE BOX ── */
  .rp-conclusie {
    background: ${tc.kleurLicht};
    border: 1px solid ${tc.kleurBorder};
    border-left: 4px solid ${tc.kleur};
    border-radius: 0 6px 6px 0;
    padding: 14px 18px;
    margin-bottom: 24px;
  }
  .rp-conclusie-label {
    font-size: 7.5px;
    font-weight: 700;
    letter-spacing: 1.5px;
    text-transform: uppercase;
    color: ${tc.kleur};
    margin-bottom: 5px;
  }
  .rp-conclusie-text {
    font-size: 11px;
    color: #1e293b;
    line-height: 1.6;
    font-weight: 500;
  }

  /* ── SECTIES ── */
  .rp-section {
    margin-bottom: 18px;
  }
  .rp-section-title {
    font-size: 8px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 1.5px;
    color: #0f172a;
    border-bottom: 1px solid #e2e8f0;
    padding-bottom: 5px;
    margin-bottom: 10px;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .rp-section-title::before {
    content: '';
    display: inline-block;
    width: 3px;
    height: 10px;
    background: ${tc.kleur};
    border-radius: 2px;
    flex-shrink: 0;
  }
  .rp-body { font-size: 10.5px; color: #334155; line-height: 1.75; text-align: justify; }
  .rp-body p { margin-bottom: 10px; }
  .rp-body p:last-child { margin-bottom: 0; }
  .rp-body strong { color: #0f172a; font-weight: 600; }

  /* ── DIVIDER ── */
  .rp-divider {
    height: 1px;
    background: #e2e8f0;
    margin: 22px 0;
  }

  /* ── FOOTER ── */
  .rp-footer {
    background: #f8fafc;
    border-top: 1px solid #e2e8f0;
    padding: 14px 48px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 20px;
  }
  .rp-disclaimer {
    font-size: 7.5px;
    color: #94a3b8;
    line-height: 1.5;
    flex: 1;
  }
  .rp-disclaimer strong { color: #64748b; }
  .rp-footer-logo {
    font-family: 'DM Serif Display', Georgia, serif;
    font-size: 13px;
    color: #94a3b8;
    white-space: nowrap;
    flex-shrink: 0;
  }
  .rp-footer-logo span { color: #C8311A; }

  @media print {
    body { font-size: 10px; }
    .page { width: 100%; }
  }
</style>
</head>
<body>
<div class="page">

  <!-- TOPBAR -->
  <div class="rp-topbar">
    <div class="rp-topbar-brand">De<span>Analist</span></div>
    <div class="rp-topbar-division">Research &amp; Strategy Division</div>
  </div>

  <!-- TYPE BANNER -->
  <div class="rp-banner">
    <div class="rp-banner-type">${tc.label}</div>
    <div class="rp-banner-datum">Vrijgegeven 07:00 CET &nbsp;·&nbsp; ${datum}</div>
  </div>

  <!-- CONTENT -->
  <div class="rp-content">

    <!-- TITEL -->
    <div class="rp-title-block">
      <div class="rp-eyebrow">${tc.label}</div>
      <div class="rp-title">${content.titel}</div>
      <div class="rp-meta-row">
        <div class="rp-meta-item">📅 <strong>${datum}</strong></div>
        <div class="rp-meta-item">🕖 <strong>07:00 CET</strong></div>
        <div class="rp-meta-item">📊 <strong>Marktdata: Live bij publicatie</strong></div>
      </div>
    </div>

    <!-- MARKTSTRIP -->
    ${content.marktstrip || ''}

    <!-- CONCLUSIE -->
    <div class="rp-conclusie">
      <div class="rp-conclusie-label">Onze conclusie</div>
      <div class="rp-conclusie-text">${content.conclusie}</div>
    </div>

    <!-- SECTIES -->
    ${content.secties}

  </div>

  <!-- FOOTER -->
  <div class="rp-footer">
    <div class="rp-disclaimer">
      <strong>Disclaimer:</strong> Dit rapport is uitsluitend informatief van aard en vormt op geen enkele wijze beleggingsadvies, aanbeveling of uitnodiging tot aan- of verkoop van financiële instrumenten.
      Prognoses en analyses zijn gebaseerd op publiek beschikbare marktdata en AI-modeluitkomsten. Raadpleeg een erkend beleggingsadviseur voor persoonlijk advies.
      Verleden rendementen bieden geen garantie voor toekomstige resultaten. © DeAnalist ${jaar}
    </div>
    <div class="rp-footer-logo">De<span>Analist</span></div>
  </div>

</div>
</body>
</html>`;
}

// ─── Prompt builders ──────────────────────────────────────────────────────────

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
  "intro": "Twee zinnen die de essentie van het rapport samenvatten — geschikt als preview op een kaart (max 240 tekens)",
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
  "intro": "Twee zinnen die de essentie samenvatten als preview (max 240 tekens)",
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
TAAK: Schrijf een Deep-Dive Strategic Research rapport — grondig thematisch onderzoek op basis van de huidige marktomstandigheden.
Kies ZELF het meest relevante thema gezien de live marktdata.

JSON-formaat:
{
  "titel": "Institutionele thematitel — max 14 woorden, specifiek en prikkelend",
  "conclusie": "De centrale these in één krachtige zin",
  "intro": "Twee zinnen die het thema en de kernboodschap samenvatten als preview (max 240 tekens)",
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

// ─── Duplicate guard ──────────────────────────────────────────────────────────

async function rapportBestaatAl(type, datumISO, token) {
    try {
        const { blobs } = await list({
            prefix: `strategie-rapporten/${type}/${datumISO}`,
            token,
        });
        return blobs.some(b => b.pathname.endsWith('.json'));
    } catch { return false; }
}

// ─── Main handler ─────────────────────────────────────────────────────────────

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();

    const type = (req.query.type || req.body?.type || 'daily').toLowerCase();
    if (!['daily', 'weekly', 'deep'].includes(type)) {
        return res.status(400).json({ error: 'Ongeldig type. Gebruik: daily, weekly, deep.' });
    }

    const geminiKey = process.env.GEMINI_API_KEY;
    const groqKey   = process.env.GROQ_API_KEY;
    const blobToken = process.env.BLOB_READ_WRITE_TOKEN;

    if (!geminiKey) return res.status(500).json({ error: 'GEMINI_API_KEY ontbreekt.' });
    if (!blobToken) return res.status(500).json({ error: 'BLOB_READ_WRITE_TOKEN ontbreekt.' });

    // ── Datum in Belgische tijd ──
    const now      = new Date();
    const datumISO = now.toLocaleDateString('sv-SE', { timeZone: 'Europe/Brussels' });
    const datum    = now.toLocaleDateString('nl-NL', {
        timeZone: 'Europe/Brussels',
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    });

    try {
        // ── Duplicate guard — niet twee keer per dag genereren ──
        const forceRegen = req.query.force === '1' || req.body?.force === true;
        if (!forceRegen) {
            const bestaat = await rapportBestaatAl(type, datumISO, blobToken);
            if (bestaat) {
                return res.status(200).json({
                    success: true, skipped: true,
                    message: `Rapport ${type} voor ${datumISO} bestaat al.`,
                });
            }
        }

        // ── Marktdata ophalen ──
        const markt    = await fetchMarktdata();
        const marktStr = JSON.stringify(markt, null, 2);

        // ── AI-generatie (Gemini 3.5 Flash → Groq fallback) ──
        const { text, provider } = await callAI(
            buildPrompt(type, marktStr, datum),
            { geminiKey, groqKey }
        );
        const parsed = parseJsonResponse(text);

        // ── HTML samenstellen ──
        const strip       = marktStripHtml(markt);
        const sectiesHtml = sectiesToHtml(parsed.secties || []);
        const pdfHtml     = buildPdfHtml(type, {
            titel:      parsed.titel,
            conclusie:  parsed.conclusie,
            secties:    sectiesHtml,
            marktstrip: strip,
        }, datum);

        // ── Metadata object ──
        const meta = {
            type,
            titel:      parsed.titel,
            conclusie:  parsed.conclusie,
            datum,
            datumISO,
            aangemaakt: new Date().toISOString(),
            provider,
            intro: (parsed.intro || parsed.secties?.[0]?.inhoud || '').slice(0, 240).trim() + '…',
        };

        const metaPath = `strategie-rapporten/${type}/${datumISO}.json`;
        const htmlPath = `strategie-rapporten/${type}/${datumISO}.html`;

        // ── Opslaan in Blob ──
        await put(htmlPath, pdfHtml, {
            access: 'public', token: blobToken,
            addRandomSuffix: false, contentType: 'text/html',
        });
        await put(metaPath, JSON.stringify(meta, null, 2), {
            access: 'public', token: blobToken,
            addRandomSuffix: false, contentType: 'application/json',
        });

        return res.status(200).json({ success: true, type, datum, titel: parsed.titel, provider });

    } catch (err) {
        console.error('[generate-report]', err);
        return res.status(500).json({ error: `Generatie mislukt: ${err.message}` });
    }
}
