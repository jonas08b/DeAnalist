import { GoogleGenerativeAI } from '@google/generative-ai';

export default async function handler(req, res) {
    // 1. CORS Headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Alleen POST-requests zijn toegestaan.' });
    }

    const { kpiData } = req.body;

    if (!kpiData || !kpiData.ticker) {
        return res.status(400).json({ error: 'Geen financiële data ontvangen om te analyseren.' });
    }

    try {
        // 2. Initialiseer Gemini met je gratis API key
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

        // 3. De professionele Investment Bank prompt
        const prompt = `
Je bent een senior equity research analist bij een top-tier investeringsbank. 
Schrijf op basis van de onderstaande marktgegevens een hoogprofessioneel, zakelijk beleggingsrapport in het Nederlands.

Financiële KPI's:
- Ticker: ${kpiData.ticker}
- Bedrijf: ${kpiData.bedrijfsNaam}
- Koers: $${kpiData.koers}
- Koersdoel: $${kpiData.koersdoel}
- Market Cap: ${kpiData.marketCap}
- K/W (P/E): ${kpiData.pe}
- Omzet: ${kpiData.omzet}
- Nettomarge: ${kpiData.marge}
- Dividend: ${kpiData.dividend}

Geef de output UITSLUITEND terug als een geldige, pure JSON string (zonder markdown opmaak zoals \`\`\`json) met exact deze structuur:
{
  "subtitel": "Korte, krachtige visie/ondertitel op het aandeel (max 15 woorden)",
  "investmentThesis": "De kern van de beleggingscasus (150-200 woorden)",
  "businessmodel": "Uitleg over het verdienmodel en de sectorcontext (150 woorden)",
  "swot": {
    "sterktes": ["Sterkte 1 met toelichting", "Sterkte 2 met toelichting"],
    "zwaktes": ["Zwakte 1 met toelichting", "Zwakte 2 met toelichting"],
    "kansen": ["Kans 1 met toelichting", "Kans 2 met toelichting"],
    "bedreigingen": ["Bedreiging 1 met toelichting", "Bedreiging 2 met toelichting"]
  },
  "katalysatorenRisicos": {
    "katalysatoren": ["Katalysator 1 (Upside)", "Katalysator 2 (Upside)"],
    "risicos": ["Risico 1 (Downside)", "Risico 2 (Downside)"]
  },
  "peers": [
    {"naam": "Concurrent 1", "ticker": "TICKER1", "focus": "Relatie/focus tov dit bedrijf"},
    {"naam": "Concurrent 2", "ticker": "TICKER2", "focus": "Relatie/focus tov dit bedrijf"},
    {"naam": "Concurrent 3", "ticker": "TICKER3", "focus": "Relatie/focus tov dit bedrijf"}
  ],
  "waardering": "Analyse over het huidige waarderingsniveau en of het duur/goedkoop lijkt (100 woorden)"
}
`;

        // 4. Genereer de AI-analyse
        const result = await model.generateContent(prompt);
        const responseText = result.response.text();

        // Opschonen voor het geval het model toch markdown backticks toevoegt
        const cleanedJson = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
        const parsedAnalysis = JSON.parse(cleanedJson);

        res.status(200).json(parsedAnalysis);

    } catch (error) {
        console.error('Fout bij genereren van AI-analyse:', error);
        res.status(500).json({ 
            error: 'Kon geen AI-analyse genereren. Controleer je GEMINI_API_KEY instelling op Vercel.' 
        });
    }
}
