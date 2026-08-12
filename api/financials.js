const yahooFinance = require('yahoo-finance2').default;

export default async function handler(req, res) {
    // 1. CORS Headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Content-Type', 'application/json');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    const { ticker } = req.query;

    if (!ticker) {
        return res.status(400).json({ 
            error: 'Geen ticker opgegeven.' 
        });
    }

    try {
        const cleanTicker = ticker.trim().toUpperCase();

        // 2. Suppress v3 notices om verwarring in logs te voorkomen
        if (typeof yahooFinance.suppressNotices === 'function') {
            yahooFinance.suppressNotices(['yahooSurvey']);
        }

        // 3. Haal data op via quoteSummary
        const result = await yahooFinance.quoteSummary(cleanTicker, {
            modules: ['summaryDetail', 'financialData', 'price']
        });

        if (!result) {
            throw new Error('Geen resultaat ontvangen van Yahoo Finance.');
        }

        const priceData = result.price || {};
        const financialData = result.financialData || {};
        const summaryDetail = result.summaryDetail || {};

        // 4. Strakke KPI structuur
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
        console.error('API Financials Error:', error);
        
        // Zorg dat we ALTIJD een JSON-foutmelding terugsturen
        return res.status(500).json({ 
            error: `Kon data niet ophalen: ${error.message || 'Onbekende fout'}` 
        });
    }
}
