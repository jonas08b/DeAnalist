// /api/ai.js — Vercel Serverless Function
// Genereert AI-analyse via Deepseek (primair), Groq (secundair), Claude Haiku (fallback)

const DEEPSEEK_BASE = 'https://api.deepseek.com/v1';
const GROQ_BASE     = 'https://api.groq.com/openai/v1';
const CLAUDE_BASE   = 'https://api.anthropic.com/v1';

// 402 = no balance, 429 = rate limit — beide reden om naar volgende provider te gaan
const SKIP_CODES = ['402', '429'];
function shouldFallback(errMsg) {
  return SKIP_CODES.some(c => errMsg.includes(`HTTP ${c}`));
}

const SYSTEM_PROMPT = `You are a senior equity research analyst writing objective, data-driven investment reports in Dutch. Follow the tone and structure of a sell-side equity research report. Be specific and concise. Avoid vague statements. Base your analysis strictly on the data provided — do not invent figures. Always return valid JSON only, with no markdown formatting, no preamble, and no text outside the JSON object.`;

function buildUserPrompt(financial, peers, ticker, horizon) {
  const q  = financial.quote   || {};
  const p  = financial.profile || {};
  const r  = financial.ratios  || {};
  const km = financial.keyMetrics || {};
  const e  = financial.estimates || {};
  const c  = financial.consensus || {};
  const inc = financial.income || [];

  const incRows = inc.slice(0, 3).reverse().map(y => {
    const rev = y.revenue ? (y.revenue / 1e6).toFixed(0) + 'M' : '—';
    const ni  = y.netIncome ? (y.netIncome / 1e6).toFixed(0) + 'M' : '—';
    const gm  = y.grossProfitRatio ? (y.grossProfitRatio * 100).toFixed(1) + '%' : '—';
    const nm  = y.netIncomeRatio   ? (y.netIncomeRatio   * 100).toFixed(1) + '%' : '—';
    return `  FY${y.calendarYear}: Rev=${rev} | NI=${ni} | GrossMargin=${gm} | NetMargin=${nm}`;
  }).join('\n');

  const peerTable = (peers || []).map(p => {
    const pq = p.quote  || {};
    const pr = p.ratios || {};
    return `  ${p.ticker}: P/E=${pr.peRatioTTM?.toFixed(1)||'—'}x | P/S=${pr.priceToSalesRatioTTM?.toFixed(1)||'—'}x | MktCap=${pq.marketCap ? '$'+(pq.marketCap/1e9).toFixed(1)+'B' : '—'}`;
  }).join('\n');

  const bal = (financial.balance || [])[0] || {};

  // Merge ratios + keyMetrics voor rijkere context
  const peRatio   = r.peRatioTTM          ?? km.peRatioTTM;
  const pegRatio  = r.pegRatioTTM         ?? km.pegRatioTTM;
  const psRatio   = r.priceToSalesRatioTTM ?? km.priceToSalesRatioTTM;
  const evEbitda  = r.enterpriseValueMultipleTTM ?? km.evToEbitdaTTM;
  const roe       = r.returnOnEquityTTM   ?? km.roeTTM;
  const roa       = r.returnOnAssetsTTM   ?? km.roaTTM;
  const de        = r.debtEquityRatioTTM  ?? km.debtToEquityTTM;
  const cr        = r.currentRatioTTM     ?? km.currentRatioTTM;

  return `
Analyze the following company for a ${horizon}-month investment horizon:

Ticker: ${ticker}
Company: ${p.companyName || ticker}
Sector: ${p.sector || '—'}
Industry: ${p.industry || '—'}
Description: ${(p.description || '').slice(0, 400)}

--- PRICE DATA ---
Current Price: $${q.price || '—'} | 52W Range: $${q.yearLow||'—'} – $${q.yearHigh||'—'}
Market Cap: $${q.marketCap ? (q.marketCap/1e9).toFixed(2)+'B' : '—'} | Beta: ${q.beta?.toFixed(2)||'—'}
Day Change: ${q.changesPercentage?.toFixed(2)||'—'}%

--- VALUATION RATIOS (TTM) ---
P/E: ${peRatio?.toFixed(1)||'—'}x | PEG: ${pegRatio?.toFixed(2)||'—'} | P/S: ${psRatio?.toFixed(1)||'—'}x | EV/EBITDA: ${evEbitda?.toFixed(1)||'—'}x
ROE: ${roe ? (roe*100).toFixed(1)+'%' : '—'} | ROA: ${roa ? (roa*100).toFixed(1)+'%' : '—'}

--- FINANCIALS (last 3 fiscal years) ---
${incRows || 'Data niet beschikbaar'}

--- BALANCE SHEET ---
Total Debt: ${bal.totalDebt ? '$'+(bal.totalDebt/1e6).toFixed(0)+'M' : '—'}
Cash & Equivalents: ${bal.cashAndCashEquivalents ? '$'+(bal.cashAndCashEquivalents/1e6).toFixed(0)+'M' : '—'}
Debt/Equity: ${de?.toFixed(2)||'—'} | Current Ratio: ${cr?.toFixed(2)||'—'}

--- FORWARD ESTIMATES (consensus) ---
Revenue FY+1 est.: ${e.estimatedRevenue ? '$'+(e.estimatedRevenue/1e6).toFixed(0)+'M' : '—'}
EPS FY+1 est.: ${e.estimatedEps ? '$'+e.estimatedEps.toFixed(2) : '—'}

--- ANALYST CONSENSUS ---
Rating: ${c.consensusRating||'—'} | Avg Target: $${c.targetConsensus||'—'} | High: $${c.targetHigh||'—'} | Low: $${c.targetLow||'—'}
# Analysts: ${c.numberOfAnalysts||'—'}

--- PEERS ---
${peerTable || 'Geen peer-data beschikbaar'}

Horizon: ${horizon} months

SCORECARD CRITERIA (gebruik EXACT deze schaal):
Growth Rate:     5=Rev>100% YoY | 4=50-100% | 3=20-50% | 2=5-20% | 1=<5% of negatief
Valuation PEG:   5=PEG<0.5 | 4=0.5-1.0 | 3=1.0-2.0 | 2=2.0-3.5 | 1=>3.5
Profitability:   5=NetMargin>30% | 4=15-30% | 3=5-15% | 2=0-5% | 1=verlies
Balance Sheet:   5=D/E<0.1 | 4=0.1-0.3 | 3=0.3-0.6 | 2=0.6-1.0 | 1=>1.0
Market Position: 5=dominant/pricing power | 4=sterke niche | 3=concurrerend | 2=fragiel | 1=commodity
Management:      5=track record+skin in game | 4=bewezen team | 3=adequaat | 2=vraagteken | 1=zwak
Catalyst Pipeline: 5=3+ concrete catalysts <12M | 4=2 catalysts | 3=1 catalyst | 2=onduidelijk | 1=geen
Risk Profile:    5=laag/gediversifieerd | 4=beheersbaar | 3=gemiddeld | 2=hoog | 1=kritiek

Return ONLY valid JSON (no markdown, no preamble):
{
  "executive_summary": "string (3-5 zinnen in het Nederlands, kernthesis + sleutelmetrieken)",
  "investment_thesis": [
    {"title": "string", "body": "string"},
    {"title": "string", "body": "string"},
    {"title": "string", "body": "string"}
  ],
  "financial_analysis": "string (omzettrend, marges, balans, in het Nederlands)",
  "risks": [
    {"level": "HIGH|MEDIUM|LOW", "factor": "string", "description": "string"},
    {"level": "HIGH|MEDIUM|LOW", "factor": "string", "description": "string"},
    {"level": "HIGH|MEDIUM|LOW", "factor": "string", "description": "string"}
  ],
  "conclusion": "string (2-3 zinnen eindoordeel in het Nederlands)",
  "scorecard": {
    "growth_rate":       {"score": 1, "rationale": "string"},
    "valuation_peg":     {"score": 1, "rationale": "string"},
    "profitability":     {"score": 1, "rationale": "string"},
    "balance_sheet":     {"score": 1, "rationale": "string"},
    "market_position":   {"score": 1, "rationale": "string"},
    "management":        {"score": 1, "rationale": "string"},
    "catalyst_pipeline": {"score": 1, "rationale": "string"},
    "risk_profile":      {"score": 1, "rationale": "string"},
    "total": 8
  }
}
`.trim();
}

// ── Provider calls ──────────────────────────────────────────────────────────

async function callDeepseek(prompt, key) {
  const res = await fetch(`${DEEPSEEK_BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
    body: JSON.stringify({
      model: 'deepseek-chat',
      max_tokens: 3000,
      temperature: 0.3,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user',   content: prompt },
      ],
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Deepseek HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content || '';
  return JSON.parse(text.replace(/```json|```/g, '').trim());
}

async function callGroq(prompt, key) {
  const res = await fetch(`${GROQ_BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      max_tokens: 3000,
      temperature: 0.3,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user',   content: prompt },
      ],
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Groq HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content || '';
  return JSON.parse(text.replace(/```json|```/g, '').trim());
}

async function callClaudeHaiku(prompt, key) {
  const res = await fetch(`${CLAUDE_BASE}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 3000,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Claude HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  const text = data.content?.map(b => b.text || '').join('') || '';
  return JSON.parse(text.replace(/```json|```/g, '').trim());
}

// ── Main handler ────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  const deepseekKey = process.env.DEEPSEEK_API_KEY;
  const groqKey     = process.env.GROQ_API_KEY;
  const claudeKey   = process.env.ANTHROPIC_API_KEY;

  if (!deepseekKey && !groqKey && !claudeKey) {
    return res.status(500).json({ error: 'Geen AI API-key geconfigureerd (DEEPSEEK_API_KEY, GROQ_API_KEY of ANTHROPIC_API_KEY)' });
  }

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch {
    return res.status(400).json({ error: 'Ongeldig request body' });
  }

  const { financial, peers, ticker, horizon } = body || {};
  if (!financial || !ticker) {
    return res.status(400).json({ error: 'financial en ticker zijn verplicht' });
  }

  const prompt = buildUserPrompt(financial, peers, ticker, horizon || 12);

  const withTimeout = (promise, ms) =>
    Promise.race([
      promise,
      new Promise((_, rej) => setTimeout(() => rej(new Error('AI timeout na ' + ms/1000 + 's')), ms)),
    ]);

  // Provider chain: Deepseek → Groq → Claude Haiku
  // Fallback bij HTTP 402 (no balance) of 429 (rate limit)
  const providers = [
    deepseekKey && { name: 'Deepseek', call: () => callDeepseek(prompt, deepseekKey) },
    groqKey     && { name: 'Groq',     call: () => callGroq(prompt, groqKey) },
    claudeKey   && { name: 'Claude',   call: () => callClaudeHaiku(prompt, claudeKey) },
  ].filter(Boolean);

  let lastError;
  for (const provider of providers) {
    try {
      console.log(`[ai] Probeer ${provider.name}...`);
      const result = await withTimeout(provider.call(), 30000);

      // Herbereken scorecard total
      if (result.scorecard) {
        const keys = ['growth_rate','valuation_peg','profitability','balance_sheet','market_position','management','catalyst_pipeline','risk_profile'];
        result.scorecard.total = keys.reduce((sum, k) => sum + (result.scorecard[k]?.score || 0), 0);
      }

      console.log(`[ai] Succes via ${provider.name}`);
      return res.status(200).json(result);

    } catch (err) {
      lastError = err;
      if (shouldFallback(err.message)) {
        console.warn(`[ai] ${provider.name} overgeslagen (${err.message.split(':')[1]?.trim()}), volgende provider...`);
        continue;
      }
      // Niet-herstelbare fout (bv. parse error, timeout) — stop meteen
      break;
    }
  }

  console.error('[ai] Alle providers mislukt:', lastError?.message);
  if (lastError?.message?.includes('timeout')) {
    return res.status(504).json({ error: 'AI-analyse duurde te lang. Probeer opnieuw.' });
  }
  res.status(500).json({ error: 'AI-analyse mislukt: ' + (lastError?.message || 'Onbekende fout') });
}
