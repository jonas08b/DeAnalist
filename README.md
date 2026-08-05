# DeAnalist

AI-gedreven equity research tool — onderdeel van het **DeBrief**-ecosysteem.

Typ een ticker → ontvang een volledig analistenrapport in minuten, gratis.

---

## Structuur

```
deanalist/
├── index.html          ← UI: ticker input, rapport weergave, PDF export
├── api/
│   ├── financials.js   ← Vercel function: FMP financiële data
│   ├── peers.js        ← Vercel function: peer-vergelijking (parallel)
│   └── ai.js           ← Vercel function: Deepseek/Claude AI-analyse
├── .env.local          ← API keys (NOOIT in git)
├── .gitignore
├── vercel.json         ← Routing + function timeouts
└── package.json
```

---

## Snelstart (lokaal)

```bash
# 1. Installeer Vercel CLI
npm i -g vercel

# 2. Kopieer env template en vul je keys in
cp .env.local .env.local
# → Bewerk .env.local met je FMP_API_KEY, DEEPSEEK_API_KEY, ANTHROPIC_API_KEY

# 3. Start lokale dev server
vercel dev
# → Open http://localhost:3000
```

---

## Deploy naar Vercel

```bash
vercel deploy --prod
```

Voeg je keys toe via **Vercel Dashboard → Settings → Environment Variables**:

| Variable | Omschrijving | Vereist |
|---|---|---|
| `FMP_API_KEY` | Financial Modeling Prep | ✅ |
| `DEEPSEEK_API_KEY` | Deepseek AI (primair) | ✅ of `ANTHROPIC_API_KEY` |
| `ANTHROPIC_API_KEY` | Claude Haiku (fallback) | optioneel |

---

## Integratie met DeBrief

Voeg in `DeBrief/public/index.html` een tab toe:

```html
<!-- Tab bar -->
<button class="tab" data-tab="analist" onclick="window.location='/deanalist/'">
  <svg viewBox="0 0 24 24">
    <path d="M3 3v18h18"/><polyline points="7 12 12 7 16 11 21 6"/>
  </svg>
</button>
```

Of host DeAnalist op een subdomein: `analist.debrief.be`

---

## Data-bronnen

| Data | Bron | Limiet |
|---|---|---|
| Koers, marktdata, financials | Financial Modeling Prep | 250 req/dag (gratis) |
| Peer-vergelijking | FMP `/stock_peers` + `/quote` | idem |
| AI-analyse | Deepseek V3 | ~€0.01/rapport |
| AI-fallback | Claude Haiku | ~€0.04/rapport |
| PDF-export | html2pdf.js (client-side) | gratis |

**Totale kost:** €0 vast + ~€0.01–0.05 per rapport (AI-tokens).

---

## Caching

- **Client (localStorage):** 4 uur per ticker/horizon-combinatie
- Dezelfde ticker wordt niet opnieuw opgehaald binnen 4 uur
- Cache-indicator toont wanneer een gecached rapport geladen wordt

---

## Rate limiting

- Max **10 rapporten per IP per dag** (server-side, in-memory)
- FMP-daglimiet: 250 requests (1 rapport ≈ 7 calls)
- Bij overschrijding: duidelijke foutmelding in UI

---

*DeAnalist — door Jonas / DeBrief Analytics*  
*v1.0 — Augustus 2026*
