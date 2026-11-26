const OpenAI = require('openai');
require('dotenv').config();

const ALLOWED_CATEGORIES = new Set(['refund', 'auto_renew', 'hidden_fee', 'cancellation']);
const ALLOWED_SEVERITIES = new Set(['low', 'medium', 'high']);

/**
 * Creates and configures the OpenAI / LLM client
 */
function getLlmClient() {
  const apiKey = process.env.LLM_API_KEY;

  if (!apiKey || apiKey === 'your-llm-api-key') {
    const error = new Error('LLM_API_KEY is not configured in environment variables.');
    error.status = 500;
    throw error;
  }

  // Detect Google Gemini API key format (often starts with AIza) or allow explicit base URL
  const isGemini = apiKey.startsWith('AIza');
  const baseURL =
    process.env.LLM_BASE_URL ||
    (isGemini ? 'https://generativelanguage.googleapis.com/v1beta/openai/' : undefined);

  return new OpenAI({
    apiKey,
    baseURL,
  });
}

function getModelName() {
  if (process.env.LLM_MODEL) {
    return process.env.LLM_MODEL;
  }
  const apiKey = process.env.LLM_API_KEY || '';
  if (apiKey.startsWith('AIza')) {
    return 'gemini-1.5-flash';
  }
  return 'gpt-4o-mini';
}

const SYSTEM_PROMPT = `You are a consumer legal risk analyst for PolicyDecode.
Analyze the provided Terms of Service, Privacy Policy, or checkout agreement text.
Extract consumer risk flags ONLY in the following four categories:
- 'refund': strict return windows, non-refundable policies, forfeiture of money.
- 'auto_renew': recurring subscriptions, automatic billing renewals without advance reminder.
- 'hidden_fee': unexpected extra charges, price increases during term, termination fees.
- 'cancellation': burdensome cancellation steps (e.g., must call phone during narrow hours, long notice required), instant forfeiture of pre-paid service.

CRITICAL RULES:
1. 'quote' MUST be an EXACT word-for-word verbatim quote directly from the text. DO NOT edit, summarize, or invent any quotes.
2. 'severity' MUST be exactly one of: 'low', 'medium', 'high'.
3. 'category' MUST be exactly one of: 'refund', 'auto_renew', 'hidden_fee', 'cancellation'.
4. 'title': short title (under 8 words).
5. 'explanation': plain language consumer impact, 1-2 lines.
6. Return ONLY a valid JSON object with the format:
{
  "flags": [
    {
      "category": "refund | auto_renew | hidden_fee | cancellation",
      "severity": "low | medium | high",
      "title": "short title",
      "explanation": "plain language explanation",
      "quote": "verbatim text from policy"
    }
  ]
}
If no consumer risks are found, return:
{
  "flags": []
}
Output pure JSON ONLY. Do NOT include markdown code blocks, backticks, or any conversational text.`;

/**
 * Parses and validates LLM output JSON
 */
function parseLlmResponse(rawContent) {
  if (!rawContent || typeof rawContent !== 'string') {
    throw new Error('LLM returned an empty response.');
  }

  // Strip code fences if present (e.g. ```json ... ```)
  let cleaned = rawContent.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  }

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(`Invalid JSON syntax: ${err.message}`);
  }

  let flagsList = [];
  if (Array.isArray(parsed)) {
    flagsList = parsed;
  } else if (parsed && Array.isArray(parsed.flags)) {
    flagsList = parsed.flags;
  } else {
    throw new Error('JSON response does not contain a "flags" array.');
  }

  // Sanitize and validate flags
  const validatedFlags = flagsList
    .map((item) => {
      if (!item || typeof item !== 'object') return null;

      const category = String(item.category || '').toLowerCase().trim();
      const severity = String(item.severity || '').toLowerCase().trim();
      const title = String(item.title || '').trim();
      const explanation = String(item.explanation || '').trim();
      const quote = String(item.quote || '').trim();

      if (!ALLOWED_CATEGORIES.has(category)) return null;
      if (!ALLOWED_SEVERITIES.has(severity)) return null;
      if (!title || !explanation || !quote) return null;

      return {
        category,
        severity,
        title,
        explanation,
        quote,
      };
    })
    .filter(Boolean);

  return validatedFlags;
}

/**
 * Calls LLM to analyze policy text with retry-once on invalid JSON.
 *
 * @param {string} policyText - Policy text to analyze
 * @returns {Promise<Array<Object>>} List of extracted flags
 */
async function analyzePolicyWithLlm(policyText) {
  const client = getLlmClient();
  const model = getModelName();

  // If text is extremely long, truncate to reasonable token limit (e.g. ~40,000 characters)
  const maxCharacters = 45000;
  const truncatedText =
    policyText.length > maxCharacters
      ? policyText.slice(0, maxCharacters) + '\n\n[Content truncated for analysis...]'
      : policyText;

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: `Analyze the following policy text and extract consumer risk flags according to instructions:\n\n${truncatedText}`,
    },
  ];

  let rawResponse = '';
  // Attempt 1
  try {
    const completion = await client.chat.completions.create({
      model,
      messages,
      temperature: 0.1,
      response_format: { type: 'json_object' },
    });

    rawResponse = completion.choices?.[0]?.message?.content || '';
    return parseLlmResponse(rawResponse);
  } catch (attempt1Error) {
    // If error is network or API authorization, don't just retry JSON parse, re-check
    console.warn(
      `[PolicyDecode LLM] First attempt failed or returned bad JSON: ${attempt1Error.message}. Retrying once...`
    );

    // Attempt 2: Retry once with explicit correction reminder
    try {
      const retryMessages = [
        ...messages,
        { role: 'assistant', content: rawResponse || '{}' },
        {
          role: 'user',
          content:
            'Your previous response was invalid or malformed JSON. You MUST return ONLY a valid JSON object matching: { "flags": [ { "category": "...", "severity": "...", "title": "...", "explanation": "...", "quote": "..." } ] }. Absolutely no prose or markdown.',
        },
      ];

      const retryCompletion = await client.chat.completions.create({
        model,
        messages: retryMessages,
        temperature: 0.0,
        response_format: { type: 'json_object' },
      });

      const retryResponse = retryCompletion.choices?.[0]?.message?.content || '';
      return parseLlmResponse(retryResponse);
    } catch (attempt2Error) {
      const error = new Error(`LLM analysis failed after retry: ${attempt2Error.message}`);
      error.status = 502;
      throw error;
    }
  }
}

module.exports = {
  analyzePolicyWithLlm,
  parseLlmResponse,
  SYSTEM_PROMPT,
};
