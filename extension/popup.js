// PolicyDecode - Popup Script
// Manages backend health status, active tab URL resolution, and manual analysis triggers.
// Strictly uses textContent and createElement (no raw HTML injection).

document.addEventListener('DOMContentLoaded', () => {
  const statusBadge = document.getElementById('backend-status-badge');
  const targetUrlEl = document.getElementById('target-url');
  const analyzeBtn = document.getElementById('analyze-btn');
  const resultArea = document.getElementById('popup-content-area');

  let activeTabUrl = '';
  let activeTabId = null;

  /**
   * Safe element creation helper
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
   * Clear all child nodes of an element
   */
  function clearElement(el) {
    while (el.firstChild) {
      el.removeChild(el.firstChild);
    }
  }

  /**
   * Check backend health status via background service worker
   */
  function checkBackendHealth() {
    chrome.runtime.sendMessage({ type: 'CHECK_HEALTH' }, (res) => {
      clearElement(statusBadge);
      if (chrome.runtime.lastError || !res || !res.ok) {
        statusBadge.className = 'pd-status-badge status-offline';
        statusBadge.textContent = 'OFFLINE';
      } else {
        statusBadge.className = 'pd-status-badge status-connected';
        statusBadge.textContent = 'CONNECTED';
      }
    });
  }

  /**
   * Retrieve active tab information
   */
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs && tabs[0] && tabs[0].url) {
      activeTabId = tabs[0].id;
      activeTabUrl = tabs[0].url;
      targetUrlEl.textContent = activeTabUrl;

      // Disable button if not an http/https URL (e.g. chrome://)
      if (!/^https?:\/\//i.test(activeTabUrl)) {
        analyzeBtn.disabled = true;
        targetUrlEl.textContent = 'Page cannot be analyzed (restricted URL)';
      }
    } else {
      targetUrlEl.textContent = 'No active tab found';
      analyzeBtn.disabled = true;
    }
  });

  // Run initial health check
  checkBackendHealth();

  /**
   * Format category name
   */
  function formatCategory(cat) {
    if (!cat) return 'FLAG';
    return cat.replace(/_/g, ' ').toUpperCase();
  }

  /**
   * Display loading state inside popup
   */
  function showLoading() {
    clearElement(resultArea);
    analyzeBtn.disabled = true;

    const row = createElement('div', 'pd-loading-row');
    const spinner = createElement('div', 'pd-spinner');
    const text = createElement('span', 'pd-loading-text', 'Analyzing page policy...');
    row.appendChild(spinner);
    row.appendChild(text);
    resultArea.appendChild(row);
  }

  /**
   * Display error state inside popup
   */
  function showError(msg) {
    clearElement(resultArea);
    analyzeBtn.disabled = false;

    const banner = createElement('div', 'pd-error-banner', msg || 'Analysis failed');
    resultArea.appendChild(banner);
  }

  /**
   * Display analysis results inside popup
   */
  function showResult(result) {
    clearElement(resultArea);
    analyzeBtn.disabled = false;

    const risk = (result && result.risk ? result.risk.toLowerCase() : 'green');
    const rawFlags = (result && Array.isArray(result.flags)) ? result.flags : [];

    // Sort high -> medium -> low and slice top 3
    const severityScore = { high: 3, medium: 2, low: 1 };
    const sortedFlags = [...rawFlags]
      .sort((a, b) => (severityScore[b.severity] || 0) - (severityScore[a.severity] || 0))
      .slice(0, 3);

    // Risk bar
    const riskBar = createElement('div', 'pd-risk-bar');
    const label = createElement('span', 'pd-risk-label', 'Risk Assessment');

    let badgeClass = 'pd-risk-green';
    let badgeText = 'LOW RISK';
    if (risk === 'red') {
      badgeClass = 'pd-risk-red';
      badgeText = 'HIGH RISK';
    } else if (risk === 'yellow') {
      badgeClass = 'pd-risk-yellow';
      badgeText = 'MEDIUM RISK';
    }

    const badge = createElement('span', `pd-risk-badge ${badgeClass}`, badgeText);
    riskBar.appendChild(label);
    riskBar.appendChild(badge);
    resultArea.appendChild(riskBar);

    // Flags
    if (sortedFlags.length > 0 && risk !== 'green') {
      const flagsList = createElement('div', 'pd-flags-list');

      for (const flag of sortedFlags) {
        const item = createElement('div', 'pd-flag-item');

        const top = createElement('div', 'pd-flag-top');
        const cat = createElement('span', 'pd-flag-category', formatCategory(flag.category));

        const sev = (flag.severity || 'low').toLowerCase();
        let sevClass = 'pd-sev-low';
        if (sev === 'high') sevClass = 'pd-sev-high';
        else if (sev === 'medium') sevClass = 'pd-sev-medium';

        const sevBadge = createElement('span', `pd-flag-sev ${sevClass}`, sev.toUpperCase());
        top.appendChild(cat);
        top.appendChild(sevBadge);
        item.appendChild(top);

        const title = createElement('div', 'pd-flag-title', flag.title || 'Condition');
        const expl = createElement('div', 'pd-flag-explanation', flag.explanation || '');
        item.appendChild(title);
        item.appendChild(expl);

        if (flag.quote) {
          const isVerified = Boolean(flag.verified);
          const quoteBlock = createElement('div', `pd-quote-block ${isVerified ? 'verified' : 'unverified'}`);
          const quoteText = createElement('div', null, `"${flag.quote}"`);
          const tag = createElement(
            'div',
            `pd-quote-tag ${isVerified ? 'verified' : 'unverified'}`,
            isVerified ? 'Quote found in policy' : 'Quote not verified'
          );

          quoteBlock.appendChild(quoteText);
          quoteBlock.appendChild(tag);
          item.appendChild(quoteBlock);
        }

        flagsList.appendChild(item);
      }

      resultArea.appendChild(flagsList);
    } else {
      // Empty or green flags: strictly say "No major flags found", never say safe
      const emptyBox = createElement('div', 'pd-empty-flags', 'No major flags found');
      resultArea.appendChild(emptyBox);
    }
  }

  // Handle "Analyze this page" click
  analyzeBtn.addEventListener('click', () => {
    if (!activeTabUrl || !/^https?:\/\//i.test(activeTabUrl)) {
      showError('Please navigate to a valid http/https webpage.');
      return;
    }

    showLoading();

    // Also notify active tab's content script to render the on-page card if possible
    if (activeTabId) {
      chrome.tabs.sendMessage(activeTabId, {
        type: 'ANALYZE_ACTIVE_PAGE',
        url: activeTabUrl,
      }, () => {
        // Ignore error if content script is not injected on special pages
        if (chrome.runtime.lastError) {
          // No-op
        }
      });
    }

    // Request analysis from background service worker
    chrome.runtime.sendMessage({
      type: 'ANALYZE_URL',
      url: activeTabUrl,
    }, (res) => {
      if (chrome.runtime.lastError) {
        showError(chrome.runtime.lastError.message || 'Background service worker unavailable.');
        return;
      }

      if (!res || !res.success) {
        showError(res && res.error ? res.error : 'Failed to analyze page policy.');
        return;
      }

      showResult(res.data);
    });
  });
});
