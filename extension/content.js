// PolicyDecode - Content Script
// Proactively detects agreements and policy pages, coordinates analysis,
// and displays an isolated alert card inside a Shadow DOM.
// Strictly adheres to textContent DOM insertions.

(function () {
  'use strict';

  // Prevent multiple injections
  if (window.__POLICYDECODE_INITIALIZED__) {
    return;
  }
  window.__POLICYDECODE_INITIALIZED__ = true;

  // Track URLs already analyzed on this page session
  const analyzedUrls = new Set();
  let currentAnalyzingUrl = null;
  let shadowRoot = null;
  let cardContainer = null;
  let observer = null;
  let debounceTimer = null;

  // ---------------------------------------------------------------------------
  // 1. Detection Engine
  // ---------------------------------------------------------------------------

  const TERMS_REGEX = /(terms\s*(?:of\s*(?:service|use|sale)|&|and\s*conditions)?|conditions\s*of\s*(?:use|sale)|tos\b|legal\s*terms)/i;
  const REFUND_REGEX = /(refund(?:s)?(?:\s*policy)?|return(?:\s*policy)?|returns\b|money\s*back)/i;
  const CANCEL_REGEX = /(cancell?ation(?:\s*policy)?|cancel\s*(?:subscription|policy)|subscription\s*terms)/i;

  const AGREEMENT_TEXT_REGEX = /\b(i\s*agree|i\s*accept|agree\s*(?:&|and)\s*continue|agree\s*to\s*terms|accept\s*(?:&|and)\s*continue|accept\s*terms|agree\s*(?:&|and)\s*(?:checkout|pay|proceed)|by\s*checking\s*this\s*box|by\s*continuing|by\s*placing\s*your\s*order)\b/i;
  const CHECKOUT_PAGE_REGEX = /(checkout|payment|billing|order-summary|cart|basket|subscribe)/i;
  const CHECKOUT_BUTTON_REGEX = /\b(place\s*order|complete\s*(?:purchase|order)|pay\s*now|subscribe\s*now|proceed\s*to\s*checkout)\b/i;

  /**
   * Determine if the current page itself is a policy document
   */
  function isCurrentPagePolicy() {
    const url = window.location.href;
    const path = window.location.pathname.toLowerCase();

    // Check URL path/query
    if (TERMS_REGEX.test(path) || REFUND_REGEX.test(path) || CANCEL_REGEX.test(path)) {
      return true;
    }

    // Check document title or top headings
    const title = document.title || '';
    if (TERMS_REGEX.test(title) || REFUND_REGEX.test(title) || CANCEL_REGEX.test(title)) {
      return true;
    }

    const mainHeadings = document.querySelectorAll('h1, h2');
    for (let i = 0; i < Math.min(mainHeadings.length, 5); i++) {
      const headingText = mainHeadings[i].textContent || '';
      if (TERMS_REGEX.test(headingText) || REFUND_REGEX.test(headingText) || CANCEL_REGEX.test(headingText)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Determine if the page contains agreement triggers (buttons or checkbox labels)
   */
  function hasAgreementTrigger() {
    // 1. Inspect buttons
    const buttons = document.querySelectorAll('button, input[type="submit"], input[type="button"], [role="button"]');
    for (const btn of buttons) {
      const text = (btn.textContent || btn.value || btn.getAttribute('aria-label') || '').trim();
      if (AGREEMENT_TEXT_REGEX.test(text)) {
        return true;
      }
    }

    // 2. Inspect checkboxes and their labels
    const checkboxes = document.querySelectorAll('input[type="checkbox"]');
    for (const cb of checkboxes) {
      let labelText = '';
      if (cb.id) {
        const labelEl = document.querySelector(`label[for="${cb.id}"]`);
        if (labelEl) {
          labelText += ' ' + labelEl.textContent;
        }
      }
      const parentLabel = cb.closest('label');
      if (parentLabel) {
        labelText += ' ' + parentLabel.textContent;
      }
      if (cb.getAttribute('aria-label')) {
        labelText += ' ' + cb.getAttribute('aria-label');
      }
      const parentContainer = cb.parentElement;
      if (parentContainer) {
        labelText += ' ' + (parentContainer.textContent || '');
      }

      if (AGREEMENT_TEXT_REGEX.test(labelText)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Determine if page is in checkout or payment flow
   */
  function isCheckoutOrPaymentPage() {
    if (CHECKOUT_PAGE_REGEX.test(window.location.href)) {
      return true;
    }

    const buttons = document.querySelectorAll('button, input[type="submit"], [role="button"]');
    for (const btn of buttons) {
      const text = (btn.textContent || btn.value || '').trim();
      if (CHECKOUT_BUTTON_REGEX.test(text)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Find the best matching policy URL on the page
   * Priority: 1. Current page if policy, 2. Terms, 3. Refund, 4. Cancellation
   */
  function findBestPolicyUrl() {
    // If current page is itself a policy
    if (isCurrentPagePolicy() && /^https?:\/\//i.test(window.location.href)) {
      return window.location.href;
    }

    const links = document.querySelectorAll('a[href]');
    let bestTermsUrl = null;
    let bestRefundUrl = null;
    let bestCancelUrl = null;

    for (const a of links) {
      let rawHref = a.getAttribute('href');
      if (!rawHref || rawHref.startsWith('#') || rawHref.startsWith('javascript:') || rawHref.startsWith('mailto:')) {
        continue;
      }

      let fullUrl;
      try {
        fullUrl = new URL(rawHref, window.location.href).href;
      } catch (e) {
        continue;
      }

      if (!/^https?:\/\//i.test(fullUrl)) {
        continue;
      }

      const linkText = (a.textContent || '').trim();
      const combined = `${fullUrl} ${linkText}`;

      // Check Terms (Priority 1)
      if (!bestTermsUrl && TERMS_REGEX.test(combined)) {
        bestTermsUrl = fullUrl;
      }
      // Check Refund (Priority 2)
      if (!bestRefundUrl && REFUND_REGEX.test(combined)) {
        bestRefundUrl = fullUrl;
      }
      // Check Cancellation (Priority 3)
      if (!bestCancelUrl && CANCEL_REGEX.test(combined)) {
        bestCancelUrl = fullUrl;
      }

      // If we found a terms link, it's our top priority
      if (bestTermsUrl) {
        break;
      }
    }

    return bestTermsUrl || bestRefundUrl || bestCancelUrl || null;
  }

  // ---------------------------------------------------------------------------
  // 2. Shadow DOM Card UI Builder
  // ---------------------------------------------------------------------------

  /**
   * Helper to create elements with safe text content (strictly textContent only)
   */
  function createElement(tag, className, textContent) {
    const el = document.createElement(tag);
    if (className) {
      el.className = className;
    }
    if (textContent !== undefined && textContent !== null) {
      el.textContent = String(textContent);
    }
    return el;
  }

  /**
   * Initialize or retrieve the Shadow Root
   */
  function getOrCreateShadowRoot() {
    if (shadowRoot) {
      return shadowRoot;
    }

    let host = document.getElementById('policydecode-root');
    if (!host) {
      host = document.createElement('div');
      host.id = 'policydecode-root';
      // High z-index to stay above page elements without altering flow
      host.style.all = 'initial';
      host.style.position = 'fixed';
      host.style.bottom = '20px';
      host.style.right = '20px';
      host.style.zIndex = '2147483647';
      document.body.appendChild(host);
    }

    shadowRoot = host.attachShadow({ mode: 'open' });

    // Inject isolated styles
    const styleEl = document.createElement('style');
    const interReg = chrome.runtime.getURL('fonts/Inter-Regular.woff2');
    const interMed = chrome.runtime.getURL('fonts/Inter-Medium.woff2');
    const jbMono = chrome.runtime.getURL('fonts/JetBrainsMono-Regular.woff2');

    styleEl.textContent = `
      @font-face {
        font-family: 'Inter';
        font-style: normal;
        font-weight: 400;
        src: url('${interReg}') format('woff2');
      }
      @font-face {
        font-family: 'Inter';
        font-style: normal;
        font-weight: 600;
        src: url('${interMed}') format('woff2');
      }
      @font-face {
        font-family: 'JetBrains Mono';
        font-style: normal;
        font-weight: 400;
        src: url('${jbMono}') format('woff2');
      }

      :host {
        all: initial;
        display: block;
      }

      * {
        box-sizing: border-box;
        margin: 0;
        padding: 0;
      }

      .pd-card {
        width: 360px;
        max-width: calc(100vw - 32px);
        max-height: 70vh;
        display: flex;
        flex-direction: column;
        background-color: #121418;
        color: #f3f4f6;
        border: 1px solid #282c35;
        border-radius: 4px;
        font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
        font-size: 13px;
        line-height: 1.45;
        box-shadow: 0 4px 14px rgba(0, 0, 0, 0.45);
        overflow: hidden;
      }

      /* Header */
      .pd-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 8px 12px;
        background-color: #1a1d24;
        border-bottom: 1px solid #282c35;
      }

      .pd-brand {
        display: flex;
        align-items: center;
        gap: 6px;
      }

      .pd-brand-title {
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: #9ca3af;
      }

      .pd-close-btn {
        background: transparent;
        border: none;
        color: #9ca3af;
        font-size: 16px;
        line-height: 1;
        cursor: pointer;
        padding: 2px 4px;
        border-radius: 2px;
      }

      .pd-close-btn:hover {
        background-color: #282c35;
        color: #f3f4f6;
      }

      /* Body */
      .pd-body {
        padding: 12px;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 10px;
        scrollbar-width: thin;
        scrollbar-color: #374151 transparent;
      }

      .pd-body::-webkit-scrollbar {
        width: 6px;
      }

      .pd-body::-webkit-scrollbar-track {
        background: transparent;
      }

      .pd-body::-webkit-scrollbar-thumb {
        background: #374151;
        border-radius: 3px;
      }

      .pd-body::-webkit-scrollbar-thumb:hover {
        background: #4b5563;
      }

      .pd-body::-webkit-scrollbar-button {
        display: none;
        width: 0;
        height: 0;
      }

      /* Loading State */
      .pd-loading-container {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 24px 12px;
        gap: 12px;
        text-align: center;
      }

      .pd-spinner {
        width: 20px;
        height: 20px;
        border: 2px solid #282c35;
        border-top-color: #9ca3af;
        border-radius: 50%;
        animation: pd-spin 0.8s linear infinite;
      }

      @keyframes pd-spin {
        to { transform: rotate(360deg); }
      }

      .pd-loading-text {
        font-size: 13px;
        color: #f3f4f6;
        font-weight: 500;
      }

      .pd-loading-subtext {
        font-size: 11px;
        color: #9ca3af;
        word-break: break-all;
        max-width: 300px;
      }

      /* Error State */
      .pd-error-container {
        display: flex;
        flex-direction: column;
        gap: 10px;
        padding: 8px 0;
      }

      .pd-error-title {
        font-size: 12px;
        font-weight: 600;
        color: #ef4444;
      }

      .pd-error-desc {
        font-size: 12px;
        color: #9ca3af;
        line-height: 1.4;
      }

      .pd-retry-btn {
        align-self: flex-start;
        background-color: #1e222b;
        color: #f3f4f6;
        border: 1px solid #374151;
        border-radius: 4px;
        padding: 6px 12px;
        font-size: 12px;
        font-weight: 500;
        cursor: pointer;
      }

      .pd-retry-btn:hover {
        background-color: #282c35;
      }

      /* Risk Badge Bar */
      .pd-risk-bar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 8px 10px;
        border-radius: 4px;
        background-color: #181b22;
        border: 1px solid #282c35;
      }

      .pd-risk-label {
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        color: #9ca3af;
      }

      .pd-risk-badge {
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        padding: 2px 8px;
        border-radius: 3px;
      }

      .pd-risk-red {
        background-color: #2b1417;
        color: #f87171;
        border: 1px solid #7f1d1d;
      }

      .pd-risk-yellow {
        background-color: #2b220f;
        color: #facc15;
        border: 1px solid #78350f;
      }

      .pd-risk-green {
        background-color: #12281a;
        color: #4ade80;
        border: 1px solid #14532d;
      }

      /* Flags List */
      .pd-flags-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .pd-flag-card {
        background-color: #181b22;
        border: 1px solid #282c35;
        border-radius: 4px;
        padding: 9px 10px;
        display: flex;
        flex-direction: column;
        gap: 5px;
      }

      .pd-flag-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 6px;
      }

      .pd-flag-category {
        font-size: 10px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: #9ca3af;
      }

      .pd-flag-severity {
        font-size: 10px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }

      .pd-sev-high { color: #f87171; }
      .pd-sev-medium { color: #facc15; }
      .pd-sev-low { color: #9ca3af; }

      .pd-flag-title {
        font-size: 12px;
        font-weight: 600;
        color: #f3f4f6;
      }

      .pd-flag-explanation {
        font-size: 12px;
        color: #9ca3af;
        line-height: 1.4;
      }

      .pd-quote-box {
        margin-top: 3px;
        padding: 6px 8px;
        background-color: #0f1115;
        border: 1px solid #282c35;
        border-radius: 3px;
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      .pd-quote-box.unverified {
        border-style: dashed;
        border-color: #4b5563;
      }

      .pd-quote-text {
        font-family: 'JetBrains Mono', Consolas, Monaco, monospace;
        font-size: 11px;
        line-height: 1.4;
        color: #d1d5db;
        word-break: break-word;
      }

      .pd-quote-box.unverified .pd-quote-text {
        color: #9ca3af;
        font-style: italic;
      }

      .pd-quote-status {
        font-size: 10px;
        font-weight: 500;
      }

      .pd-quote-status.verified {
        color: #d1d5db;
      }

      .pd-quote-status.unverified {
        color: #6b7280;
      }

      /* Empty State */
      .pd-empty-state {
        padding: 12px;
        background-color: #181b22;
        border: 1px solid #282c35;
        border-radius: 4px;
        text-align: center;
        color: #9ca3af;
        font-size: 12px;
        font-weight: 500;
      }

      /* Footer */
      .pd-footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 8px 12px;
        background-color: #14171d;
        border-top: 1px solid #282c35;
        font-size: 11px;
      }

      .pd-footer-link {
        color: #9ca3af;
        text-decoration: underline;
        cursor: pointer;
      }

      .pd-footer-link:hover {
        color: #f3f4f6;
      }

      .pd-footer-disclaimer {
        color: #6b7280;
        font-size: 11px;
      }
    `;

    shadowRoot.appendChild(styleEl);

    cardContainer = document.createElement('div');
    cardContainer.className = 'pd-card';
    shadowRoot.appendChild(cardContainer);

    return shadowRoot;
  }

  /**
   * Remove and close the card
   */
  function closeCard() {
    const host = document.getElementById('policydecode-root');
    if (host) {
      host.remove();
    }
    shadowRoot = null;
    cardContainer = null;
  }

  /**
   * Render loading state in the card
   */
  function renderLoading(policyUrl) {
    getOrCreateShadowRoot();
    while (cardContainer.firstChild) {
      cardContainer.removeChild(cardContainer.firstChild);
    }

    // Header
    const header = createElement('div', 'pd-header');
    const brand = createElement('div', 'pd-brand');
    const title = createElement('span', 'pd-brand-title', 'PolicyDecode');
    brand.appendChild(title);

    const closeBtn = createElement('button', 'pd-close-btn', '×');
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.addEventListener('click', closeCard);

    header.appendChild(brand);
    header.appendChild(closeBtn);
    cardContainer.appendChild(header);

    // Body
    const body = createElement('div', 'pd-body');
    const loadBox = createElement('div', 'pd-loading-container');
    const spinner = createElement('div', 'pd-spinner');
    const text = createElement('div', 'pd-loading-text', 'Analyzing policy...');

    let domain = '';
    try {
      domain = new URL(policyUrl).hostname;
    } catch (e) {
      domain = policyUrl;
    }
    const subtext = createElement('div', 'pd-loading-subtext', domain);

    loadBox.appendChild(spinner);
    loadBox.appendChild(text);
    loadBox.appendChild(subtext);
    body.appendChild(loadBox);
    cardContainer.appendChild(body);

    // Footer
    const footer = createElement('div', 'pd-footer');
    const link = createElement('a', 'pd-footer-link', 'Open full policy');
    link.href = policyUrl;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    const disclaimer = createElement('span', 'pd-footer-disclaimer', 'Not legal advice');
    footer.appendChild(link);
    footer.appendChild(disclaimer);
    cardContainer.appendChild(footer);
  }

  /**
   * Render error state in the card
   */
  function renderError(policyUrl, errorMessage) {
    getOrCreateShadowRoot();
    while (cardContainer.firstChild) {
      cardContainer.removeChild(cardContainer.firstChild);
    }

    // Header
    const header = createElement('div', 'pd-header');
    const brand = createElement('div', 'pd-brand');
    const title = createElement('span', 'pd-brand-title', 'PolicyDecode');
    brand.appendChild(title);

    const closeBtn = createElement('button', 'pd-close-btn', '×');
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.addEventListener('click', closeCard);

    header.appendChild(brand);
    header.appendChild(closeBtn);
    cardContainer.appendChild(header);

    // Body
    const body = createElement('div', 'pd-body');
    const errBox = createElement('div', 'pd-error-container');
    const errTitle = createElement('div', 'pd-error-title', 'Analysis Error');
    const errDesc = createElement('div', 'pd-error-desc', errorMessage || 'Could not retrieve policy analysis.');
    const retryBtn = createElement('button', 'pd-retry-btn', 'Retry');
    retryBtn.addEventListener('click', () => {
      startAnalysis(policyUrl, true);
    });

    errBox.appendChild(errTitle);
    errBox.appendChild(errDesc);
    errBox.appendChild(retryBtn);
    body.appendChild(errBox);
    cardContainer.appendChild(body);

    // Footer
    const footer = createElement('div', 'pd-footer');
    const link = createElement('a', 'pd-footer-link', 'Open full policy');
    link.href = policyUrl;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    const disclaimer = createElement('span', 'pd-footer-disclaimer', 'Not legal advice');
    footer.appendChild(link);
    footer.appendChild(disclaimer);
    cardContainer.appendChild(footer);
  }

  /**
   * Format category name cleanly
   */
  function formatCategory(cat) {
    if (!cat) return 'FLAG';
    return cat.replace(/_/g, ' ').toUpperCase();
  }

  /**
   * Render result state in the card
   */
  function renderResult(policyUrl, result) {
    getOrCreateShadowRoot();
    while (cardContainer.firstChild) {
      cardContainer.removeChild(cardContainer.firstChild);
    }

    const risk = (result && result.risk ? result.risk.toLowerCase() : 'green');
    const rawFlags = (result && Array.isArray(result.flags)) ? result.flags : [];

    // Sort flags high -> medium -> low and take top 3
    const severityScore = { high: 3, medium: 2, low: 1 };
    const sortedFlags = [...rawFlags]
      .sort((a, b) => (severityScore[b.severity] || 0) - (severityScore[a.severity] || 0))
      .slice(0, 3);

    // Header
    const header = createElement('div', 'pd-header');
    const brand = createElement('div', 'pd-brand');
    const title = createElement('span', 'pd-brand-title', 'PolicyDecode');
    brand.appendChild(title);

    const closeBtn = createElement('button', 'pd-close-btn', '×');
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.addEventListener('click', closeCard);

    header.appendChild(brand);
    header.appendChild(closeBtn);
    cardContainer.appendChild(header);

    // Body
    const body = createElement('div', 'pd-body');

    // Risk indicator bar
    const riskBar = createElement('div', 'pd-risk-bar');
    const riskLabel = createElement('span', 'pd-risk-label', 'Risk Assessment');

    let badgeClass = 'pd-risk-green';
    let badgeText = 'LOW RISK';
    if (risk === 'red') {
      badgeClass = 'pd-risk-red';
      badgeText = 'HIGH RISK';
    } else if (risk === 'yellow') {
      badgeClass = 'pd-risk-yellow';
      badgeText = 'MEDIUM RISK';
    }

    const riskBadge = createElement('span', `pd-risk-badge ${badgeClass}`, badgeText);
    riskBar.appendChild(riskLabel);
    riskBar.appendChild(riskBadge);
    body.appendChild(riskBar);

    // Flags section
    if (sortedFlags.length > 0 && risk !== 'green') {
      const flagsList = createElement('div', 'pd-flags-list');

      for (const flag of sortedFlags) {
        const flagCard = createElement('div', 'pd-flag-card');

        // Flag header
        const flagHead = createElement('div', 'pd-flag-header');
        const catEl = createElement('span', 'pd-flag-category', formatCategory(flag.category));

        const sev = (flag.severity || 'low').toLowerCase();
        let sevClass = 'pd-sev-low';
        if (sev === 'high') sevClass = 'pd-sev-high';
        else if (sev === 'medium') sevClass = 'pd-sev-medium';

        const sevEl = createElement('span', `pd-flag-severity ${sevClass}`, sev.toUpperCase());
        flagHead.appendChild(catEl);
        flagHead.appendChild(sevEl);
        flagCard.appendChild(flagHead);

        // Flag title & explanation
        const titleEl = createElement('div', 'pd-flag-title', flag.title || 'Flagged Condition');
        const explEl = createElement('div', 'pd-flag-explanation', flag.explanation || '');
        flagCard.appendChild(titleEl);
        flagCard.appendChild(explEl);

        // Quote
        if (flag.quote) {
          const isVerified = Boolean(flag.verified);
          const quoteBox = createElement('div', `pd-quote-box ${isVerified ? 'verified' : 'unverified'}`);
          const quoteText = createElement('div', 'pd-quote-text', `"${flag.quote}"`);
          const quoteStatus = createElement(
            'div',
            `pd-quote-status ${isVerified ? 'verified' : 'unverified'}`,
            isVerified ? 'Quote found in policy' : 'Quote not verified'
          );

          quoteBox.appendChild(quoteText);
          quoteBox.appendChild(quoteStatus);
          flagCard.appendChild(quoteBox);
        }

        flagsList.appendChild(flagCard);
      }

      body.appendChild(flagsList);
    } else {
      // Green or empty flags
      // Strict rule: "Green or empty flags: say 'No major flags found'. Never say the policy is safe."
      const emptyState = createElement('div', 'pd-empty-state', 'No major flags found');
      body.appendChild(emptyState);
    }

    cardContainer.appendChild(body);

    // Footer
    const footer = createElement('div', 'pd-footer');
    const link = createElement('a', 'pd-footer-link', 'Open full policy');
    link.href = policyUrl;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    const disclaimer = createElement('span', 'pd-footer-disclaimer', 'Not legal advice');
    footer.appendChild(link);
    footer.appendChild(disclaimer);
    cardContainer.appendChild(footer);
  }

  // ---------------------------------------------------------------------------
  // 3. Execution & Message Handling
  // ---------------------------------------------------------------------------

  /**
   * Request policy analysis through background service worker
   */
  function startAnalysis(policyUrl, forceRetry = false) {
    if (!policyUrl) return;

    if (!forceRetry && (analyzedUrls.has(policyUrl) || currentAnalyzingUrl === policyUrl)) {
      return;
    }

    currentAnalyzingUrl = policyUrl;
    analyzedUrls.add(policyUrl);

    renderLoading(policyUrl);

    chrome.runtime.sendMessage(
      { type: 'ANALYZE_URL', url: policyUrl },
      (response) => {
        currentAnalyzingUrl = null;

        if (chrome.runtime.lastError) {
          renderError(policyUrl, chrome.runtime.lastError.message || 'Background communication error.');
          return;
        }

        if (!response || !response.success) {
          const errMsg = response && response.error ? response.error : 'Failed to analyze policy.';
          renderError(policyUrl, errMsg);
          return;
        }

        renderResult(policyUrl, response.data);
      }
    );
  }

  /**
   * Main check function
   */
  function runDetection() {
    const isPolicy = isCurrentPagePolicy();
    const hasAgreement = hasAgreementTrigger();
    const isCheckout = isCheckoutOrPaymentPage();

    if (!isPolicy && !hasAgreement && !isCheckout) {
      return;
    }

    const policyUrl = findBestPolicyUrl();
    if (!policyUrl) {
      // If no policy link is found, show nothing
      return;
    }

    startAnalysis(policyUrl);
  }

  /**
   * Debounced runner for dynamic/SPA DOM mutations
   */
  function debouncedDetect() {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
      runDetection();
    }, 450);
  }

  // Initial detection once DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', runDetection);
  } else {
    runDetection();
  }

  // Setup debounced MutationObserver for late-loaded content
  observer = new MutationObserver(() => {
    debouncedDetect();
  });

  observer.observe(document.documentElement || document.body, {
    childList: true,
    subtree: true,
  });

  // Listen for triggers from the extension popup
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message && message.type === 'ANALYZE_ACTIVE_PAGE') {
      const targetUrl = message.url || findBestPolicyUrl() || window.location.href;
      startAnalysis(targetUrl, true);
      sendResponse({ success: true, url: targetUrl });
      return true;
    }
  });

})();
