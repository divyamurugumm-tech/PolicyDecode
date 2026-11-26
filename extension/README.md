# PolicyDecode - Chrome Extension (Manifest V3)

PolicyDecode is a lightweight, zero-dependency Chrome extension built with plain HTML, CSS, and JavaScript. It proactively detects Terms of Service, cancellation policies, refund policies, and checkout agreements, analyzes them in the background via the PolicyDecode backend API, and presents key risk flags before you click "Agree".

---

## Key Features & Architecture

- **Proactive Detection**: Automatically triggers on Terms/Policy pages, buttons/checkboxes containing "I agree" / "I accept", or checkout flows referencing policies.
- **Strict Non-Interference**: Never blocks, intercepts, delays, or auto-clicks any page button or user interaction.
- **Isolated Shadow DOM**: Alert card renders within an isolated Shadow DOM (`#policydecode-root`), ensuring host webpage styles cannot interfere with card styling.
- **Strict Content Security**: All API and page strings are inserted strictly using `textContent` and `document.createElement` (zero `innerHTML` usage).
- **Service Worker Background**: All network calls (`POST /analyze`, `GET /health`) run through `background.js` with an automated 28-second timeout.
- **Session Caching**: Analyzed results are cached per policy URL in `chrome.storage.session`, preventing duplicate network calls.
- **Security-Focused Design**: Dense, clean aesthetic with neutral dark gray palette, Inter typography, JetBrains Mono quote rendering, and risk colors (red/yellow/green) as the only accents.

---

## Directory Structure

```
extension/
├── manifest.json            # MV3 configuration, minimal permissions, host_permissions
├── config.js                # API base URL (http://localhost:3000) defined once
├── background.js            # Background service worker (API calls, timeouts, cache)
├── content.js               # Page detection & Shadow DOM alert card UI
├── popup.html               # Toolbar popup HTML
├── popup.css                # Dense, neutral popup styling
├── popup.js                 # Toolbar popup logic & health check
├── fonts/                   # Bundled local fonts
│   ├── Inter-Regular.woff2
│   ├── Inter-Medium.woff2
│   └── JetBrainsMono-Regular.woff2
├── icons/                   # Neutral extension icons (16, 32, 48, 128)
│   ├── icon16.png
│   ├── icon32.png
│   ├── icon48.png
│   └── icon128.png
└── README.md                # Documentation & testing guide
```

---

## Installation ("Load unpacked")

1. Open Google Chrome (or Microsoft Edge / Brave).
2. Navigate to `chrome://extensions/` (or `edge://extensions/`).
3. Enable **Developer mode** via the toggle switch in the upper-right corner.
4. Click **Load unpacked**.
5. Select the `extension` folder (`c:\projects\PolicyDecode\extension`).
6. The PolicyDecode extension icon will appear in your extensions toolbar. Pin it for quick access.

---

## Running the Backend

Ensure the PolicyDecode backend server is running on `http://localhost:3000`:

```bash
cd c:\projects\PolicyDecode\backend
npm install
npm start
```

Verify backend health at: [http://localhost:3000/health](http://localhost:3000/health) -> `{"ok":true}`.

---

## Testing & Verification Steps

### 1. Toolbar Popup & Backend Health
1. Click the PolicyDecode icon in your browser toolbar.
2. The popup displays the current page URL and backend status.
3. If the backend is running, the badge indicates `CONNECTED` in green. If the backend is stopped, it shows `OFFLINE`.
4. Click **Analyze this page** to analyze the current tab URL directly from the popup.

### 2. Terms Page Detection
1. Visit a policy page (e.g. `https://example.com/terms` or a terms document).
2. PolicyDecode detects the URL/heading and renders the alert card at the bottom-right of the window.
3. The card displays a loading spinner with `Analyzing policy...`.
4. Once completed, the card displays:
   - Overall risk badge: `HIGH RISK` (red), `MEDIUM RISK` (yellow), or `LOW RISK` (green).
   - Up to 3 priority flags (high to low severity) with categories (Refund, Auto-Renewal, Hidden Fee, Cancellation), explanations, and quotes in JetBrains Mono font.
   - Quote verification badge: `Quote found in policy` or `Quote not verified` (with unconfirmed dashed border styling).
   - If green or zero flags: displays `No major flags found` (never states that the policy is "safe").
   - Footer with `Open full policy` link and `Not legal advice` disclaimer.

### 3. Agreement & Checkout Trigger
1. Visit a checkout or signup page containing a checkbox or button with text like "I agree to the Terms of Service" or "Agree and continue".
2. The extension identifies the agreement trigger, scans page links to select the best matching policy URL (preferring terms > refund > cancellation), and launches analysis in the background without delaying user clicks.

### 4. Error & Timeout Handling
1. If the backend takes longer than 28 seconds or returns an error, the card transitions to an error state displaying the failure message and a **Retry** button.
2. Clicking **Retry** re-executes the analysis request.
3. Results for analyzed URLs are automatically saved to `chrome.storage.session` so revisiting the page reuses cached results immediately.
