const { GoogleGenerativeAI } = require('@google/generative-ai');

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Methode niet toegestaan.' });

    const { kpiData } = req.body;
    if (!kpiData) return res.status(400).json({ error: 'Geen financiële data ontvangen.' });

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY ontbreekt.' });

    try {
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

        const prompt = `
Je bent een senior Equity Research Analyst (CFA-niveau). Analyseer het volgende bedrijf op basis van de aangeleverde marktdata.
Schrijf UITSLUITEND in het NEDERLANDS. Gebruik neutrale, institutionele taal — geen promotionele formuleringen.

REGELS VOOR TAALGEBRUIK:
- Vervang "superieur operationeel profiel" → "bovengemiddelde operationele efficiëntie"  
- Vervang "uitmuntende marge" → "nettomarge van X%, significant boven sectorgemiddelde van Y%"
- Vervang "onmisbare rol" → "structureel dominante marktpositie"
- Elk kwalitatief oordeel MOET gevolgd worden door een concreet getal

MARKTDATA:
${JSON.stringify(kpiData, null, 2)}

Geef je antwoord UITSLUITEND als een geldig JSON-object met exact deze structuur. Geen markdown, geen extra tekst:

{
  "subtitel": "Neutrale ondertitel met aanbeveling en tijdshorizon (max 12 woorden)",
  "aanbeveling": "KOOP of HOUD of VERKOOP",
  "tijdshorizon": "12 maanden",
  "koersdoelMethode": "Toelichting hoe consensus koersdoel tot stand komt: DCF, EV/EBITDA-multiple, P/E-peer-avg. Of 'Niet beschikbaar'.",

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
    "terminaleWaarde": "Terminale groeivoet X%, terminale FCF €Xmrd, TV = FCF × (1+g)/(WACC-g) = €Xmrd. Contante waarde TV = €Xmrd (X% van totale ondernemingswaarde).",
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
      "kans": "25%",
      "kleur": "groen",
      "aanname": "Concrete positieve aanname specifiek voor dit bedrijf (product, markt, event)",
      "koersdoel": "€X of $X"
    },
    {
      "naam": "Base",
      "kans": "55%",
      "kleur": "blauw",
      "aanname": "Consensus prognoses — huidige groeiverwachtingen realiseren zich",
      "koersdoel": "€X of $X"
    },
    {
      "naam": "Bear",
      "kans": "20%",
      "kleur": "rood",
      "aanname": "Concrete negatieve aanname specifiek voor dit bedrijf (regulatoir, concurrentie, vraaguitval)",
      "koersdoel": "€X of $X"
    }
  ],

  "risicosKwantitatief": [
    {
      "naam": "Risico 1 (bedrijfsspecifiek)",
      "omzetimpact": "€X–Xmrd of -X%",
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
      "omzetimpact": "€X–Xmrd",
      "kans": "Laag",
      "horizon": "24 mnd",
      "mitigatie": "Mitigerende factor"
    }
  ],

  "peers": {
    "directe": [
      {
        "naam": "Directe Concurrent 1 (zelfde sector, vergelijkbare schaal)",
        "ticker": "TICKER1",
        "forwardPE": "X.Xx",
        "evEbitda": "X.Xx",
        "pegRatio": "X.XX",
        "fcfYield": "X.X%",
        "nettomarge": "X.X%",
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
        "relevantie": "Uitleg"
      }
    ],
    "monopoliepremie": [
      {
        "naam": "Monopolie-benchmark 1 (bijv. NVIDIA, MSFT, Hermès)",
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

  "investmentThesis": "Twee à drie alinea's. Institutionele toon. Elk kwalitatief oordeel gevolgd door een getal. Sluit af met expliciete aanbeveling en tijdshorizon.",
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

  "waardering": "Vergelijk P/E of EV/EBITDA met (1) sectorgemiddelde, (2) historisch gemiddelde 5j indien bekend, (3) upside/downside t.o.v. huidige koers op basis van koersdoel. Conclusie in één zin.",

  "bronnen": [
    "Koers, market cap, omzet, marges, dividendrendement: Yahoo Finance (real-time)",
    "Consensus koersdoel, peers data: Financial Modeling Prep (analistengemiddelde)",
    "Prognoses FY2026-2030: eigen model op basis van historische groei + sectortrends",
    "AI-tekstgeneratie en modelberekeningen: Google Gemini 2.0 Flash"
  ]
}
`;

        const result = await model.generateContent(prompt);
        const responseText = result.response.text();
        const cleanJson = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
        const parsed = JSON.parse(cleanJson);
        return res.status(200).json(parsed);

    } catch (error) {
        console.error('Gemini API Fout:', error);
        return res.status(500).json({ error: `Kon geen AI-analyse genereren (${error.message}).` });
    }
}
