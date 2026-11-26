require('dotenv').config();
const express = require('express');
const cors = require('cors');

const analyzeRouter = require('./routes/analyze');

const app = express();
const PORT = process.env.PORT || 3000;

// Configure CORS for chrome-extension:// origins and localhost
const corsOptions = {
  origin: (origin, callback) => {
    // Allow non-browser requests (e.g., curl, Postman, server-to-server)
    if (!origin || (process.env.ALLOWED_ORIGINS || '').split(',').includes(origin)) {
      return callback(null, true);
    }

    // Allow localhost (http/https on any port) and 127.0.0.1
    const isLocalhost = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);

    // Allow Chrome Extension origins
    const isChromeExtension = origin.startsWith('chrome-extension://');

    if (isLocalhost || isChromeExtension) {
      return callback(null, true);
    }

    return callback(new Error(`Origin '${origin}' not allowed by CORS`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
};

app.use(cors(corsOptions));
app.use(express.json({ limit: '2mb' }));

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ ok: true });
});

// Mount /analyze route
app.use('/', analyzeRouter);

// Centralized error handling middleware
app.use((err, req, res, next) => {
  const status = err.status || 500;
  const message = err.message || 'Internal Server Error';

  console.error(`[PolicyDecode Error] ${req.method} ${req.originalUrl} (${status}): ${message}`);

  res.status(status).json({
    error: message,
  });
});

let server;
if (process.env.NODE_ENV !== 'test') {
  server = app.listen(PORT, () => {
    console.log(`[PolicyDecode Backend] Server running on http://localhost:${PORT}`);
    console.log(`[PolicyDecode Backend] Health check: http://localhost:${PORT}/health`);
    console.log(`[PolicyDecode Backend] Analyze endpoint: POST http://localhost:${PORT}/analyze`);
  });
}

module.exports = { app, server };
