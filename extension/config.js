// PolicyDecode Configuration
// Base URL is defined only once here, per project specifications.
const CONFIG = {
  API_BASE: 'https://policydecode-4pxq.onrender.com',
  TIMEOUT_MS: 28000,
};

// Ensure availability across service worker, content script, and popup scopes
if (typeof self !== 'undefined') {
  self.CONFIG = CONFIG;
}
