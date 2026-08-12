const { YahooFinance } = require('yahoo-finance2');

// Initialize the YahooFinance class instance as required by v3
const yahooFinance = new YahooFinance();

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

        // 2. Suppress unnecessary v3 notices
        if (typeof yahooFinance.suppressNotices === 'function') {
            yahooFinance.suppressNotices(['yahooSurvey']);
        }

        // 3. Fetch quote summary using the initialized instance
        const result = await yahooFinance.quoteSummary(cleanTicker, {
            modules: ['summaryDetail', 'financialData', 'price']
        });

        if (!result) {
            throw new Error('Geen resultaat ontvangen van Yahoo Finance.');
        }

        const priceData = result.price || {};
        const financialData = result.financialData || {};
        const summaryDetail = result.summaryDetail || {};

        // 4. Clean KPI Object
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
        
        return res.status(500).json({ 
            error: `Kon data niet ophalen: ${error.message || 'Onbekende fout'}` 
        });
    }
}
