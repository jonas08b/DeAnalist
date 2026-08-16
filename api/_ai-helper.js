// api/_ai-helper.js
// Gedeelde AI-helper: Gemini 3.5 Flash (primair) → Groq llama-3.3-70b-versatile (fallback)
// Vercel negeert bestanden met '_'-prefix als serverless route.

import { GoogleGenerativeAI } from '@google/generative-ai';

const GEMINI_MODEL = 'gemini-3.5-flash';
const GROQ_MODEL   = 'llama-3.3-70b-versatile';
const GROQ_URL     = 'https://api.groq.com/openai/v1/chat/completions';

/**
 * Bepaalt of een Gemini-fout een rate limit / quota-fout is.
 * Gemini gooit dan een Error met statuscode 429 of tekst RESOURCE_EXHAUSTED.
 */
function isRateLimitError(err) {
    const msg = (err?.message || '').toLowerCase();
    return (
        msg.includes('429')               ||
        msg.includes('resource_exhausted') ||
        msg.includes('quota')              ||
        msg.includes('rate limit')         ||
        msg.includes('too many requests')  ||
        err?.status === 429
    );
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
 * Probeert eerst Gemini 3.5 Flash; bij rate-limit schakelt het onmiddellijk
 * over naar Groq llama-3.3-70b-versatile.
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
        if (!isRateLimitError(err)) throw err; // andere fout → doorgooi

        console.warn('[ai-helper] Gemini rate limit geraakt — overschakelen naar Groq.');
        if (!groqKey) throw new Error('Gemini rate limit bereikt en GROQ_API_KEY ontbreekt.');

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
