/**
 * Normalizes text for substring matching:
 * - Converts to lowercase
 * - Normalizes unicode quotes and dashes
 * - Collapses consecutive whitespace (spaces, tabs, newlines) into a single space
 * - Trims leading and trailing whitespace
 */
function normalizeText(text) {
  if (!text || typeof text !== 'string') {
    return '';
  }

  return text
    .toLowerCase()
    // Normalize curly apostrophes and quotes
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    // Normalize dashes/hyphens
    .replace(/[\u2013\u2014]/g, '-')
    // Replace non-breaking spaces and all whitespace characters with standard single space
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Verifies if a quote exists word-for-word in the policy text
 * after whitespace and case normalization.
 *
 * @param {string} quote - Extracted quote from the flag
 * @param {string} policyText - Cleaned full policy text
 * @returns {boolean}
 */
function verifyQuote(quote, policyText) {
  if (!quote || typeof quote !== 'string' || !policyText || typeof policyText !== 'string') {
    return false;
  }

  const normalizedQuote = normalizeText(quote);
  const normalizedPolicy = normalizeText(policyText);

  if (!normalizedQuote) {
    return false;
  }

  return normalizedPolicy.includes(normalizedQuote);
}

/**
 * Attaches verified boolean to each flag.
 * Never drops unverified flags.
 *
 * @param {Array<Object>} flags
 * @param {string} policyText
 * @returns {Array<Object>}
 */
function verifyFlags(flags, policyText) {
  if (!Array.isArray(flags)) {
    return [];
  }

  return flags.map((flag) => ({
    ...flag,
    verified: verifyQuote(flag.quote, policyText),
  }));
}

module.exports = {
  normalizeText,
  verifyQuote,
  verifyFlags,
};
