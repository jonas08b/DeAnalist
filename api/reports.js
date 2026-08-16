// /api/reports.js
// Leest strategie-rapportages metadata uit Vercel Blob.

import { list } from '@vercel/blob';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'Alleen GET toegestaan.' });

    const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
    if (!blobToken) return res.status(500).json({ error: 'BLOB_READ_WRITE_TOKEN ontbreekt.' });

    try {
        // Haal alle JSON-metadata bestanden op voor de drie types
        const [daily, weekly, deep] = await Promise.all([
            list({ prefix: 'strategie-rapporten/daily/',  token: blobToken }),
            list({ prefix: 'strategie-rapporten/weekly/', token: blobToken }),
            list({ prefix: 'strategie-rapporten/deep/',   token: blobToken }),
        ]);

        const allBlobs = [
            ...daily.blobs.filter(b => b.pathname.endsWith('.json')),
            ...weekly.blobs.filter(b => b.pathname.endsWith('.json')),
            ...deep.blobs.filter(b => b.pathname.endsWith('.json')),
        ];

        // Haal metadata op (parallel, max 15)
        const metaResults = await Promise.all(
            allBlobs.slice(0, 30).map(async (b) => {
                try {
                    const r = await fetch(b.url);
                    if (!r.ok) return null;
                    const meta = await r.json();
                    // Bouw de HTML-URL af van de JSON-URL (zelfde pad, .html extensie)
                    meta.htmlUrl = b.url.replace('.json', '.html');
                    return meta;
                } catch { return null; }
            })
        );

        const rapporten = metaResults
            .filter(Boolean)
            .sort((a, b) => new Date(b.aangemaakt) - new Date(a.aangemaakt));

        return res.status(200).json(rapporten);

    } catch (err) {
        console.error('[reports]', err);
        return res.status(500).json({ error: `Ophalen mislukt: ${err.message}` });
    }
}
