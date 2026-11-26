const assert = require('assert');
const http = require('http');
process.env.NODE_ENV = 'test';
const { app } = require('../server');

async function runServerTests() {
  console.log('--- Starting Server & Endpoint Tests ---');

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://localhost:${port}`;

  try {
    // 1. GET /health
    console.log('1. Testing GET /health...');
    const healthRes = await fetch(`${baseUrl}/health`);
    assert.strictEqual(healthRes.status, 200);
    const healthJson = await healthRes.json();
    assert.deepStrictEqual(healthJson, { ok: true });

    // 2. POST /analyze with missing body
    console.log('2. Testing POST /analyze with missing URL...');
    const noUrlRes = await fetch(`${baseUrl}/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.strictEqual(noUrlRes.status, 400);
    const noUrlJson = await noUrlRes.json();
    assert.ok(noUrlJson.error.includes('url'));

    // 3. POST /analyze with invalid URL
    console.log('3. Testing POST /analyze with invalid URL...');
    const invalidUrlRes = await fetch(`${baseUrl}/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'not-a-valid-http-url' }),
    });
    assert.strictEqual(invalidUrlRes.status, 400);
    const invalidUrlJson = await invalidUrlRes.json();
    assert.ok(invalidUrlJson.error.includes('Invalid URL'));

    // 4. Test CORS headers for chrome-extension origin
    console.log('4. Testing CORS for chrome-extension://...');
    const extensionOrigin = 'chrome-extension://abcdefghijklmnopqrstuvwxyz123456';
    const corsRes = await fetch(`${baseUrl}/health`, {
      headers: { Origin: extensionOrigin },
    });
    assert.strictEqual(corsRes.headers.get('access-control-allow-origin'), extensionOrigin);

    // 5. Test CORS for localhost origin
    console.log('5. Testing CORS for localhost...');
    const localOrigin = 'http://localhost:5173';
    const localCorsRes = await fetch(`${baseUrl}/health`, {
      headers: { Origin: localOrigin },
    });
    assert.strictEqual(localCorsRes.headers.get('access-control-allow-origin'), localOrigin);

    console.log('All Server & Endpoint Tests Passed Successfully!');
  } finally {
    server.close();
  }
}

runServerTests().catch((err) => {
  console.error('Server tests failed:', err);
  process.exit(1);
});
