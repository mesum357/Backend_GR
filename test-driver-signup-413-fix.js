/**
 * Verifies driver-signup payload handling fixes:
 * 1) Oversized JSON body returns HTTP 413 with JSON error/message.
 * 2) Normal-sized invalid body returns JSON (not malformed/non-JSON).
 *
 * Usage:
 *   node test-driver-signup-413-fix.js
 *   BASE_URL=http://localhost:8080 node test-driver-signup-413-fix.js
 */

const BASE_URL = (process.env.BASE_URL || 'http://localhost:8080').replace(/\/+$/, '');
const REGISTER_URL = `${BASE_URL}/api/auth/register`;

function buildDataUriOfApproxBytes(byteCount) {
  // We only need a large string payload to trigger request-size limits.
  // Base64 chars are ~1 byte each in JSON body.
  const payload = 'A'.repeat(Math.max(0, byteCount));
  return `data:image/jpeg;base64,${payload}`;
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }

  return { status: res.status, ok: res.ok, text, json };
}

async function testOversizedPayloadReturns413Json() {
  // ~22 MB one field should exceed current backend 20 MB JSON parser limit.
  const hugeDataUri = buildDataUriOfApproxBytes(22 * 1024 * 1024);
  const body = { profileImage: hugeDataUri };

  const result = await postJson(REGISTER_URL, body);
  if (result.status !== 413) {
    throw new Error(`Expected 413 for oversized payload, got ${result.status}. Body: ${result.text.slice(0, 300)}`);
  }
  if (!result.json || typeof result.json !== 'object') {
    throw new Error(`Expected JSON body for 413 response, got non-JSON: ${result.text.slice(0, 300)}`);
  }
  const msg = String(result.json.message || '');
  if (!/too large/i.test(msg)) {
    throw new Error(`Expected 413 JSON message to mention size/too large. Got: ${JSON.stringify(result.json)}`);
  }
  console.log('PASS 1/2: Oversized signup payload returns JSON 413 with clear message.');
}

async function testNormalPayloadReturnsJsonError() {
  // Intentionally invalid (missing required fields) but small payload.
  const body = {
    userType: 'driver',
    email: 'invalid-driver-test@example.com',
  };

  const result = await postJson(REGISTER_URL, body);
  if (result.status < 400 || result.status >= 500) {
    throw new Error(`Expected client validation error (4xx), got ${result.status}. Body: ${result.text.slice(0, 300)}`);
  }
  if (!result.json || typeof result.json !== 'object') {
    throw new Error(`Expected JSON body for normal invalid request, got non-JSON: ${result.text.slice(0, 300)}`);
  }
  console.log(`PASS 2/2: Normal invalid signup returns JSON (${result.status}), not malformed response.`);
}

async function run() {
  console.log(`Testing driver signup 413 fix against: ${REGISTER_URL}`);
  await testOversizedPayloadReturns413Json();
  await testNormalPayloadReturnsJsonError();
  console.log('All checks passed.');
}

run().catch((err) => {
  console.error('FAIL:', err.message || err);
  process.exit(1);
});

