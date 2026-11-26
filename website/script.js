/**
 * PolicyDecode Website Script
 * Zero frameworks, no build step.
 * Uses CONFIG.API_BASE and CONFIG.GITHUB_URL from config.js.
 * Strict DOM construction with textContent (zero innerHTML for API/untrusted data).
 */

(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // 1. Initialization & Configuration Binding
  // ---------------------------------------------------------------------------
  const config = window.CONFIG || {
    API_BASE: 'http://localhost:3000',
    GITHUB_URL: '#'
  };

  document.addEventListener('DOMContentLoaded', () => {
    bindConfigUrls();
    initTrySection();
    initCopyButtons();
  });

  /**
   * Bind dynamic URLs defined in config.js to respective page links
   */
  function bindConfigUrls() {
    const githubLinks = document.querySelectorAll('.js-github-link');
    githubLinks.forEach((link) => {
      link.href = config.GITHUB_URL;
    });
  }

  // ---------------------------------------------------------------------------
  // 2. Safe DOM Element Builder
  // ---------------------------------------------------------------------------
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

  // ---------------------------------------------------------------------------
  // 3. Try It Interactive Analysis Section
  // ---------------------------------------------------------------------------
  const NETFLIX_EXAMPLE_URL = 'https://help.netflix.com/legal/termsofuse';

  function initTrySection() {
    const form = document.getElementById('try-form');
    const urlInput = document.getElementById('policy-url-input');
    const analyzeBtn = document.getElementById('analyze-btn');
    const fillExampleBtn = document.getElementById('fill-example-btn');
    const resultArea = document.getElementById('try-result-area');

    if (!form || !urlInput || !analyzeBtn || !resultArea) {
      return;
    }

    // Auto-fill example button
    if (fillExampleBtn) {
      fillExampleBtn.addEventListener('click', (e) => {
        e.preventDefault();
        urlInput.value = NETFLIX_EXAMPLE_URL;
        urlInput.focus();
      });
    }

    // Form submit / Analyze trigger
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const rawUrl = urlInput.value.trim();

      if (!rawUrl) {
        urlInput.focus();
        return;
      }

      if (!/^https?:\/\//i.test(rawUrl)) {
        alert('Please enter a valid URL starting with http:// or https://');
        urlInput.focus();
        return;
      }

      executeAnalysis(rawUrl);
    });
  }

  /**
   * Execute analysis against API_BASE/analyze
   */
  async function executeAnalysis(targetUrl) {
    const urlInput = document.getElementById('policy-url-input');
    const analyzeBtn = document.getElementById('analyze-btn');
    const resultArea = document.getElementById('try-result-area');

    // UI state: loading
    setFormDisabled(true);
    renderLoading(resultArea, targetUrl);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    const endpoint = `${config.API_BASE.replace(/\/+$/, '')}/analyze`;

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({ url: targetUrl }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        const errorMsg = (data && data.error) ? data.error : `Server returned status ${response.status} (${response.statusText})`;
        renderError(resultArea, targetUrl, errorMsg);
        return;
      }

      if (data && data.error) {
        renderError(resultArea, targetUrl, data.error);
        return;
      }

      renderResult(resultArea, targetUrl, data);
    } catch (err) {
      clearTimeout(timeoutId);

      let errorMessage = 'Could not retrieve policy analysis.';
      if (err.name === 'AbortError') {
        errorMessage = 'The analysis request timed out after 30 seconds.';
      } else if (!navigator.onLine) {
        errorMessage = 'You are currently offline. Check your internet connection.';
      } else {
        errorMessage = `Failed to connect to backend at ${config.API_BASE}. Ensure the PolicyDecode backend server is running (e.g. cd backend && npm start).`;
      }

      renderError(resultArea, targetUrl, errorMessage);
    } finally {
      setFormDisabled(false);
    }
  }

  function setFormDisabled(disabled) {
    const urlInput = document.getElementById('policy-url-input');
    const analyzeBtn = document.getElementById('analyze-btn');
    if (urlInput) urlInput.disabled = disabled;
    if (analyzeBtn) analyzeBtn.disabled = disabled;
  }

  // ---------------------------------------------------------------------------
  // 4. Card Rendering Methods (Authentic Extension DOM Structure)
  // ---------------------------------------------------------------------------

  /**
   * Render loading state in card
   */
  function renderLoading(container, policyUrl) {
    container.textContent = '';

    const card = createElement('div', 'pd-card');

    // Header
    const header = createElement('div', 'pd-header');
    const brand = createElement('div', 'pd-brand');
    const title = createElement('span', 'pd-brand-title', 'PolicyDecode');
    brand.appendChild(title);
    header.appendChild(brand);
    card.appendChild(header);

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
    card.appendChild(body);

    // Footer
    const footer = createElement('div', 'pd-footer');
    const link = createElement('a', 'pd-footer-link', 'Open full policy');
    link.href = policyUrl;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    const disclaimer = createElement('span', 'pd-footer-disclaimer', 'Not legal advice');
    footer.appendChild(link);
    footer.appendChild(disclaimer);
    card.appendChild(footer);

    container.appendChild(card);
  }

  /**
   * Render error state in card
   */
  function renderError(container, policyUrl, errorMessage) {
    container.textContent = '';

    const card = createElement('div', 'pd-card');

    // Header
    const header = createElement('div', 'pd-header');
    const brand = createElement('div', 'pd-brand');
    const title = createElement('span', 'pd-brand-title', 'PolicyDecode');
    brand.appendChild(title);
    header.appendChild(brand);
    card.appendChild(header);

    // Body
    const body = createElement('div', 'pd-body');
    const errBox = createElement('div', 'pd-error-container');
    const errTitle = createElement('div', 'pd-error-title', 'Analysis Error');
    const errDesc = createElement('div', 'pd-error-desc', errorMessage);
    const retryBtn = createElement('button', 'pd-retry-btn', 'Retry');
    retryBtn.type = 'button';
    retryBtn.addEventListener('click', () => {
      executeAnalysis(policyUrl);
    });

    errBox.appendChild(errTitle);
    errBox.appendChild(errDesc);
    errBox.appendChild(retryBtn);
    body.appendChild(errBox);
    card.appendChild(body);

    // Footer
    const footer = createElement('div', 'pd-footer');
    const link = createElement('a', 'pd-footer-link', 'Open full policy');
    link.href = policyUrl;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    const disclaimer = createElement('span', 'pd-footer-disclaimer', 'Not legal advice');
    footer.appendChild(link);
    footer.appendChild(disclaimer);
    card.appendChild(footer);

    container.appendChild(card);
  }

  /**
   * Format category identifier to readable label
   */
  function formatCategory(cat) {
    if (!cat) return 'FLAG';
    return String(cat).replace(/_/g, ' ').toUpperCase();
  }

  /**
   * Render successful result state matching extension card
   */
  function renderResult(container, policyUrl, result) {
    container.textContent = '';

    const card = createElement('div', 'pd-card');

    const risk = (result && result.risk ? String(result.risk).toLowerCase() : 'green');
    const rawFlags = (result && Array.isArray(result.flags)) ? result.flags : [];

    // Sort flags high -> medium -> low and take at most 3
    const severityScore = { high: 3, medium: 2, low: 1 };
    const sortedFlags = [...rawFlags]
      .sort((a, b) => (severityScore[b.severity] || 0) - (severityScore[a.severity] || 0))
      .slice(0, 3);

    // Header
    const header = createElement('div', 'pd-header');
    const brand = createElement('div', 'pd-brand');
    const title = createElement('span', 'pd-brand-title', 'PolicyDecode');
    brand.appendChild(title);
    header.appendChild(brand);
    card.appendChild(header);

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
      // Rule: "Green or empty flags: say 'No major flags found'. Never say the policy is safe."
      const emptyState = createElement('div', 'pd-empty-state', 'No major flags found');
      body.appendChild(emptyState);
    }

    card.appendChild(body);

    // Footer
    const footer = createElement('div', 'pd-footer');
    const link = createElement('a', 'pd-footer-link', 'Open full policy');
    link.href = policyUrl;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    const disclaimer = createElement('span', 'pd-footer-disclaimer', 'Not legal advice');
    footer.appendChild(link);
    footer.appendChild(disclaimer);
    card.appendChild(footer);

    container.appendChild(card);
  }

  // ---------------------------------------------------------------------------
  // 5. Utility Copy Helpers
  // ---------------------------------------------------------------------------
  function initCopyButtons() {
    const copyBtns = document.querySelectorAll('.js-copy-btn');
    copyBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const textToCopy = btn.getAttribute('data-copy-target');
        if (!textToCopy) return;

        navigator.clipboard.writeText(textToCopy).then(() => {
          const originalText = btn.textContent;
          btn.textContent = 'Copied!';
          setTimeout(() => {
            btn.textContent = originalText;
          }, 2000);
        }).catch(() => {
          // Fallback
          prompt('Copy to clipboard: Ctrl+C, Enter', textToCopy);
        });
      });
    });
  }

})();
