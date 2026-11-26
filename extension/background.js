// PolicyDecode - Service Worker (Background)
// Handles all network communications, API timeouts, and session caching.

importScripts('config.js');

/**
 * Cache key prefix for session storage
 */
const CACHE_PREFIX = 'policydecode_cache_';

/**
 * Retrieve cached analysis for a given URL from chrome.storage.session
 */
async function getCachedAnalysis(url) {
  try {
    if (!chrome.storage || !chrome.storage.session) {
      return null;
    }
    const key = CACHE_PREFIX + url;
    const result = await chrome.storage.session.get(key);
    return result[key] || null;
  } catch (err) {
    console.warn('[PolicyDecode SW] Error reading session storage:', err);
    return null;
  }
}

/**
 * Save analysis result to chrome.storage.session
 */
async function setCachedAnalysis(url, data) {
  try {
    if (!chrome.storage || !chrome.storage.session) {
      return;
    }
    const key = CACHE_PREFIX + url;
    await chrome.storage.session.set({ [key]: data });
  } catch (err) {
    console.warn('[PolicyDecode SW] Error saving to session storage:', err);
  }
}

/**
 * Call GET /health endpoint
 */
async function checkHealth() {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 6000);

  try {
    const res = await fetch(`${CONFIG.API_BASE}/health`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      return { success: false, error: `Health check failed with status ${res.status}` };
    }

    const json = await res.json();
    return { success: true, ok: Boolean(json.ok) };
  } catch (err) {
    clearTimeout(timeoutId);
    return {
      success: false,
      error: err.name === 'AbortError' ? 'Health check timed out' : (err.message || 'Health check failed'),
    };
  }
}

/**
 * Call POST /analyze endpoint with timeout and session cache
 */
async function analyzePolicyUrl(url) {
  if (!url || typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
    return { success: false, error: 'A valid http/https URL is required' };
  }

  // 1. Check session storage cache
  const cached = await getCachedAnalysis(url);
  if (cached) {
    return { success: true, data: cached, fromCache: true };
  }

  // 2. Execute network request with 28-second timeout
  const controller = new AbortController();
  const timeoutMs = CONFIG.TIMEOUT_MS || 28000;
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${CONFIG.API_BASE}/analyze`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({ url: url.trim() }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    const json = await res.json().catch(() => null);

    if (!res.ok) {
      const errorMsg = (json && json.error) ? json.error : `Server returned error (${res.status})`;
      return { success: false, error: errorMsg };
    }

    if (!json || typeof json.risk !== 'string') {
      return { success: false, error: 'Invalid analysis payload received from server' };
    }

    // Cache successful analysis in session storage
    await setCachedAnalysis(url, json);

    return { success: true, data: json, fromCache: false };
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      return { success: false, error: `Analysis timed out after ${Math.round(timeoutMs / 1000)} seconds` };
    }
    return {
      success: false,
      error: err.message || 'Unable to connect to analysis server',
    };
  }
}

// Runtime message listener
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) {
    return false;
  }

  if (message.type === 'CHECK_HEALTH') {
    checkHealth().then(sendResponse);
    return true; // Keep message channel open for async response
  }

  if (message.type === 'ANALYZE_URL') {
    analyzePolicyUrl(message.url).then(sendResponse);
    return true; // Keep message channel open for async response
  }

  return false;
});
