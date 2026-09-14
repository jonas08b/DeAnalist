// api/strategy.js — Marktregime v2.0 | Rule-based scoring engine + AI narratief
// ─────────────────────────────────────────────────────────────────────────────
// ARCHITECTUUR:
//   Scores  → 100% deterministisch via piecewise lineaire interpolatie (0–100)
//   Gewichten → hardcoded per factor en per sub-indicator (auditeerbaar)
//   AI      → uitsluitend narratief: toelichtingen, strategy note, scenario's
//   Data    → Yahoo Finance Chart API, range=3mo voor historische berekeningen
//
// FACTOREN & GEWICHTEN:
//   Macro & Groei          25%  (copper/gold, russell/SP, DXY, olie)
//   Monetair Beleid        25%  (yield curve, rate level, rate momentum, Bund)
//   Kredietmarkt           20%  (HYG, LQD, HYG/SPY rel, HY/IG ratio)
//   Marktmomentum          15%  (SP vs SMA20, VIX niveau, 5d momentum, Nasdaq lead)
//   Risico & Positionering 15%  (VIX trend, gold/SP, defensief vs cyclisch, energie)

import { callAI, parseJsonResponse } from './_ai-helper.js';
import { put, head }                  from '@vercel/blob';

const YF_BASE   = 'https://query1.finance.yahoo.com';
const YF_BASE_2 = 'https://query2.finance.yahoo.com';
const HEADERS   = { 'User-Agent': 'Mozilla/5.0 (compatible; DeAnalist/1.0)' };

// ═══════════════════════════════════════════════════════════════════════════════
// CACHE
// ═══════════════════════════════════════════════════════════════════════════════

function cacheKey(thema) {
    const d    = new Date().toISOString().slice(0, 10);
    const slug = thema ? `-${thema.replace(/[^a-z0-9]/gi, '_').toLowerCase()}` : '';
    return `strategie-cache/regime-v2-${d}${slug}.json`;
}

async function readCache(token, thema) {
    try {
        const blob = await head(cacheKey(thema), { token });
        if (!blob?.url) return null;
        const res  = await fetch(blob.url);
        return res.ok ? await res.json() : null;
    } catch { return null; }
}

async function writeCache(data, token, thema) {
    try {
        await put(cacheKey(thema), JSON.stringify(data), {
            access: 'public', token,
            addRandomSuffix: false,
            contentType: 'application/json',
        });
    } catch (e) { console.warn('[strategy] Cache schrijven mislukt:', e.message); }
}

/**
 * Haalt de regimeScores op uit de afgelopen N dagen (excl. vandaag) voor smoothing.
 * Leest de cache-keys van de vorige 4 kalenderdagen.
 * Retourneert array van beschikbare scores (kan leeg zijn bij koude start).
 */
async function readRecentScores(token, thema, n = 4) {
    if (!token) return [];
    const scores = [];
    for (let i = 1; i <= n; i++) {
        try {
            const d    = new Date();
            d.setDate(d.getDate() - i);
            const dag  = d.toISOString().slice(0, 10);
            const slug = thema ? `-${thema.replace(/[^a-z0-9]/gi, '_').toLowerCase()}` : '';
            const key  = `strategie-cache/regime-v2-${dag}${slug}.json`;
            const blob = await head(key, { token });
            if (!blob?.url) continue;
            const res  = await fetch(blob.url);
            if (!res.ok) continue;
            const obj  = await res.json();
            if (typeof obj?.regimeScore === 'number') scores.push(obj.regimeScore);
        } catch { /* dag niet in cache — overslaan */ }
    }
    return scores;
}

/**
 * Berekent het smoothed regime op basis van vandaag + historische scores.
 * Vandaag weegt dubbel om responsiviteit te bewaren bij echte trendbreuken.
 * Bij te weinig history (<2 dagen) wordt de ruwe score gebruikt.
 */
function smoothRegime(todayScore, historicScores) {
    if (!historicScores.length) return { smoothedScore: todayScore, smoothed: false };
    const all    = [todayScore, todayScore, ...historicScores]; // vandaag 2x gewicht
    const avg    = Math.round(all.reduce((a, b) => a + b, 0) / all.length);
    return { smoothedScore: avg, smoothed: true };
}

// ═══════════════════════════════════════════════════════════════════════════════
// DATA FETCHING — 3 maanden dagsluiting voor alle tickers
// ═══════════════════════════════════════════════════════════════════════════════

async function fetchHistory(symbol) {
    for (const base of [YF_BASE, YF_BASE_2]) {
        try {
            const url = `${base}/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=3mo`;
            const res  = await fetch(url, { headers: HEADERS });
            if (!res.ok) continue;
            const data   = await res.json();
            const result = data?.chart?.result?.[0];
            if (!result) continue;

            const meta   = result.meta;
            const rawC   = result.indicators?.quote?.[0]?.close ?? [];
            const closes = rawC.filter(c => c !== null && c !== undefined);
            if (!closes.length) continue;

            const price  = meta.regularMarketPrice ?? closes.at(-1);
            const prev   = meta.previousClose ?? meta.chartPreviousClose ?? closes.at(-2) ?? price;
            const chgPct = prev ? ((price - prev) / prev) * 100 : 0;

            return { symbol, price, prev, chgPct, closes, name: meta.shortName || symbol };
        } catch { continue; }
    }
    return null;
}

async function fetchAllData() {
    const symbols = {
        // Aandelenmarkten
        sp500:    '^GSPC',    // S&P 500
        nasdaq:   '^IXIC',   // Nasdaq Composite
        russell:  '^RUT',    // Russell 2000 — small cap risico-barometer
        spy:      'SPY',     // S&P 500 ETF — voor credit/equity ratio's
        // Volatiliteit
        vix:      '^VIX',    // CBOE Volatility Index
        // Amerikaanse rentes
        yield10y: '^TNX',    // 10Y UST yield
        yield3m:  '^IRX',    // 3M T-bill — beleidsrente proxy
        // Europese rente
        bund:     'GDBR10=X', // 10Y Bund (best-effort; null-safe)
        // FX & Grondstoffen
        dxy:      'DX-Y.NYB', // US Dollar Index
        oil:      'CL=F',     // WTI Crude
        gold:     'GC=F',     // Goud
        copper:   'HG=F',     // Koper — beste market-based groeiproxy
        // Credit
        hyg:      'HYG',      // iShares HY Corporate Bond ETF
        lqd:      'LQD',      // iShares IG Corporate Bond ETF
        // Sectoren
        xlk:      'XLK',      // Tech (cyclisch)
        xlf:      'XLF',      // Financials (cyclisch)
        xle:      'XLE',      // Energy
        xlu:      'XLU',      // Utilities (defensief)
        xlv:      'XLV',      // Healthcare (defensief)
    };

    const entries = await Promise.all(
        Object.entries(symbols).map(async ([key, sym]) => [key, await fetchHistory(sym)])
    );
    return Object.fromEntries(entries.filter(([, v]) => v !== null));
}

// ═══════════════════════════════════════════════════════════════════════════════
// SCORING ENGINE — Deterministisch, 0–100
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Piecewise lineaire interpolatie.
 * @param {number} value  - Input waarde
 * @param {number[][]} pts - [[x, score], ...] gesorteerd op x, scores 0–100
 * @returns {number|null}
 */
function pw(value, pts) {
    if (value === null || value === undefined || isNaN(value)) return null;
    if (value <= pts[0][0])    return pts[0][1];
    if (value >= pts.at(-1)[0]) return pts.at(-1)[1];
    for (let i = 0; i < pts.length - 1; i++) {
        const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
        if (value >= x0 && value <= x1)
            return Math.round(y0 + (y1 - y0) * (value - x0) / (x1 - x0));
    }
    return 50;
}

/** N-daags rendement uit close-array. */
function ret(closes, n) {
    if (!closes || closes.length < n + 1) return null;
    const now = closes.at(-1), then = closes.at(-(n + 1));
    return then ? (now - then) / then : null;
}

/** Simple Moving Average. */
function sma(closes, n) {
    if (!closes || closes.length < n) return null;
    return closes.slice(-n).reduce((a, b) => a + b, 0) / n;
}

/** Relatieve performance a vs b over n dagen (return_a - return_b). */
function rel(a, b, n) {
    const ra = ret(a?.closes, n), rb = ret(b?.closes, n);
    return ra !== null && rb !== null ? ra - rb : null;
}

/**
 * Gewogen gemiddelde — null-waarden worden overgeslagen (gewichten herverdeeld).
 * @param {(number|null)[]} scores
 * @param {number[]} weights
 * @returns {number} - Afgerond op geheel getal
 */
function wavg(scores, weights) {
    let wSum = 0, wTot = 0;
    scores.forEach((s, i) => {
        if (s !== null && s !== undefined && !isNaN(s)) {
            wSum += s * weights[i];
            wTot += weights[i];
        }
    });
    return wTot > 0 ? Math.round(wSum / wTot) : 50;
}

// ─── SUB-INDICATOR FUNCTIES ─────────────────────────────────────────────────
// Elke functie neemt het markt-object (m) en geeft 0–100 of null terug.

// ── 1. MACRO & GROEI ────────────────────────────────────────────────────────
// Koper/Goud ratio 20d: stijgende ratio = groei-optimisme (leading indicator)
function s_copperGold(m) {
    return pw(rel(m.copper, m.gold, 20), [
        [-0.15, 10], [-0.08, 25], [-0.04, 38], [0, 48], [0.04, 60], [0.08, 73], [0.15, 87],
    ]);
}
// Russell 2000 vs S&P 500 20d: small caps outperformen = binnenlandse groei
function s_russellSP(m) {
    return pw(rel(m.russell, m.sp500, 20), [
        [-0.08, 18], [-0.04, 30], [-0.02, 42], [0, 50], [0.02, 60], [0.04, 70], [0.08, 83],
    ]);
}
// DXY 20d trend: stijgende dollar = krappere global financial conditions
function s_dxyTrend(m) {
    return pw(ret(m.dxy?.closes, 20), [
        [-0.05, 80], [-0.03, 68], [-0.01, 57], [0.01, 50], [0.03, 38], [0.05, 26], [0.08, 14],
    ]);
}
// WTI olie 20d: matige stijging = vraag (positief); scherpe stijging = inflatieschok (negatief).
// Monotoon dalend voorbij +8%: geen score-hump die een extreme oliebeweging als neutraal weergeeft.
function s_oilTrend(m) {
    return pw(ret(m.oil?.closes, 20), [
        [-0.20, 22], [-0.10, 34], [-0.05, 44], [0, 52], [0.04, 57], [0.08, 54],
        [0.15, 42], [0.22, 30], [0.30, 18],
    ]);
}

// ── 2. MONETAIR BELEID ──────────────────────────────────────────────────────
// Yield curve: 10Y UST − 3M T-bill spread (in procentpunten)
function s_yieldCurve(m) {
    const spread = (m.yield10y?.price ?? 0) - (m.yield3m?.price ?? 0);
    return pw(spread, [
        [-2.0, 8], [-1.5, 15], [-1.0, 25], [-0.5, 38], [0, 48],
        [0.5, 58], [1.0, 66], [1.5, 74], [2.5, 82],
    ]);
}
// Beleidsrente niveau: hogere 3M T-bill = restrictiever monetair klimaat
function s_rateLevel(m) {
    return pw(m.yield3m?.price, [
        [0, 82], [2, 70], [3, 58], [4, 46], [5, 34], [5.5, 23], [6, 14],
    ]);
}
// 10Y yield 10d momentum: dalende yields = gunstig voor risk assets
function s_rateMom(m) {
    const c = m.yield10y?.closes;
    if (!c || c.length < 11) return null;
    const delta = c.at(-1) - c.at(-11); // in procentpunten (bv. 0.20 = +20 bps)
    return pw(delta, [
        [-0.50, 84], [-0.25, 71], [-0.10, 61], [0, 52], [0.10, 42], [0.25, 29], [0.50, 17],
    ]);
}
// Bund 10Y 10d trend: Europese monetaire condities
function s_bundTrend(m) {
    const c = m.bund?.closes;
    if (!c || c.length < 11) return null;
    const delta = c.at(-1) - c.at(-11);
    return pw(delta, [
        [-0.40, 76], [-0.20, 63], [-0.05, 54], [0.05, 48], [0.20, 36], [0.40, 23],
    ]);
}

// ── 3. KREDIETMARKT ─────────────────────────────────────────────────────────
// HYG 20d momentum: stijgend = krimpende HY spreads = risicobereidheid
function s_hygMom(m) {
    return pw(ret(m.hyg?.closes, 20), [
        [-0.06, 10], [-0.04, 22], [-0.02, 36], [0, 48], [0.02, 61], [0.04, 74], [0.06, 87],
    ]);
}
// LQD 20d momentum: investment grade credit richting
function s_lqdMom(m) {
    return pw(ret(m.lqd?.closes, 20), [
        [-0.04, 14], [-0.02, 30], [-0.01, 42], [0, 50], [0.01, 60], [0.02, 71], [0.04, 83],
    ]);
}
// HYG vs SPY 20d: credit marcheert mee met equities = gezond; divergentie = waarschuwing
function s_hygVsSPY(m) {
    return pw(rel(m.hyg, m.spy, 20), [
        [-0.06, 17], [-0.04, 28], [-0.02, 40], [0, 50], [0.02, 62], [0.04, 74], [0.06, 86],
    ]);
}
// HY/IG ratio 20d: rising ratio = risk appetite in credit (voorkeur HY boven IG)
function s_hygOverLqd(m) {
    return pw(rel(m.hyg, m.lqd, 20), [
        [-0.04, 20], [-0.02, 33], [-0.01, 43], [0, 50], [0.01, 58], [0.02, 68], [0.04, 81],
    ]);
}

// ── 4. MARKTMOMENTUM ────────────────────────────────────────────────────────
// S&P 500 afwijking van 20d SMA: trend-kracht indicator
function s_spVsSMA20(m) {
    const c = m.sp500?.closes;
    const s = sma(c, 20);
    return s ? pw((c.at(-1) - s) / s, [
        [-0.08, 9], [-0.05, 22], [-0.02, 37], [0, 50], [0.02, 63], [0.05, 76], [0.08, 89],
    ]) : null;
}
// VIX niveau: angst-barometer (inverser: lager VIX = hoger score)
function s_vixLevel(m) {
    return pw(m.vix?.price, [
        [10, 93], [14, 78], [18, 60], [22, 42], [26, 26], [32, 12], [40, 4],
    ]);
}
// S&P 500 5d rendement: korte-termijn momentum
function s_sp5dMom(m) {
    return pw(ret(m.sp500?.closes, 5), [
        [-0.06, 11], [-0.03, 27], [-0.01, 42], [0.01, 58], [0.03, 73], [0.06, 89],
    ]);
}
// Nasdaq vs S&P 500 20d: tech-leadership = risk-on signaal
function s_nasdaqLead(m) {
    return pw(rel(m.nasdaq, m.sp500, 20), [
        [-0.06, 19], [-0.03, 32], [-0.01, 44], [0.01, 56], [0.03, 68], [0.06, 81],
    ]);
}

// ── 5. RISICO & POSITIONERING ───────────────────────────────────────────────
// VIX 10d trend: stijgende VIX = toenemende angst = bearish
function s_vixTrend(m) {
    return pw(ret(m.vix?.closes, 10), [
        [-0.35, 86], [-0.20, 73], [-0.10, 62], [-0.05, 55], [0.05, 46], [0.15, 34], [0.30, 21], [0.50, 9],
    ]);
}
// Goud vs S&P 500 20d: goud outperformt = vlucht naar veiligheid = bearish
function s_goldVsSP(m) {
    return pw(rel(m.gold, m.sp500, 20), [
        [-0.08, 76], [-0.04, 65], [-0.02, 57], [0, 50], [0.02, 42], [0.04, 32], [0.08, 17],
    ]);
}
// Defensief (XLU + XLV) vs Cyclisch (XLK + XLF) 20d: sector-rotatie signaal
function s_defVsCycl(m) {
    const defR = [ret(m.xlu?.closes, 20), ret(m.xlv?.closes, 20)].filter(r => r !== null);
    const cycR = [ret(m.xlk?.closes, 20), ret(m.xlf?.closes, 20)].filter(r => r !== null);
    if (!defR.length || !cycR.length) return null;
    const diff = defR.reduce((a, b) => a + b, 0) / defR.length
               - cycR.reduce((a, b) => a + b, 0) / cycR.length;
    return pw(diff, [
        [-0.08, 83], [-0.04, 71], [-0.02, 60], [0, 50], [0.02, 38], [0.04, 26], [0.08, 13],
    ]);
}
// XLE vs SPY 20d: extreme energie-outperformance = inflatieschok = bearish
function s_energySignal(m) {
    return pw(rel(m.xle, m.spy, 20), [
        [-0.10, 53], [-0.05, 51], [0, 50], [0.05, 46], [0.10, 40], [0.15, 31],
    ]);
}

// ─── FACTOR AGGREGATIE & REGIME CLASSIFICATIE ─────────────────────────────

function computeScoring(m) {
    // Sub-indicatoren per factor
    const subMacro    = [s_copperGold(m), s_russellSP(m), s_dxyTrend(m), s_oilTrend(m)];
    const subMonetair = [s_yieldCurve(m), s_rateLevel(m), s_rateMom(m),  s_bundTrend(m)];
    const subKrediet  = [s_hygMom(m),     s_lqdMom(m),    s_hygVsSPY(m), s_hygOverLqd(m)];
    const subMomentum = [s_spVsSMA20(m),  s_vixLevel(m),  s_sp5dMom(m),  s_nasdaqLead(m)];
    const subRisico   = [s_vixTrend(m),   s_goldVsSP(m),  s_defVsCycl(m), s_energySignal(m)];

    // Gewichten per sub-indicator (binnen elke factor).
    // VIX-niveau (Momentum) en VIX-trend (Risico) zijn bewust teruggeschroefd
    // om dubbeltelling te dempen bij extreme volatiliteitspieken.
    // Gewicht is herverdeeld naar respectievelijk Nasdaq-leadership en Sector-rotatie.
    const wMacro    = [0.35, 0.30, 0.25, 0.10];
    const wMonetair = [0.40, 0.25, 0.25, 0.10];
    const wKrediet  = [0.35, 0.25, 0.25, 0.15];
    const wMomentum = [0.35, 0.22, 0.20, 0.23]; // VIX niveau: 0.30→0.22; Nasdaq lead: 0.15→0.23
    const wRisico   = [0.22, 0.25, 0.35, 0.18]; // VIX trend: 0.30→0.22; Defensief/Cycl: 0.25→0.35

    const macro    = wavg(subMacro,    wMacro);
    const monetair = wavg(subMonetair, wMonetair);
    const krediet  = wavg(subKrediet,  wKrediet);
    const momentum = wavg(subMomentum, wMomentum);
    const risico   = wavg(subRisico,   wRisico);

    // Regime score: gewogen gemiddelde van de 5 factoren
    const regimeScore = wavg(
        [macro, monetair, krediet, momentum, risico],
        [0.25,  0.25,     0.20,    0.15,     0.15]
    );

    const regime   = regimeScore >= 60 ? 'Offensief' : regimeScore <= 40 ? 'Defensief' : 'Neutraal';
    const richting = s => s >= 60 ? 'positief' : s <= 40 ? 'negatief' : 'neutraal';

    // Spread voor toelichting
    const spread10y3m = ((m.yield10y?.price ?? 0) - (m.yield3m?.price ?? 0)).toFixed(2);
    const sma20sp     = sma(m.sp500?.closes, 20);
    const spDevPct    = sma20sp ? (((m.sp500?.price ?? 0) - sma20sp) / sma20sp * 100).toFixed(1) : null;

    return {
        regimeScore,
        regime,
        spread10y3m,
        spDevPct,
        indicators: [
            {
                naam: 'Macro & Groei', score: macro, richting: richting(macro), gewicht: 25,
                subs: { 'Koper/Goud ratio (20d)': subMacro[0], 'Russell vs S&P 500 (20d)': subMacro[1], 'DXY trend (20d)': subMacro[2], 'Olie momentum (20d)': subMacro[3] },
            },
            {
                naam: 'Monetair Beleid', score: monetair, richting: richting(monetair), gewicht: 25,
                subs: { 'Yield curve 10Y-3M': subMonetair[0], 'Beleidsrente niveau (3M)': subMonetair[1], '10Y yield momentum (10d)': subMonetair[2], 'Bund trend (10d)': subMonetair[3] },
                spread10y3m,
            },
            {
                naam: 'Kredietmarkt', score: krediet, richting: richting(krediet), gewicht: 20,
                subs: { 'HYG momentum (20d)': subKrediet[0], 'LQD momentum (20d)': subKrediet[1], 'HYG vs SPY rel. (20d)': subKrediet[2], 'HY/IG ratio (20d)': subKrediet[3] },
            },
            {
                naam: 'Marktmomentum', score: momentum, richting: richting(momentum), gewicht: 15,
                subs: { 'S&P vs SMA20': subMomentum[0], 'VIX niveau': subMomentum[1], 'S&P 5d momentum': subMomentum[2], 'Nasdaq leadership (20d)': subMomentum[3] },
                spDevPct,
            },
            {
                naam: 'Risico & Positionering', score: risico, richting: richting(risico), gewicht: 15,
                subs: { 'VIX trend (10d)': subRisico[0], 'Goud vs S&P (20d)': subRisico[1], 'Defensief vs Cyclisch (20d)': subRisico[2], 'Energie vs SPY (20d)': subRisico[3] },
            },
        ],
    };
}

// ═══════════════════════════════════════════════════════════════════════════════
// AI PROMPT — Uitsluitend narratief; scores worden niet gegenereerd door AI
// ═══════════════════════════════════════════════════════════════════════════════

function buildAIPrompt(scoring, m, thema) {
    const { regimeScore, regime, spread10y3m, spDevPct, indicators } = scoring;

    // Bouw een compact data-context voor de AI
    const dataCtx = {
        regime: `${regime} (score ${regimeScore}/100)`,
        factoren: indicators.map(i =>
            `${i.naam}: ${i.score}/100 (${i.richting}) | gewicht ${i.gewicht}% | subs: ${JSON.stringify(i.subs)}`
        ).join('\n'),
        markt: {
            sp500:    `${m.sp500?.price?.toFixed(2)} (${m.sp500?.chgPct?.toFixed(2)}% dag, ${spDevPct !== null ? spDevPct + '% vs SMA20' : 'SMA N/B'})`,
            nasdaq:   `${m.nasdaq?.price?.toFixed(2)} (${m.nasdaq?.chgPct?.toFixed(2)}% dag)`,
            russell:  `${m.russell?.price?.toFixed(2)} (${m.russell?.chgPct?.toFixed(2)}% dag)`,
            vix:      `${m.vix?.price?.toFixed(2)} (10d trend: ${ret(m.vix?.closes, 10) !== null ? (ret(m.vix?.closes, 10) * 100).toFixed(1) + '%' : 'N/B'})`,
            yieldCurve: `10Y=${m.yield10y?.price?.toFixed(2)}% | 3M=${m.yield3m?.price?.toFixed(2)}% | spread=${spread10y3m}pp`,
            hyg:      `${m.hyg?.price?.toFixed(2)} (20d: ${ret(m.hyg?.closes, 20) !== null ? (ret(m.hyg?.closes, 20) * 100).toFixed(1) + '%' : 'N/B'})`,
            lqd:      `${m.lqd?.price?.toFixed(2)} (20d: ${ret(m.lqd?.closes, 20) !== null ? (ret(m.lqd?.closes, 20) * 100).toFixed(1) + '%' : 'N/B'})`,
            copper:   `${m.copper?.price?.toFixed(2)} (cu/au 20d rel: ${rel(m.copper, m.gold, 20) !== null ? (rel(m.copper, m.gold, 20) * 100).toFixed(1) + '%' : 'N/B'})`,
            dxy:      `${m.dxy?.price?.toFixed(2)} (20d: ${ret(m.dxy?.closes, 20) !== null ? (ret(m.dxy?.closes, 20) * 100).toFixed(1) + '%' : 'N/B'})`,
            gold:     `${m.gold?.price?.toFixed(2)} (goud vs S&P 20d rel: ${rel(m.gold, m.sp500, 20) !== null ? (rel(m.gold, m.sp500, 20) * 100).toFixed(1) + '%' : 'N/B'})`,
            oil:      `${m.oil?.price?.toFixed(2)} (20d: ${ret(m.oil?.closes, 20) !== null ? (ret(m.oil?.closes, 20) * 100).toFixed(1) + '%' : 'N/B'})`,
            bund:     m.bund ? `${m.bund.price?.toFixed(2)}%` : 'N/B',
        },
    };

    const themaFocus = thema
        ? `\nFOCUS THEMA: ${thema} — verdiep de analyse specifiek in dit thema.`
        : '';

    const vandaag = new Date().toLocaleDateString('nl-NL', { day: 'numeric', month: 'long', year: 'numeric' });

    return `Je bent senior macro-strateeg (BCA Research / Gavekal niveau). Schrijf UITSLUITEND in het NEDERLANDS.${themaFocus}

DE SCORES ZIJN DETERMINISTISCH BEREKEND — pas GEEN cijfers aan. Schrijf uitsluitend de narrative analyse.
Toon: institutioneel, opiniërend, contrariaans waar de data dit rechtvaardigt. Geen retail-taal.

BEREKEND REGIME: ${dataCtx.regime}
FACTORSCORES:
${dataCtx.factoren}

RUWE MARKTDATA:
${JSON.stringify(dataCtx.markt, null, 2)}

STRIKTE EISEN:
- Toelichting per factor: ÉÉN zin. Noem het dominante sub-indicator cijfer + forward implicatie (geen verleden).
- Visie: opiniërend, concrete niveaus (S&P support/weerstand, VIX drempel, spread niveau), historische context.
- Scenario's: kansen optellen tot exact 100%. Triggers en niveaus zijn concreet.
- Geen open deuren, geen "de markt zal volatiel zijn".
- Datum: ${vandaag}

Geef antwoord UITSLUITEND als geldig JSON (geen markdown, geen backticks buiten de JSON):
{
  "toelichtingen": {
    "macro":    "één zin: welk sub-indicator domineert + forward implicatie 2-4 weken",
    "monetair": "één zin: yield curve spread ${spread10y3m}pp → specifiek forward signaal",
    "krediet":  "één zin: HYG/LQD dynamiek → concreet credit risk appetite signaal",
    "momentum": "één zin: S&P ${spDevPct !== null ? spDevPct + '% vs SMA20' : ''}, VIX ${m.vix?.price?.toFixed(0)} → richting + niveau",
    "risico":   "één zin: dominant risicosignaal uit VIX trend/gold/sector rotation + implicatie"
  },
  "visie": {
    "tag": "Strategy Note",
    "titel": "max 12 woorden, prikkelend, geen clichés, geen 'de markt'",
    "conclusie": "één directionale zin: concreet niveau + timeframe + catalyst",
    "tekst": "twee alinea's. §1: forward implicaties met concrete niveaus + historische context ('eerste keer sinds...'). §2: specifieke mispricing die consensus negeert + concrete aanbeveling met entry zone en conditie.",
    "datum": "${vandaag}"
  },
  "scenarios": [
    { "label": "Bull Case", "kans": 30, "trigger": "concreet niveau of event dat dit activeert", "implicatie": "koersdoel + timeframe + sector positionering" },
    { "label": "Base Case", "kans": 50, "trigger": "concreet pad dat moet aanhouden",           "implicatie": "verwachte range + aanbevolen positionering" },
    { "label": "Bear Case", "kans": 20, "trigger": "concreet niveau of event dat dit activeert", "implicatie": "neerwaarts niveau + defensieve assets" }
  ],
  "kernrisicos": [
    { "titel": "korte naam", "richting": "neerwaarts", "toelichting": "Trigger: [concreet]. Niveau: [concreet]. Precedent: [historisch]." },
    { "titel": "korte naam", "richting": "opwaarts",   "toelichting": "Trigger: [concreet]. Niveau: [concreet]. Precedent: [historisch]." },
    { "titel": "korte naam", "richting": "neerwaarts", "toelichting": "Trigger: [concreet]. Niveau: [concreet]. Precedent: [historisch]." }
  ],
  "positioning": {
    "aanbeveling": "Long/Short/Neutraal [asset of sector] — één directe zin",
    "entryZone":   "concreet niveau of conditie voor entry",
    "target":      "concreet koersdoel",
    "horizon":     "timeframe in handelsdagen of weken"
  }
}`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// HANDLER
// ═══════════════════════════════════════════════════════════════════════════════

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
        // ── 1. Cache check ────────────────────────────────────────────────
        if (blobToken) {
            const cached = await readCache(blobToken, thema);
            if (cached) return res.status(200).json({ ...cached, _cached: true });
        }

        // ── 2. Marktdata ophalen (3 maanden history) ──────────────────────
        const m = await fetchAllData();

        // ── 3. Deterministisch scoren ─────────────────────────────────────
        const scoring = computeScoring(m);

        // ── 3b. Regime smoothing (5-daags voortschrijdend) ────────────────
        // Dempt dagelijkse regime-flips zonder responsiviteit op echte trendbreuken te verliezen.
        const historicScores              = await readRecentScores(blobToken, thema);
        const { smoothedScore, smoothed } = smoothRegime(scoring.regimeScore, historicScores);
        if (smoothed) {
            scoring.rawRegimeScore  = scoring.regimeScore;  // bewaar voor transparantie
            scoring.regimeScore     = smoothedScore;
            scoring.regime          = smoothedScore >= 60 ? 'Offensief'
                                    : smoothedScore <= 40 ? 'Defensief' : 'Neutraal';
        }

        // ── 4. AI: uitsluitend narratief ──────────────────────────────────
        const prompt = buildAIPrompt(scoring, m, thema);
        const { text, provider } = await callAI(prompt, { geminiKey, groqKey });
        const aiData = parseJsonResponse(text);

        // Voeg AI-toelichtingen toe aan indicators (scores blijven deterministisch)
        const toelichtingMap = {
            'Macro & Groei':          aiData.toelichtingen?.macro    ?? '',
            'Monetair Beleid':        aiData.toelichtingen?.monetair ?? '',
            'Kredietmarkt':           aiData.toelichtingen?.krediet  ?? '',
            'Marktmomentum':          aiData.toelichtingen?.momentum ?? '',
            'Risico & Positionering': aiData.toelichtingen?.risico   ?? '',
        };

        const indicatorsMetToelichting = scoring.indicators.map(ind => ({
            ...ind,
            toelichting: toelichtingMap[ind.naam] ?? '',
        }));

        // ── 5. Marktdata voor top-strip ───────────────────────────────────
        const marktdata = {
            sp500:    { prijs: +(m.sp500?.price?.toFixed(2)    ?? 0), changePct: +(m.sp500?.chgPct?.toFixed(2)    ?? 0) },
            nasdaq:   { prijs: +(m.nasdaq?.price?.toFixed(2)   ?? 0), changePct: +(m.nasdaq?.chgPct?.toFixed(2)   ?? 0) },
            vix:      { waarde: +(m.vix?.price?.toFixed(2)     ?? 0), changePct: +(m.vix?.chgPct?.toFixed(2)      ?? 0) },
            yield10y: { waarde: +(m.yield10y?.price?.toFixed(2)?? 0), changePct: +(m.yield10y?.chgPct?.toFixed(2) ?? 0) },
            bund:     { waarde: m.bund ? +(m.bund.price?.toFixed(2)) : null, changePct: m.bund ? +(m.bund.chgPct?.toFixed(2)) : null },
            dxy:      { waarde: +(m.dxy?.price?.toFixed(2)     ?? 0), changePct: +(m.dxy?.chgPct?.toFixed(2)      ?? 0) },
            oil:      { waarde: +(m.oil?.price?.toFixed(2)     ?? 0), changePct: +(m.oil?.chgPct?.toFixed(2)      ?? 0) },
            copper:   { waarde: +(m.copper?.price?.toFixed(2)  ?? 0), changePct: +(m.copper?.chgPct?.toFixed(2)   ?? 0) },
        };

        // ── 6. Methodologie-documentatie (voor frontend) ──────────────────
        const bundBeschikbaar = !!m.bund;
        const methodologie = {
            schaal:   '0–100 | 0 = extreem bearish · 50 = neutraal · 100 = extreem bullish',
            regime:   '>60 = Offensief · 40–60 = Neutraal · <40 = Defensief',
            scoring:  '100% deterministisch via piecewise lineaire interpolatie — AI schrijft uitsluitend het narratief, geen scores',
            smoothing: smoothed
                ? `5-daags voortschrijdend gemiddelde actief (ruwe score: ${scoring.rawRegimeScore}, smoothed: ${scoring.regimeScore})`
                : 'Onvoldoende geschiedenis — ruwe score gebruikt (smoothing actief vanaf dag 2)',
            gewichten: {
                'Macro & Groei':          '25%',
                'Monetair Beleid':        '25%',
                'Kredietmarkt':           '20%',
                'Marktmomentum':          '15%',
                'Risico & Positionering': '15%',
            },
            subIndicatoren: {
                'Macro & Groei':          'Koper/Goud ratio 35% · Russell vs S&P 30% · DXY trend 25% · Olie momentum 10%',
                'Monetair Beleid':        `Yield curve 10Y-3M 40% · Beleidsrente niveau 25% · 10Y momentum 25% · Bund trend 10%${bundBeschikbaar ? '' : ' (Bund N/B — gewicht herverdeeld)'}`,
                'Kredietmarkt':           'HYG momentum 35% · LQD momentum 25% · HYG vs SPY 25% · HY/IG ratio 15%',
                'Marktmomentum':          'S&P vs SMA20 35% · VIX niveau 22% · S&P 5d momentum 20% · Nasdaq lead 23%',
                'Risico & Positionering': 'VIX trend 22% · Goud vs S&P 25% · Defensief/Cyclisch 35% · Energie vs SPY 18%',
            },
            bundBeschikbaar,
        };

        // ── 7. Assembleeer response ───────────────────────────────────────
        const response = {
            regime:          scoring.regime,
            regimeScore:     scoring.regimeScore,
            rawRegimeScore:  scoring.rawRegimeScore ?? scoring.regimeScore,
            regimeSmoothed:  smoothed,
            indicators:      indicatorsMetToelichting,
            visie:        aiData.visie        ?? null,
            scenarios:    aiData.scenarios    ?? [],
            kernrisicos:  aiData.kernrisicos  ?? [],
            positioning:  aiData.positioning  ?? null,
            marktdata,
            methodologie,
            _provider:    provider,
            _thema:       thema || null,
            _cached:      false,
        };

        // ── 8. Cache opslaan ──────────────────────────────────────────────
        if (blobToken) await writeCache(response, blobToken, thema);

        return res.status(200).json(response);

    } catch (err) {
        console.error('[strategy]', err);
        return res.status(500).json({ error: `Strategie-analyse mislukt: ${err.message}` });
    }
}
