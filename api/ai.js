const { GoogleGenerativeAI } = require('@google/generative-ai');

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Methode niet toegestaan.' });
    }

    const { kpiData } = req.body;

    if (!kpiData) {
        return res.status(400).json({ error: 'Geen financiële data ontvangen voor de AI.' });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        return res.status(500).json({ error: 'GEMINI_API_KEY ontbreekt in de omgevingsvariabelen van Vercel.' });
    }

    try {
        const genAI = new GoogleGenerativeAI(apiKey);
        
        // Gebruik het actuele Flash model
        const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

        const prompt = `
Je bent een ervaren Equity Research Analyst op Wall Street.
Schrijf een beknopt, professioneel analyse-rapport in het NEDERLANDS voor het volgende bedrijf op basis van deze marktdata:
${JSON.stringify(kpiData, null, 2)}

Geef je antwoord UITSLAUITEND als een geldig JSON-object met exact de volgende structuur (geen markdown formatting of extra tekst eromheen, alleen de JSON):

{
  "subtitel": "Korte krachtige ondertitel/slogan",
  "investmentThesis": "Een sterke alinea over waarom een belegger dit wel of niet zou kopen.",
  "businessmodel": "Beknopte uitleg van het verdienmodel en marktpositie.",
  "swot": {
    "sterktes": ["Sterkte 1", "Sterkte 2"],
    "zwaktes": ["Zwakte 1", "Zwakte 2"],
    "kansen": ["Kans 1", "Kans 2"],
    "bedreigingen": ["Bedreiging 1", "Bedreiging 2"]
  },
  "katalysatorenRisicos": {
    "katalysatoren": ["Katalysator 1", "Katalysator 2"],
    "risicos": ["Risico 1", "Risico 2"]
  },
  "peers": [
    {"naam": "Concurrent 1", "ticker": "TICKER1", "focus": "Beschrijving focus"},
    {"naam": "Concurrent 2", "ticker": "TICKER2", "focus": "Beschrijving focus"}
  ],
  "waardering": "Korte conclusie over de huidige koers/waardering (bijv. K/W verhouding)."
}
`;

        const result = await model.generateContent(prompt);
        const responseText = result.response.text();

        // Schoon eventuele markdown (```json ... ```) op die de AI kan meegeven
        const cleanJsonString = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
        const parsedAiData = JSON.parse(cleanJsonString);

        return res.status(200).json(parsedAiData);

    } catch (error) {
        console.error('Gemini API Fout:', error);
        return res.status(500).json({ 
            error: `Kon geen AI-analyse genereren (${error.message}).` 
        });
    }
}
