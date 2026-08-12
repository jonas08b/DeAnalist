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
        const model = genAI.getGenerativeModel({ model: 'gemini-3.5-flash' });

        const prompt = `
Je bent een senior Equity Research Analyst. Analyseer het volgende bedrijf op basis van de aangeleverde marktdata.
Schrijf UITSLUITEND in het NEDERLANDS. Wees concreet, specifiek en kwantitatief waar mogelijk.

MARKTDATA:
${JSON.stringify(kpiData, null, 2)}

KRITIEKE INSTRUCTIES:
1. SWOT: Elk punt MOET bedrijfsspecifiek zijn — verwijs naar concrete cijfers, producten, markten of events. Geen generieke sectorclichés.
2. KOERSDOEL: Als er een consensus koersdoel is, leg exact uit hoe dat tot stand komt (welke methode: DCF, EV/EBITDA, P/E-multiple vs sectorgemiddelde). Als er geen koersdoel beschikbaar is, schrijf "Niet beschikbaar".
3. AANBEVELING: Geef een expliciete koop/houd/verkoop aanbeveling met tijdshorizon (6-12m) en onderbouwing.
4. PEERS: Selecteer 3-4 directe concurrenten van vergelijkbare schaal en sector. Geef per peer hun bekende P/E, marge en één strategisch verschilpunt t.o.v. het geanalyseerde bedrijf.
5. BRONNEN: Vermeld welke databronnen gebruikt zijn voor de cijfers (Yahoo Finance, FMP, consensus data).
6. WAARDERING: Vergelijk de huidige K/W (P/E) expliciet met het sectorgemiddelde en historisch gemiddelde van het bedrijf indien beschikbaar.

Geef je antwoord UITSLUITEND als een geldig JSON-object met exact deze structuur (geen markdown, geen extra tekst):

{
  "subtitel": "Krachtige ondertitel met aanbeveling en tijdshorizon (max 12 woorden)",
  "aanbeveling": "KOOP" | "HOUD" | "VERKOOP",
  "tijdshorizon": "6-12 maanden",
  "koersdoelMethode": "Korte toelichting hoe consensus koersdoel is berekend (DCF, EV/EBITDA-multiple, P/E-peer-avg, of 'Niet beschikbaar')",
  "investmentThesis": "Twee à drie alinea's met een actionabel koopargument of verkoopargument. Verwijs naar specifieke cijfers uit de data. Sluit af met de concrete aanbeveling en tijdshorizon.",
  "businessmodel": "Beknopte uitleg van het verdienmodel, geografische spreiding en marktpositie (2-3 zinnen, bedrijfsspecifiek).",
  "swot": {
    "sterktes": [
      "Specifieke sterkte 1 met cijfer of productnaam",
      "Specifieke sterkte 2 met cijfer of marktpositie",
      "Specifieke sterkte 3"
    ],
    "zwaktes": [
      "Specifieke zwakte 1 met context",
      "Specifieke zwakte 2",
      "Specifieke zwakte 3"
    ],
    "kansen": [
      "Concrete kans 1 met marktgrootte of trend",
      "Concrete kans 2",
      "Concrete kans 3"
    ],
    "bedreigingen": [
      "Specifieke bedreiging 1 met concurrentnaam of regelgeving",
      "Specifieke bedreiging 2",
      "Specifieke bedreiging 3"
    ]
  },
  "katalysatorenRisicos": {
    "katalysatoren": [
      "Upside katalysator 1 (bijv. productlancering, FDA-goedkeuring, marktexpansie)",
      "Upside katalysator 2",
      "Upside katalysator 3"
    ],
    "risicos": [
      "Downside risico 1 (bijv. regulatoir, rente, concurrentie)",
      "Downside risico 2",
      "Downside risico 3"
    ]
  },
  "peers": [
    {
      "naam": "Naam Concurrent 1",
      "ticker": "TICKER1",
      "pe": "bijv. 18.5x of N/A",
      "marge": "bijv. 12.3% of N/A",
      "focus": "Één concrete strategische eigenschap die dit bedrijf onderscheidt van het geanalyseerde bedrijf"
    },
    {
      "naam": "Naam Concurrent 2",
      "ticker": "TICKER2",
      "pe": "bijv. 22.0x of N/A",
      "marge": "bijv. 9.1% of N/A",
      "focus": "Strategisch verschil"
    },
    {
      "naam": "Naam Concurrent 3",
      "ticker": "TICKER3",
      "pe": "bijv. 15.3x of N/A",
      "marge": "bijv. 15.7% of N/A",
      "focus": "Strategisch verschil"
    }
  ],
  "waardering": "Vergelijk de huidige P/E of EV/EBITDA expliciet met: (1) het sectorgemiddelde, (2) het 5-jarig historisch gemiddelde van het bedrijf indien bekend, (3) het consensus koersdoel impliceert X% upside/downside t.o.v. huidige koers. Sluit af met een conclusie.",
  "bronnen": [
    "Koers, market cap, omzet, marges: Yahoo Finance (real-time)",
    "Consensus koersdoel: Financial Modeling Prep (analistengemiddelde)",
    "AI-tekstgeneratie: Google Gemini"
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
