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
            const { ticker, title, pdfBase64 } = req.body;

            if (!ticker || !pdfBase64) {
                return res.status(400).json({ error: 'Ontbrekende data.' });
            }

            const fileName = `reports/${ticker}_${Date.now()}.pdf`;
            const pdfBuffer = Buffer.from(pdfBase64, 'base64');

            // Upload rechtstreeks naar Vercel Blob
            const blob = await put(fileName, pdfBuffer, {
                access: 'public',
                contentType: 'application/pdf',
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

            // Geef de metadata terug (url, pathname, uploadedAt)
            const reports = blobs.map((b) => ({
                url: b.url,
                pathname: b.pathname,
                uploadedAt: b.uploadedAt,
            }));

            // Sorteer op nieuwste eerst
            reports.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));

            return res.status(200).json(reports);
        } catch (error) {
            console.error('Vercel Blob Ophalen Fout:', error);
            return res.status(500).json({ error: 'Kon rapporten niet ophalen.' });
        }
    }

    return res.status(405).json({ error: 'Methode niet toegestaan.' });
}
