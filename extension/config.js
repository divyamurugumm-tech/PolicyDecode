// PolicyDecode Configuration
// Base URL is defined only once here, per project specifications.
const CONFIG = {
  API_BASE: 'http://localhost:3000',
  TIMEOUT_MS: 28000,
};

// Ensure availability across service worker, content script, and popup scopes
if (typeof self !== 'undefined') {
  self.CONFIG = CONFIG;
}
