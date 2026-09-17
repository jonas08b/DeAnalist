// api/_ai-helper.js
// Gedeelde AI-helper: Gemini 3.5 Flash (primair) → Groq llama-3.3-70b-versatile (fallback)
// Vercel negeert bestanden met '_'-prefix als serverless route.

import { GoogleGenerativeAI } from '@google/generative-ai';

const GEMINI_MODEL = 'gemini-3.5-flash';
const GROQ_MODEL   = 'llama-3.3-70b-versatile';
const GROQ_URL     = 'https://api.groq.com/openai/v1/chat/completions';

/**
 * Bepaalt of een Gemini-fout moet leiden tot een fallback naar Groq.
 * We vallen terug bij:
 *   - 429 Too Many Requests  (rate limit / quota op)
 *   - 503 Service Unavailable (Gemini tijdelijk niet bereikbaar)
 *   - 500 Internal Server Error (onverwachte serverfout aan Gemini-kant)
 *   - Netwerk-/timeout-fouten (fetch gooit zelf een Error zonder statuscode)
 *
 * Configuratiefouten (ontbrekende API-key, ongeldige prompt-structuur) worden
 * NIET opgevangen zodat ze zichtbaar blijven als echte bugs.
 */
function shouldFallback(err) {
    // Expliciete statuscodes via err.status (Google SDK) of err.statusCode
    const status = err?.status ?? err?.statusCode;
    if (status === 429 || status === 503 || status === 500) return true;

    const msg = (err?.message || '').toLowerCase();

    // Statuscode als tekst in de foutmelding (SDK gedrag varieert)
    if (msg.includes('429') || msg.includes('503') || msg.includes('500')) return true;

    // Gemini-specifieke quota/rate-limit meldingen
    if (
        msg.includes('resource_exhausted')   ||
        msg.includes('quota')                ||
        msg.includes('rate limit')           ||
        msg.includes('too many requests')    ||
        msg.includes('service_unavailable')
    ) return true;

    // Netwerk- en time-outfouten: fetch gooit een TypeError of Error zonder statuscode
    if (
        err instanceof TypeError            || // fetch: network failure
        msg.includes('fetch')               ||
        msg.includes('network')             ||
        msg.includes('timeout')             ||
        msg.includes('econnrefused')        ||
        msg.includes('enotfound')
    ) return true;

    return false;
}

/**
 * Roept Gemini 3.5 Flash aan met de gegeven prompt.
 * Geeft de ruwe tekstrespons terug.
 */
async function callGemini(prompt, geminiKey) {
    const genAI = new GoogleGenerativeAI(geminiKey);
    const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });
    const result = await model.generateContent(prompt);
    return result.response.text();
}

/**
 * Roept Groq llama-3.3-70b-versatile aan als fallback.
 * Gebruikt de OpenAI-compatibele REST-endpoint — geen extra package nodig.
 */
async function callGroq(prompt, groqKey) {
    const response = await fetch(GROQ_URL, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${groqKey}`,
            'Content-Type':  'application/json',
        },
        body: JSON.stringify({
            model:       GROQ_MODEL,
            messages:    [{ role: 'user', content: prompt }],
            temperature: 0.7,
        }),
    });

    if (!response.ok) {
        const errText = await response.text().catch(() => response.statusText);
        throw new Error(`Groq API fout (${response.status}): ${errText}`);
    }

    const data = await response.json();
    const text = data?.choices?.[0]?.message?.content;
    if (!text) throw new Error('Groq gaf geen content terug.');
    return text;
}

/**
 * Hoofd-aanroepfunctie.
 * Probeert eerst Gemini 3.5 Flash; bij elke herstelbare fout (rate limit,
 * 503, netwerk) schakelt het onmiddellijk over naar Groq.
 * Niet-herstelbare fouten (config, ongeldige key) worden doorgegooid.
 *
 * @param {string} prompt      - De volledige prompt.
 * @param {object} env         - { geminiKey, groqKey }
 * @returns {{ text: string, provider: 'gemini'|'groq' }}
 */
export async function callAI(prompt, { geminiKey, groqKey }) {
    if (!geminiKey) throw new Error('GEMINI_API_KEY ontbreekt.');

    try {
        const text = await callGemini(prompt, geminiKey);
        return { text, provider: 'gemini' };
    } catch (err) {
        if (!shouldFallback(err)) throw err; // niet-herstelbare fout → doorgooi

        console.warn(`[ai-helper] Gemini niet beschikbaar (${err?.status ?? err?.message ?? 'onbekend'}) — overschakelen naar Groq.`);
        if (!groqKey) throw new Error(`Gemini niet beschikbaar en GROQ_API_KEY ontbreekt. Originele fout: ${err.message}`);

        const text = await callGroq(prompt, groqKey);
        return { text, provider: 'groq' };
    }
}

/**
 * Hulpfunctie: haalt ruwe tekst op en parset naar JSON.
 * Verwijdert eventuele markdown-fencing die modellen soms toevoegen.
 */
export function parseJsonResponse(raw) {
    const clean = raw.replace(/```json/gi, '').replace(/```/g, '').trim();
    return JSON.parse(clean);
}
