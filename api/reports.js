import { put, list } from '@vercel/blob';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // 1. Rapport opslaan in Vercel Blob
    if (req.method === 'POST') {
        try {
            const { kpiData, aiData } = req.body;
            
            if (!kpiData || !aiData) {
                return res.status(400).json({ error: 'Ontbrekende data.' });
            }

            const fileName = `reports/${kpiData.ticker}_${Date.now()}.json`;
            const reportContent = JSON.stringify({
                ticker: kpiData.ticker,
                bedrijfsNaam: kpiData.bedrijfsNaam,
                createdAt: new Date().toISOString(),
                kpiData,
                aiData
            });

            // Upload rechtstreeks naar Vercel Blob
            const blob = await put(fileName, reportContent, {
                access: 'public',
                contentType: 'application/json',
            });

            return res.status(200).json({ success: true, url: blob.url });
        } catch (error) {
            console.error('Vercel Blob Opslag Fout:', error);
            return res.status(500).json({ error: 'Kon rapport niet opslaan op Vercel Blob.' });
        }
    }

    // 2. Alle opgeslagen rapporten ophalen
    if (req.method === 'GET') {
        try {
            const { blobs } = await list({ prefix: 'reports/' });
            
            // Haal de inhoud op van alle gevonden bestanden
            const reports = await Promise.all(
                blobs.map(async (b) => {
                    const response = await fetch(b.url);
                    return await response.json();
                })
            );

            // Sorteer op nieuwste eerst
            reports.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

            return res.status(200).json(reports);
        } catch (error) {
            console.error('Vercel Blob Ophalen Fout:', error);
            return res.status(500).json({ error: 'Kon rapporten niet ophalen.' });
        }
    }

    return res.status(405).json({ error: 'Methode niet toegestaan.' });
}
