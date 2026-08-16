// /api/reports.js
import { put, list, del } from '@vercel/blob';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();

    const token = process.env.BLOB_READ_WRITE_TOKEN;
    if (!token) return res.status(500).json({ error: 'BLOB_READ_WRITE_TOKEN ontbreekt.' });

    // ── GET: alle rapporten ophalen ────────────────────────────────────────
    if (req.method === 'GET') {
        try {
            const { blobs } = await list({ prefix: 'reports/', token });

            if (!blobs.length) return res.status(200).json([]);

            const reports = blobs
                .filter(b => b.pathname.endsWith('.pdf') || b.pathname.endsWith('.html'))
                .map(b => {
                    // Formaat: reports/TICKER_TIMESTAMP.pdf
                    const name   = b.pathname.replace('reports/', '').replace(/\.(pdf|html)$/, '');
                    const parts  = name.split('_');
                    const ts     = parts[parts.length - 1];
                    const ticker = parts.slice(0, -1).join('_');
                    return {
                        url:        b.url,
                        pathname:   b.pathname,
                        ticker:     ticker || 'Onbekend',
                        uploadedAt: b.uploadedAt || (ts ? new Date(parseInt(ts)).toISOString() : null),
                    };
                });

            reports.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
            return res.status(200).json(reports);

        } catch (err) {
            console.error('[reports GET]', err);
            return res.status(500).json({ error: err.message });
        }
    }

    // ── POST: rapport opslaan ──────────────────────────────────────────────
    if (req.method === 'POST') {
        try {
            const { ticker, title, htmlContent, pdfBase64 } = req.body;
            if (!ticker) return res.status(400).json({ error: 'ticker ontbreekt.' });

            const ts       = Date.now();
            let fileName, buffer, contentType;

            if (htmlContent) {
                // Voorkeur: sla op als HTML (inline weergave in browser)
                fileName    = `reports/${ticker}_${ts}.html`;
                buffer      = Buffer.from(htmlContent, 'utf-8');
                contentType = 'text/html';
            } else if (pdfBase64) {
                fileName    = `reports/${ticker}_${ts}.pdf`;
                buffer      = Buffer.from(pdfBase64, 'base64');
                contentType = 'application/pdf';
            } else {
                return res.status(400).json({ error: 'htmlContent of pdfBase64 ontbreekt.' });
            }

            const blob = await put(fileName, buffer, { access: 'public', contentType, token });
            return res.status(200).json({ success: true, url: blob.url });

        } catch (err) {
            console.error('[reports POST]', err);
            return res.status(500).json({ error: err.message });
        }
    }

    // ── DELETE: rapport verwijderen ────────────────────────────────────────
    if (req.method === 'DELETE') {
        try {
            const { url } = req.body;
            if (!url) return res.status(400).json({ error: 'url ontbreekt.' });
            await del(url, { token });
            return res.status(200).json({ success: true });
        } catch (err) {
            console.error('[reports DELETE]', err);
            return res.status(500).json({ error: err.message });
        }
    }

    return res.status(405).json({ error: 'Methode niet toegestaan.' });
}
