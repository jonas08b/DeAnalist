// api/ai.js — Equity Research rapport generatie
// Primair: Gemini 3.5 Flash  |  Fallback: Groq llama-3.3-70b-versatile

import { callAI, parseJsonResponse } from './_ai-helper.js';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Methode niet toegestaan.' });

    const { kpiData } = req.body;
    if (!kpiData) return res.status(400).json({ error: 'Geen financiële data ontvangen.' });

    const geminiKey = process.env.GEMINI_API_KEY;
    const groqKey   = process.env.GROQ_API_KEY;
    if (!geminiKey) return res.status(500).json({ error: 'GEMINI_API_KEY ontbreekt.' });

    try {
        const dataStr = JSON.stringify(kpiData, null, 2);

        const prompt = `Je bent een senior Equity Research Analyst (CFA-niveau). Analyseer het volgende bedrijf op basis van de aangeleverde marktdata.
Schrijf UITSLUITEND in het NEDERLANDS. Gebruik neutrale, institutionele taal — geen promotionele formuleringen.

REGELS VOOR TAALGEBRUIK:
- Vervang "superieur operationeel profiel" door "bovengemiddelde operationele efficiëntie"
- Vervang "uitmuntende marge" door "nettomarge van X%, significant boven sectorgemiddelde van Y%"
- Vervang "onmisbare rol" door "structureel dominante marktpositie"
- Elk kwalitatief oordeel MOET gevolgd worden door een concreet getal

KRITISCHE KWALITEITSEISEN — VERPLICHT IN ELKE SECTIE:

1. KOERSDOEL VOLLEDIG HERLEIDBAAR
Het eindkoersdoel moet stap voor stap worden afgeleid uit de onderliggende waarderingsmethoden.
Werk dit als volgt uit in het veld koersdoelAfleiding:
- DCF-waarde per aandeel: berekend gewicht en bijdrage
- EV/EBITDA-methode: sectorgemiddelde multiple op EBITDA, min nettoschuld, gedeeld door aandelencount
- P/E-methode: sectorgemiddelde multiple op forward EPS
- Gewogen koersdoel = som van gewogen bijdragen
Elk getal moet reproduceerbaar zijn door de lezer.

2. TERMINALE WAARDE VOLLEDIG UITGEWERKT
Verklaar in terminaleWaarde:
- Gekozen groeivoet g gemotiveerd door verwachte nominale bbp-groei thuisland, sectorgroei langetermijn, en positie van het bedrijf
- Berekening TV = FCF_t+1 / (WACC - g)
- Contante waarde TV met kortingsfactor
- Bridge EV naar Equity: EV minus nettoschuld plus kasoverschot gedeeld door aandelencount
- Aandeel TV in totale EV in procenten

3. PEER-SELECTIE METHODOLOGISCH VERDEDIGBAAR
Selecteer peers op basis van DRIE criteria tegelijk: business-mix, margestructuur (EBIT-marge binnen 5 procentpunt), groeiprofiel (omzetgroei CAGR binnen 3 procentpunt).
Vermeld per peer expliciet aan hoeveel van de drie criteria wordt voldaan.
Sluit peers uit die op slechts een criterium vergelijkbaar zijn, tenzij je onderbouwt waarom ze toch relevant zijn.

4. SCENARIO'S REKENKUNDIG CONSISTENT MET KOERSDOEL
De kansen en koersdoelen van de drie scenario's MOETEN rekenkundig aansluiten op het eindkoersdoel.
Gewogen koersdoel = (Bull-koersdoel x Bull-kans) + (Base-koersdoel x Base-kans) + (Bear-koersdoel x Bear-kans)
Controleer dit zelf en vermeld de rekenkundige check in scenarioCheck.
Pas kansen of koersdoelen aan totdat het gewogen gemiddelde exact overeenkomt met het eindkoersdoel (maximaal 0,50 euro afwijking).

MARKTDATA:
${dataStr}

Geef je antwoord UITSLUITEND als een geldig JSON-object met exact deze structuur. Geen markdown, geen extra tekst:

{
  "subtitel": "Neutrale ondertitel met aanbeveling en tijdshorizon (max 12 woorden)",
  "aanbeveling": "KOOP of HOUD of VERKOOP",
  "tijdshorizon": "12 maanden",

  "koersdoelAfleiding": {
    "dcf": {
      "waardePerAandeel": "€X",
      "gewicht": "X%",
      "bijdrage": "€X"
    },
    "evEbitda": {
      "sectorMultiple": "X.Xx",
      "ebitda": "€Xmrd",
      "enterpriseValue": "€Xmrd",
      "minNettoschuld": "€Xmrd",
      "equityValue": "€Xmrd",
      "aandelenUitstaand": "Xmrd",
      "waardePerAandeel": "€X",
      "gewicht": "X%",
      "bijdrage": "€X"
    },
    "pe": {
      "sectorMultiple": "X.Xx",
      "forwardEps": "€X",
      "waardePerAandeel": "€X",
      "gewicht": "X%",
      "bijdrage": "€X"
    },
    "gewogenKoersdoel": "€X",
    "rekencheck": "(€X x X%) + (€X x X%) + (€X x X%) = €X"
  },

  "financieelOverzicht": {
    "jaren": ["FY2024A", "FY2025A", "FY2026E", "FY2027E"],
    "omzet":      ["€Xmrd", "€Xmrd", "€Xmrd", "€Xmrd"],
    "brutomarge": ["X%", "X%", "X%", "X%"],
    "ebit":       ["€Xmrd", "€Xmrd", "€Xmrd", "€Xmrd"],
    "nettomarge": ["X%", "X%", "X%", "X%"],
    "eps":        ["€X", "€X", "€X", "€X"],
    "dps":        ["€X", "€X", "€X", "€X"],
    "fcf":        ["€Xmrd", "€Xmrd", "€Xmrd", "€Xmrd"],
    "bron": "Consensus Bloomberg/FactSet of eigen model op basis van Yahoo Finance"
  },

  "dcf": {
    "wacc": {
      "risicovrij": "X% (10j staatsobligatie)",
      "beta": "X.XX",
      "marktpremie": "X% (ERP)",
      "schuldenPremie": "X%",
      "totaalWacc": "X%"
    },
    "prognoses": [
      {"jaar": "FY2026E", "omzet": "€Xmrd", "ebitMarge": "X%", "fcf": "€Xmrd", "eps": "€X"},
      {"jaar": "FY2027E", "omzet": "€Xmrd", "ebitMarge": "X%", "fcf": "€Xmrd", "eps": "€X"},
      {"jaar": "FY2028E", "omzet": "€Xmrd", "ebitMarge": "X%", "fcf": "€Xmrd", "eps": "€X"},
      {"jaar": "FY2029E", "omzet": "€Xmrd", "ebitMarge": "X%", "fcf": "€Xmrd", "eps": "€X"},
      {"jaar": "FY2030E", "omzet": "€Xmrd", "ebitMarge": "X%", "fcf": "€Xmrd", "eps": "€X"}
    ],
    "terminaleWaarde": {
      "groeivoetKeuze": "g = X%. Motivatie: nominale bbp-groei thuisland X%, sectorgroei langetermijn X%, positie bedrijf: marktleider/niche/cyclisch. Combinatie rechtvaardigt groeivoet van X%.",
      "berekening": "TV = FCF_t+1 / (WACC - g) = €Xmrd / (X% - X%) = €Xmrd",
      "contanteWaardeTv": "€Xmrd x kortingsfactor X = €Xmrd",
      "aandeelInEv": "X%",
      "bridgeEvNaarEquity": "EV €Xmrd - nettoschuld €Xmrd + kasoverschot €Xmrd = Equity Value €Xmrd / Xmrd aandelen = €X per aandeel"
    },
    "gevoeligheid": {
      "wacc":  ["7%", "8%", "9%", "10%"],
      "groei": ["2%", "3%", "4%"],
      "matrix": [
        ["€X", "€X", "€X", "€X"],
        ["€X", "€X", "€X", "€X"],
        ["€X", "€X", "€X", "€X"]
      ]
    }
  },

  "scenarios": [
    {
      "naam": "Bull",
      "kans": "X%",
      "kleur": "groen",
      "aanname": "Concrete positieve aanname specifiek voor dit bedrijf",
      "koersdoel": "€X"
    },
    {
      "naam": "Base",
      "kans": "X%",
      "kleur": "blauw",
      "aanname": "Consensus prognoses realiseren zich",
      "koersdoel": "€X"
    },
    {
      "naam": "Bear",
      "kans": "X%",
      "kleur": "rood",
      "aanname": "Concrete negatieve aanname specifiek voor dit bedrijf",
      "koersdoel": "€X"
    }
  ],
  "scenarioCheck": "Gewogen gemiddelde: (€X x X%) + (€X x X%) + (€X x X%) = €X, overeenkomst met koersdoel €X bevestigd.",

  "risicosKwantitatief": [
    {
      "naam": "Risico 1 (bedrijfsspecifiek)",
      "omzetimpact": "€X-Xmrd of -X%",
      "kans": "Hoog of Middel of Laag",
      "horizon": "12 mnd of 18 mnd of 24 mnd",
      "mitigatie": "Concrete mitigerende factor"
    },
    {
      "naam": "Risico 2",
      "omzetimpact": "-X% marge",
      "kans": "Middel",
      "horizon": "18 mnd",
      "mitigatie": "Mitigerende factor"
    },
    {
      "naam": "Risico 3",
      "omzetimpact": "€X-Xmrd",
      "kans": "Laag",
      "horizon": "24 mnd",
      "mitigatie": "Mitigerende factor"
    }
  ],

  "peers": {
    "selectieCriteria": "Peers geselecteerd op drie criteria: (a) business-mix, (b) EBIT-margestructuur binnen 5pp, (c) omzetgroei CAGR binnen 3pp. Peers die op slechts een criterium scoren zijn uitgesloten tenzij onderbouwd.",
    "directe": [
      {
        "naam": "Directe Concurrent 1",
        "ticker": "TICKER1",
        "forwardPE": "X.Xx",
        "evEbitda": "X.Xx",
        "pegRatio": "X.XX",
        "fcfYield": "X.X%",
        "nettomarge": "X.X%",
        "criteriaScore": "Voldoet aan X/3 criteria: business-mix ja/nee, marge ja/nee, groei ja/nee",
        "relevantie": "Uitleg waarom dit WEL de juiste benchmark is"
      },
      {
        "naam": "Directe Concurrent 2",
        "ticker": "TICKER2",
        "forwardPE": "X.Xx",
        "evEbitda": "X.Xx",
        "pegRatio": "X.XX",
        "fcfYield": "X.X%",
        "nettomarge": "X.X%",
        "criteriaScore": "Voldoet aan X/3 criteria: business-mix ja/nee, marge ja/nee, groei ja/nee",
        "relevantie": "Uitleg"
      },
      {
        "naam": "Directe Concurrent 3",
        "ticker": "TICKER3",
        "forwardPE": "X.Xx",
        "evEbitda": "X.Xx",
        "pegRatio": "X.XX",
        "fcfYield": "X.X%",
        "nettomarge": "X.X%",
        "criteriaScore": "Voldoet aan X/3 criteria: business-mix ja/nee, marge ja/nee, groei ja/nee",
        "relevantie": "Uitleg"
      }
    ],
    "monopoliepremie": [
      {
        "naam": "Monopolie-benchmark 1",
        "ticker": "TICKER",
        "pe": "X.Xx",
        "moat": "Type structurele moat (netwerk, IP, schaarste)",
        "vergelijking": "Waarom dit bedrijf WEL of NIET vergelijkbaar is qua premie"
      },
      {
        "naam": "Monopolie-benchmark 2",
        "ticker": "TICKER",
        "pe": "X.Xx",
        "moat": "Type moat",
        "vergelijking": "Vergelijking"
      }
    ]
  },

  "investmentThesis": "Twee a drie alineas. Institutionele toon. Elk kwalitatief oordeel gevolgd door een getal. Sluit af met expliciete aanbeveling en tijdshorizon.",
  "businessmodel": "Twee zinnen. Verdienmodel, geografische spreiding, marktaandeel. Bedrijfsspecifiek.",

  "swot": {
    "sterktes": [
      "Specifieke sterkte met cijfer of productnaam",
      "Specifieke sterkte 2",
      "Specifieke sterkte 3"
    ],
    "zwaktes": [
      "Specifieke zwakte met kwantificering",
      "Specifieke zwakte 2",
      "Specifieke zwakte 3"
    ],
    "kansen": [
      "Concrete kans met marktgrootte of groeipercentage",
      "Concrete kans 2",
      "Concrete kans 3"
    ],
    "bedreigingen": [
      "Specifieke bedreiging met concurrentnaam of percentage",
      "Specifieke bedreiging 2",
      "Specifieke bedreiging 3"
    ]
  },

  "katalysatoren": [
    "Concrete upside-katalysator 1 met tijdshorizon en potentieel koerseffect",
    "Concrete upside-katalysator 2",
    "Concrete upside-katalysator 3"
  ],

  "risicos": [
    "Concreet neerwaarts risico 1 met kwantificering",
    "Concreet neerwaarts risico 2",
    "Concreet neerwaarts risico 3"
  ],

  "waardering": "Vergelijk P/E of EV/EBITDA met (1) sectorgemiddelde, (2) historisch gemiddelde 5j indien bekend, (3) upside/downside tov huidige koers op basis van koersdoel. Vermeld ook in één zin waarom ons intern koersdoel (uit koersdoelAfleiding.gewogenKoersdoel) kan afwijken van externe analistenconsensus. Conclusie in een zin.",

  "bronnen": [
    "Koers, market cap, omzet, marges, dividendrendement: Yahoo Finance (real-time)",
    "Consensus koersdoel referentie: Financial Modeling Prep (analistengemiddelde)",
    "Prognoses FY2026-2030: eigen model op basis van historische groei + sectortrends",
    "AI-tekstgeneratie en modelberekeningen: Gemini 3.5 Flash / Groq llama-3.3-70b-versatile"
  ]
}`;

        const { text, provider } = await callAI(prompt, { geminiKey, groqKey });
        const parsed = parseJsonResponse(text);

        // Voeg provider-info toe aan response (optioneel, handig voor debugging)
        parsed._provider = provider;

        return res.status(200).json(parsed);

    } catch (error) {
        console.error('AI Fout (ai.js):', error);
        return res.status(500).json({ error: `Kon geen AI-analyse genereren (${error.message}).` });
    }
}
