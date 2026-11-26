const assert = require('assert');
const { calculateRisk, sortAndFilterFlags } = require('../services/risk');
const { normalizeText, verifyQuote, verifyFlags } = require('../services/verifyQuote');
const { isValidUrl, extractDomain, computeSha256, extractReadableText } = require('../services/fetchPolicy');
const { parseLlmResponse } = require('../services/llm');

console.log('--- Starting PolicyDecode Core Unit Tests ---');

// 1. Risk calculation tests
console.log('1. Testing Risk Calculation...');
assert.strictEqual(calculateRisk([]), 'green', 'Empty flags should be green');
assert.strictEqual(calculateRisk([{ severity: 'low' }]), 'green', 'Low only should be green');
assert.strictEqual(
  calculateRisk([{ severity: 'low' }, { severity: 'medium' }]),
  'yellow',
  'Medium should trigger yellow'
);
assert.strictEqual(
  calculateRisk([{ severity: 'low' }, { severity: 'medium' }, { severity: 'high' }]),
  'red',
  'High should trigger red'
);
assert.strictEqual(
  calculateRisk([{ severity: 'high' }]),
  'red',
  'High only should be red'
);

// 2. Flags sorting & limiting to top 3
console.log('2. Testing Flags Sorting & Limiting...');
const testFlags = [
  { severity: 'low', title: 'Low risk item 1' },
  { severity: 'high', title: 'High risk item 1' },
  { severity: 'medium', title: 'Medium risk item 1' },
  { severity: 'high', title: 'High risk item 2' },
  { severity: 'low', title: 'Low risk item 2' },
];
const sortedTop3 = sortAndFilterFlags(testFlags, 3);
assert.strictEqual(sortedTop3.length, 3, 'Must return at most 3 flags');
assert.strictEqual(sortedTop3[0].severity, 'high', 'First flag must be high severity');
assert.strictEqual(sortedTop3[1].severity, 'high', 'Second flag must be high severity');
assert.strictEqual(sortedTop3[2].severity, 'medium', 'Third flag must be medium severity');

// 3. Quote Verification tests
console.log('3. Testing Quote Normalization & Verification...');
const samplePolicy = `
  Welcome to Acme Cloud.
  All fees paid hereunder are NON-REFUNDABLE under any circumstances.
  Subscriptions automatically renew for successive 1-year terms unless cancelled at least 30 days prior.
  Cancellation requests must be submitted by physical mail.
`;

const exactQuote = 'All fees paid hereunder are NON-REFUNDABLE under any circumstances.';
assert.strictEqual(verifyQuote(exactQuote, samplePolicy), true, 'Exact quote must verify');

const whitespaceAndCaseVariation = 'all  fees paid  hereunder are non-refundable   under any circumstances.';
assert.strictEqual(verifyQuote(whitespaceAndCaseVariation, samplePolicy), true, 'Whitespace and case variations must verify');

const fakeQuote = 'You can get a full refund anytime you ask our support team.';
assert.strictEqual(verifyQuote(fakeQuote, samplePolicy), false, 'Invented quote must not verify');

const flaggedList = [
  { category: 'refund', severity: 'high', title: 'No Refunds', quote: exactQuote },
  { category: 'refund', severity: 'low', title: 'Made up', quote: fakeQuote },
];
const verifiedResults = verifyFlags(flaggedList, samplePolicy);
assert.strictEqual(verifiedResults.length, 2, 'Flags list must never drop unverified flags');
assert.strictEqual(verifiedResults[0].verified, true, 'First flag should be verified');
assert.strictEqual(verifiedResults[1].verified, false, 'Second flag should be unverified');

// 4. URL Validation & HTML Extraction tests
console.log('4. Testing URL Validation & HTML Scraping...');
assert.strictEqual(isValidUrl('https://example.com/terms'), true, 'https URL must be valid');
assert.strictEqual(isValidUrl('http://sub.domain.org/policy?v=1'), true, 'http URL must be valid');
assert.strictEqual(isValidUrl('ftp://example.com'), false, 'ftp URL must be rejected');
assert.strictEqual(isValidUrl('not-a-url'), false, 'Plain string must be rejected');
assert.strictEqual(isValidUrl(''), false, 'Empty string must be rejected');

assert.strictEqual(extractDomain('https://app.example.com/legal/tos'), 'app.example.com');

const testHtml = `
  <!DOCTYPE html>
  <html>
    <head>
      <title>Terms</title>
      <style>body { color: red; }</style>
    </head>
    <body>
      <nav><a href="/">Home</a></nav>
      <header><h1>Header Bar</h1></header>
      <main>
        <h2>Subscription Policy</h2>
        <p>Your subscription will automatically renew each month.</p>
      </main>
      <script>console.log("tracking code");</script>
      <footer>Footer navigation links</footer>
    </body>
  </html>
`;

const cleanedText = extractReadableText(testHtml);
assert.ok(!cleanedText.includes('console.log'), 'Scripts must be removed');
assert.ok(!cleanedText.includes('body { color: red; }'), 'Styles must be removed');
assert.ok(!cleanedText.includes('Home'), 'Nav must be removed');
assert.ok(!cleanedText.includes('Footer navigation links'), 'Footer must be removed');
assert.ok(cleanedText.includes('Subscription Policy'), 'Main content must be preserved');
assert.ok(cleanedText.includes('Your subscription will automatically renew each month.'), 'Paragraph must be preserved');

const hash1 = computeSha256(cleanedText);
const hash2 = computeSha256(cleanedText);
assert.strictEqual(hash1, hash2, 'SHA-256 must be deterministic');
assert.strictEqual(hash1.length, 64, 'SHA-256 hex string must be 64 characters');

// 5. LLM Response Parser tests
console.log('5. Testing LLM Response Parser & Fallbacks...');
const validLlmJson = JSON.stringify({
  flags: [
    {
      category: 'auto_renew',
      severity: 'high',
      title: 'Auto-renewal without reminder',
      explanation: 'Your card will be billed automatically every year.',
      quote: 'Subscriptions automatically renew for successive 1-year terms',
    },
  ],
});
const parsed = parseLlmResponse(validLlmJson);
assert.strictEqual(parsed.length, 1);
assert.strictEqual(parsed[0].category, 'auto_renew');
assert.strictEqual(parsed[0].severity, 'high');

// Markdown code fence wrapped JSON
const markdownWrappedJson = `\`\`\`json\n${validLlmJson}\n\`\`\``;
const parsedMarkdown = parseLlmResponse(markdownWrappedJson);
assert.strictEqual(parsedMarkdown.length, 1);
assert.strictEqual(parsedMarkdown[0].title, 'Auto-renewal without reminder');

// Invalid category filtering
const invalidCategoryJson = JSON.stringify({
  flags: [
    {
      category: 'arbitrary_fake_category',
      severity: 'high',
      title: 'Fake',
      explanation: 'Fake',
      quote: 'Fake',
    },
  ],
});
assert.strictEqual(parseLlmResponse(invalidCategoryJson).length, 0, 'Invalid category must be filtered out');

// Malformed JSON error check
assert.throws(() => {
  parseLlmResponse('This is not json at all');
}, /Invalid JSON syntax/, 'Malformed JSON should throw an error');

console.log('All Core Unit Tests Passed Successfully!');
