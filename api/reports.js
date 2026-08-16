// /api/reports.js
// Leest strategie-rapporten metadata uit Vercel Blob en geeft een array terug.
// Elk rapport = { type, titel, conclusie, intro, datum, datumISO, aangemaakt, htmlUrl, metaUrl }

import { list } from '@vercel/blob';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();

    const token = process.env.BLOB_READ_WRITE_TOKEN;
    if (!token) return res.status(500).json({ error: 'BLOB_READ_WRITE_TOKEN ontbreekt.' });

    if (req.method !== 'GET') return res.status(405).json({ error: 'Methode niet toegestaan.' });

    try {
        // Haal alle JSON metadata-bestanden op uit strategie-rapporten/
        const { blobs } = await list({ prefix: 'strategie-rapporten/', token });

        const jsonBlobs = blobs.filter(b => b.pathname.endsWith('.json'));

        if (!jsonBlobs.length) return res.status(200).json([]);

        // Laad alle JSON metadata parallel
        const results = await Promise.allSettled(
            jsonBlobs.map(async (b) => {
                const r = await fetch(b.url);
                if (!r.ok) return null;
                const meta = await r.json();

                // Bepaal de bijbehorende HTML URL
                // Pad: strategie-rapporten/{type}/{datumISO}.json → .html
                const htmlPath = b.pathname.replace('.json', '.html');
                const htmlBlob = blobs.find(x => x.pathname === htmlPath);

                return {
                    type:       meta.type       || 'daily',
                    titel:      meta.titel       || '—',
                    conclusie:  meta.conclusie   || '',
                    intro:      meta.intro       || '',
                    datum:      meta.datum       || meta.datumISO || '',
                    datumISO:   meta.datumISO    || '',
                    aangemaakt: meta.aangemaakt  || b.uploadedAt || null,
                    htmlUrl:    htmlBlob ? htmlBlob.url : '',
                    metaUrl:    b.url,
                };
            })
        );

        const rapporten = results
            .filter(r => r.status === 'fulfilled' && r.value)
            .map(r => r.value)
            .sort((a, b) => new Date(b.aangemaakt) - new Date(a.aangemaakt));

        return res.status(200).json(rapporten);

    } catch (err) {
        console.error('[reports GET]', err);
        return res.status(500).json({ error: err.message });
    }
}
