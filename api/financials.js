import YahooFinance from 'yahoo-finance2';

// Maak een instantie aan met Vercel-vriendelijke instellingen
const yahooFinance = new YahooFinance({
    // Onderdruk v3 waarschuwingen en stel een browser User-Agent in om blokkades te voorkomen
    suppressNotices: ['yahooSurvey'],
    requestOptions: {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
    }
});

export default async function handler(req, res) {
    // 1. CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // 2. Haal de ticker op
    const { ticker } = req.query;

    if (!ticker) {
        return res.status(400).json({ 
            error: 'Geen ticker opgegeven. Gebruik bijvoorbeeld: /api/financials?ticker=AAPL' 
        });
    }

    try {
        // 3. Haal de samenvatting op met de v3 API
        const cleanTicker = ticker.trim().toUpperCase();
        const result = await yahooFinance.quoteSummary(cleanTicker, {
            modules: ['summaryDetail', 'financialData', 'price']
        });

        const priceData = result.price || {};
        const financialData = result.financialData || {};
        const summaryDetail = result.summaryDetail || {};

        // 4. Bouw het KPI-object
        const kpiData = {
            ticker: cleanTicker,
            bedrijfsNaam: priceData.longName || priceData.shortName || cleanTicker,
            koers: priceData.regularMarketPrice ?? 'N/A',
            koersdoel: financialData.targetMeanPrice ?? 'N/A',
            marketCap: priceData.marketCap ?? 'N/A',
            pe: summaryDetail.trailingPE ?? financialData.forwardPE ?? 'N/A',
            omzet: financialData.totalRevenue ?? 'N/A',
            marge: financialData.profitMargins ?? 'N/A',
            dividend: summaryDetail.dividendYield ?? 'N/A'
        };

        return res.status(200).json(kpiData);

    } catch (error) {
        console.error(`Fout bij ophalen Yahoo Finance data voor ${ticker}:`, error);
        
        // Geef een gedetailleerdere foutmelding terug ter ondersteuning van debugging
        return res.status(500).json({ 
            error: `Kon financiële data niet ophalen (${error.message}). Controleer of de ticker klopt.` 
        });
    }
}
