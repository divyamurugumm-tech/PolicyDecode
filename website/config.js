/**
 * PolicyDecode Website Configuration
 * Defined only here. Do not hardcode API_BASE or GITHUB_URL elsewhere.
 */
const CONFIG = {
  API_BASE: 'https://policydecode-4pxq.onrender.com',
  GITHUB_URL: 'https://github.com/divyamurugumm-tech/PolicyDecode'
};

// Make available globally in browser window
if (typeof window !== 'undefined') {
  window.CONFIG = CONFIG;
}
