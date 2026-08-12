const yahooFinance = require('yahoo-finance2').default;

export default async function handler(req, res) {
    // 1. CORS headers toevoegen zodat je frontend (index.html) erbij kan
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

    // 2. Haal de ticker uit de URL parameter (bijv. /api/financials?ticker=AAPL)
    const { ticker } = req.query;

    if (!ticker) {
        return res.status(400).json({ 
            error: 'Geen ticker opgegeven. Gebruik bijvoorbeeld: /api/financials?ticker=AAPL' 
        });
    }

    try {
        // 3. Haal alleen de modules op die we nodig hebben voor onze KPI-strip
        const queryOptions = { modules: ['summaryDetail', 'financialData', 'price'] };
        const result = await yahooFinance.quoteSummary(ticker, queryOptions);

        const priceData = result.price || {};
        const financialData = result.financialData || {};
        const summaryDetail = result.summaryDetail || {};

        // 4. Bouw een strak JSON-object op met exact de KPI's die het rapport nodig heeft
        const kpiData = {
            ticker: ticker.toUpperCase(),
            bedrijfsNaam: priceData.longName || ticker.toUpperCase(),
            koers: priceData.regularMarketPrice || 'N/A',
            koersdoel: financialData.targetMeanPrice || 'N/A',
            marketCap: priceData.marketCap || 'N/A',
            pe: summaryDetail.trailingPE || 'N/A',
            omzet: financialData.totalRevenue || 'N/A',
            marge: financialData.profitMargins || 'N/A',
            dividend: summaryDetail.dividendYield || 'N/A'
        };

        // 5. Stuur de data succesvol terug naar de app
        res.status(200).json(kpiData);

    } catch (error) {
        console.error(`Fout bij ophalen Yahoo Finance data voor ${ticker}:`, error.message);
        res.status(500).json({ 
            error: 'Kon financiële data niet ophalen. Controleer of de ticker-code klopt.' 
        });
    }
}
