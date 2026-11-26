const cheerio = require('cheerio');
const crypto = require('crypto');

/**
 * Validates whether a given string is a valid http or https URL.
 *
 * @param {string} urlString
 * @returns {boolean}
 */
function isValidUrl(urlString) {
  if (!urlString || typeof urlString !== 'string') {
    return false;
  }

  try {
    const parsed = new URL(urlString);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Extracts domain name from a URL.
 *
 * @param {string} urlString
 * @returns {string}
 */
function extractDomain(urlString) {
  try {
    const parsed = new URL(urlString);
    return parsed.hostname;
  } catch {
    return '';
  }
}

/**
 * Computes SHA-256 hash of a string.
 *
 * @param {string} text
 * @returns {string}
 */
function computeSha256(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * Cleans HTML content using cheerio:
 * Strips scripts, styles, nav, footer, header, aside, etc.
 *
 * @param {string} html
 * @returns {string}
 */
function extractReadableText(html) {
  if (!html || typeof html !== 'string') {
    return '';
  }

  const $ = cheerio.load(html);

  // Remove non-content and clutter elements
  $('script, style, nav, footer, header, aside, noscript, iframe, svg, canvas, form, select, button, [aria-hidden="true"]').remove();

  // Insert spacing around block elements to preserve word/sentence boundaries
  $('br').replaceWith('\n');
  $('p, div, h1, h2, h3, h4, h5, h6, li, tr, section, article').each((_, el) => {
    $(el).append('\n');
  });

  const rawText = $('body').length > 0 ? $('body').text() : $.root().text();

  // Normalize lines and trim excess whitespace
  const cleanText = rawText
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join('\n');

  return cleanText;
}

/**
 * Fetches the URL and extracts clean readable text along with SHA-256 hash.
 *
 * @param {string} urlString
 * @param {number} [timeoutMs=15000]
 * @returns {Promise<{ domain: string, url: string, fullText: string, contentHash: string }>}
 */
async function fetchAndCleanPolicy(urlString, timeoutMs = 15000) {
  if (!isValidUrl(urlString)) {
    const err = new Error('Invalid URL. Must be a valid http or https URL.');
    err.status = 400;
    throw err;
  }

  const domain = extractDomain(urlString);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    response = await fetch(urlString, {
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 PolicyDecode/1.0',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
  } catch (error) {
    if (error.name === 'AbortError') {
      const err = new Error(`Request timed out after ${timeoutMs}ms while fetching policy URL.`);
      err.status = 504;
      throw err;
    }
    const err = new Error(`Network failure while fetching policy URL: ${error.message}`);
    err.status = 502;
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    const err = new Error(`Failed to fetch policy page: HTTP ${response.status} ${response.statusText}`);
    err.status = response.status >= 400 && response.status < 500 ? 400 : 502;
    throw err;
  }

  const html = await response.text();
  const fullText = extractReadableText(html);

  if (!fullText || fullText.trim().length === 0) {
    const err = new Error('No readable text content could be extracted from the provided URL.');
    err.status = 422;
    throw err;
  }

  const contentHash = computeSha256(fullText);

  return {
    domain,
    url: urlString,
    fullText,
    contentHash,
  };
}

module.exports = {
  isValidUrl,
  extractDomain,
  computeSha256,
  extractReadableText,
  fetchAndCleanPolicy,
};
