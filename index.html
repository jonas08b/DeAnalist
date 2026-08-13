import { put, list, del } from '@vercel/blob';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
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

            const reports = blobs.map((b) => {
                // Bestandsnaam formaat: reports/TICKER_TIMESTAMP.pdf
                const fileName = b.pathname.replace('reports/', '').replace('.pdf', '');
                const parts = fileName.split('_');
                const timestamp = parts[parts.length - 1];
                const ticker = parts.slice(0, parts.length - 1).join('_');
                return {
                    url: b.url,
                    pathname: b.pathname,
                    ticker: ticker || 'Onbekend',
                    uploadedAt: b.uploadedAt || (timestamp ? new Date(parseInt(timestamp)).toISOString() : null),
                };
            });

            reports.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));

            return res.status(200).json(reports);
        } catch (error) {
            console.error('Vercel Blob Ophalen Fout:', error);
            return res.status(500).json({ error: 'Kon rapporten niet ophalen.' });
        }
    }

    // 3. Rapport verwijderen uit Vercel Blob
    if (req.method === 'DELETE') {
        try {
            const { url } = req.body;

            if (!url) {
                return res.status(400).json({ error: 'Ontbrekende URL.' });
            }

            await del(url);

            return res.status(200).json({ success: true });
        } catch (error) {
            console.error('Vercel Blob Verwijderen Fout:', error);
            return res.status(500).json({ error: 'Kon rapport niet verwijderen.' });
        }
    }

    return res.status(405).json({ error: 'Methode niet toegestaan.' });
}
