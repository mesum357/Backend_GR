/**
 * GB RIDES — Slow Network & Payload Optimization Audit
 * =====================================================
 * Tests how well the app handles slow/poor connections.
 * Measures: payload sizes, compression, timeouts, reconnection,
 * large-response risks, and socket reliability under delay.
 *
 * Run:  node test-slow-network-audit.js
 */

const fetch = require('node-fetch').default || require('node-fetch');
const io = require('socket.io-client');
const zlib = require('zlib');

const BASE_URL = (process.argv[2] || process.env.TEST_BASE_URL || 'https://api.mesumabbas.online').replace(/\/+$/, '');
const RIDER_EMAIL    = process.env.TEST_RIDER_EMAIL  || 'seimughal@gmail.com';
const RIDER_PASSWORD = process.env.TEST_RIDER_PASS   || '123456';
const DRIVER_EMAIL   = process.env.TEST_DRIVER_EMAIL || 'junaid@gmail.com';
const DRIVER_PASSWORD= process.env.TEST_DRIVER_PASS  || '123456';

const PICKUP = { latitude: 35.9208, longitude: 74.3144, address: 'Gilgit City Center' };
const DEST   = { latitude: 35.9350, longitude: 74.3300, address: 'Jutial, Gilgit' };

// ─── Logging ────────────────────────────────────────────────────────────────
const PASS = (m) => console.log(`  \x1b[32m✅  ${m}\x1b[0m`);
const FAIL = (m) => console.log(`  \x1b[31m❌  ${m}\x1b[0m`);
const WARN = (m) => console.log(`  \x1b[33m⚠️   ${m}\x1b[0m`);
const INFO = (m) => console.log(`  \x1b[36mℹ️   ${m}\x1b[0m`);
const HEAD = (m) => console.log(`\n\x1b[1m${'─'.repeat(70)}\n  ${m}\n${'─'.repeat(70)}\x1b[0m`);

let passed = 0, failed = 0, warnings = 0;
const issues = [];
const metrics = {};

function ok(label, cond, detail = '') {
  if (cond) { PASS(label); passed++; } else { FAIL(`${label}${detail ? ' — ' + detail : ''}`); failed++; }
  return cond;
}
function warn(label, detail = '') { WARN(`${label}${detail ? ' — ' + detail : ''}`); warnings++; issues.push({ severity: 'warning', label, detail }); }
function issue(sev, label, detail = '') { issues.push({ severity: sev, label, detail }); }
function metric(label, value, unit = '') { metrics[label] = { value, unit }; }

function formatBytes(b) {
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1048576).toFixed(2)} MB`;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── HTTP with size tracking ────────────────────────────────────────────────
async function httpRaw(method, url, body, token, timeoutMs = 20000) {
  const headers = { 'Content-Type': 'application/json', 'Accept-Encoding': 'gzip, deflate' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const opts = { method, headers };
  if (body && method !== 'GET') opts.body = JSON.stringify(body);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const t0 = Date.now();

  try {
    const res = await fetch(url, { ...opts, signal: controller.signal, compress: true });
    const elapsed = Date.now() - t0;
    const buf = await res.buffer();
    const rawSize = buf.length;
    let jsonStr;
    try { jsonStr = buf.toString('utf-8'); } catch { jsonStr = '{}'; }
    let data; try { data = JSON.parse(jsonStr); } catch { data = {}; }

    const contentEncoding = res.headers.get('content-encoding') || 'none';
    let uncompressedSize = rawSize;
    if (contentEncoding === 'gzip') {
      try { uncompressedSize = zlib.gunzipSync(buf).length; } catch { uncompressedSize = rawSize; }
    } else if (contentEncoding === 'deflate') {
      try { uncompressedSize = zlib.inflateSync(buf).length; } catch { uncompressedSize = rawSize; }
    } else {
      uncompressedSize = JSON.stringify(data).length || rawSize;
    }

    return {
      status: res.status, ok: res.ok, data, elapsed,
      rawSize, uncompressedSize, contentEncoding,
      compressionRatio: uncompressedSize > 0 ? (rawSize / uncompressedSize * 100).toFixed(1) : '100',
    };
  } catch (e) {
    return { status: 0, ok: false, data: {}, elapsed: Date.now() - t0, error: e.message, rawSize: 0, uncompressedSize: 0, contentEncoding: 'none', compressionRatio: '0' };
  } finally {
    clearTimeout(timeout);
  }
}

const httpGet  = (u, t, ms) => httpRaw('GET', u, null, t, ms);
const httpPost = (u, b, t, ms) => httpRaw('POST', u, b, t, ms);

// ─── Socket helpers ─────────────────────────────────────────────────────────
function connectSocket(label, opts = {}) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const s = io(BASE_URL, {
      transports: opts.transports || ['polling', 'websocket'],
      timeout: 15000, forceNew: true,
    });
    s.on('connect', () => { resolve({ socket: s, elapsed: Date.now() - t0 }); });
    s.on('connect_error', (e) => reject(new Error(`${label} socket: ${e.message}`)));
    setTimeout(() => reject(new Error(`${label} socket timeout 15s`)), 15000);
  });
}
function waitOrNull(socket, ev, ms = 8000) {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), ms);
    socket.once(ev, (d) => { clearTimeout(t); resolve(d); });
  });
}

// ─── MAIN ───────────────────────────────────────────────────────────────────
async function run() {
  console.log('\n\x1b[1m🌐  GB RIDES — Slow Network & Payload Optimization Audit\x1b[0m');
  console.log(`    Backend: ${BASE_URL}`);
  console.log(`    ${new Date().toISOString()}\n`);

  let riderToken, driverToken, riderId, driverId;

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 1: AUTH + BASELINE LATENCY
  // ═══════════════════════════════════════════════════════════════════════════
  HEAD('PHASE 1 — Baseline Latency & Auth');

  // 1.1 Multiple health pings to measure baseline RTT
  const rtts = [];
  for (let i = 0; i < 5; i++) {
    const r = await httpGet(`${BASE_URL}/api/health`);
    rtts.push(r.elapsed);
    await sleep(200);
  }
  const avgRtt = Math.round(rtts.reduce((a, b) => a + b, 0) / rtts.length);
  const minRtt = Math.min(...rtts);
  const maxRtt = Math.max(...rtts);
  const jitter = maxRtt - minRtt;
  metric('Avg RTT (health)', avgRtt, 'ms');
  metric('RTT jitter', jitter, 'ms');
  INFO(`RTT: avg=${avgRtt}ms min=${minRtt}ms max=${maxRtt}ms jitter=${jitter}ms`);

  if (avgRtt > 1000) issue('performance', `High baseline latency: ${avgRtt}ms`, 'Server response time is inherently slow — all UX will suffer');
  if (jitter > 500) issue('performance', `High jitter: ${jitter}ms`, 'Inconsistent latency makes timeout tuning difficult');

  // 1.2 Auth
  let r = await httpPost(`${BASE_URL}/api/auth/login`, { email: RIDER_EMAIL, password: RIDER_PASSWORD, expectedUserType: 'rider' });
  if (r.ok) {
    riderToken = r.data.token; riderId = r.data.user?._id || r.data.user?.id;
    ok('1.1 Rider login', true);
    metric('Login payload', r.rawSize, 'bytes');
    INFO(`Login response: ${formatBytes(r.rawSize)} (${r.contentEncoding})`);
  } else { FAIL('1.1 Rider login failed'); failed++; return printReport(); }

  r = await httpPost(`${BASE_URL}/api/auth/login`, { email: DRIVER_EMAIL, password: DRIVER_PASSWORD, expectedUserType: 'driver' });
  if (r.ok) {
    driverToken = r.data.token; driverId = r.data.user?._id || r.data.user?.id;
    ok('1.2 Driver login', true);
  } else { warn('1.2 Driver login failed'); }

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 2: RESPONSE PAYLOAD SIZES
  // ═══════════════════════════════════════════════════════════════════════════
  HEAD('PHASE 2 — Response Payload Sizes');

  const endpoints = [
    { label: 'Health check',           url: '/api/health',                    token: null,        maxKB: 1 },
    { label: 'Rider profile',          url: '/api/auth/profile',              token: riderToken,  maxKB: 5 },
    { label: 'Driver profile',         url: '/api/drivers/profile',           token: driverToken, maxKB: 10 },
    { label: 'Ride history (page 1)',   url: '/api/rides/history?page=1&limit=10', token: riderToken, maxKB: 50 },
    { label: 'Driver wallet balance',  url: '/api/driver/wallet/balance',     token: driverToken, maxKB: 5 },
    { label: 'Wallet transactions',    url: '/api/driver/wallet/transactions?page=1&limit=20', token: driverToken, maxKB: 50 },
    { label: 'Wallet income summary',  url: '/api/driver/wallet/income-summary', token: driverToken, maxKB: 10 },
  ];

  for (const ep of endpoints) {
    if (!ep.token && ep.token !== null) continue;
    const result = await httpGet(`${BASE_URL}${ep.url}`, ep.token);
    const sizeKB = result.rawSize / 1024;
    const label = `${ep.label}: ${formatBytes(result.rawSize)}`;

    metric(`Payload: ${ep.label}`, result.rawSize, 'bytes');

    if (result.ok) {
      if (sizeKB > ep.maxKB) {
        warn(label, `Exceeds ${ep.maxKB}KB target for mobile`);
        issue('payload', `${ep.label} is ${formatBytes(result.rawSize)}`, `Target <${ep.maxKB}KB. Elapsed: ${result.elapsed}ms`);
      } else {
        ok(label, true);
      }
    } else {
      INFO(`${ep.label}: ${result.status} (skipped)`);
    }
    INFO(`  Compressed: ${formatBytes(result.rawSize)} | Encoding: ${result.contentEncoding} | Time: ${result.elapsed}ms`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 3: COMPRESSION CHECK
  // ═══════════════════════════════════════════════════════════════════════════
  HEAD('PHASE 3 — Compression Effectiveness');

  // Fetch with and without Accept-Encoding to compare
  const compressedR = await httpGet(`${BASE_URL}/api/rides/history?page=1&limit=10`, riderToken);
  const noCompHeaders = { 'Content-Type': 'application/json' };
  if (riderToken) noCompHeaders['Authorization'] = `Bearer ${riderToken}`;
  const noCompController = new AbortController();
  const noCompTimeout = setTimeout(() => noCompController.abort(), 20000);
  let uncompressedR;
  try {
    const raw = await fetch(`${BASE_URL}/api/rides/history?page=1&limit=10`, {
      headers: { ...noCompHeaders, 'Accept-Encoding': 'identity' },
      signal: noCompController.signal, compress: false,
    });
    const buf = await raw.buffer();
    uncompressedR = { rawSize: buf.length, contentEncoding: raw.headers.get('content-encoding') || 'none' };
  } catch { uncompressedR = { rawSize: compressedR.rawSize, contentEncoding: 'error' }; }
  clearTimeout(noCompTimeout);

  const savings = uncompressedR.rawSize > 0
    ? ((1 - compressedR.rawSize / uncompressedR.rawSize) * 100).toFixed(1)
    : 0;
  INFO(`Ride history: compressed=${formatBytes(compressedR.rawSize)} (${compressedR.contentEncoding}) | uncompressed=${formatBytes(uncompressedR.rawSize)} (${uncompressedR.contentEncoding})`);
  INFO(`Compression savings: ${savings}%`);
  metric('Compression savings', savings, '%');

  if (compressedR.contentEncoding === 'none' && uncompressedR.contentEncoding === 'none') {
    issue('performance', 'Gzip compression NOT active', 'Server should return Content-Encoding: gzip. Check compression() middleware order.');
  } else if (parseFloat(savings) > 0) {
    ok(`3.1 Gzip active (${savings}% savings)`, true);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 4: LARGE PAYLOAD RISKS
  // ═══════════════════════════════════════════════════════════════════════════
  HEAD('PHASE 4 — Large Payload & Unbounded Response Risks');

  // 4.1 Check wallet transactions for base64 proof images
  if (driverToken) {
    const txR = await httpGet(`${BASE_URL}/api/driver/wallet/transactions?page=1&limit=5`, driverToken);
    if (txR.ok && txR.data?.transactions) {
      let hasBase64 = false;
      for (const tx of txR.data.transactions) {
        const proof = tx?.paymentDetails?.proofImage;
        if (proof && typeof proof === 'string' && proof.length > 500) {
          hasBase64 = true;
          issue('payload', `Wallet transaction contains proofImage (${formatBytes(proof.length)})`,
            'GET /transactions returns base64 screenshots. Strip proofImage like /balance does.');
          break;
        }
      }
      if (!hasBase64) ok('4.1 Wallet transactions: no large proofImage in response', true);
    } else {
      INFO('4.1 Wallet transactions: could not check (no data)');
    }
  }

  // 4.2 Check if ride history includes large polylines
  if (riderToken) {
    const histR = await httpGet(`${BASE_URL}/api/rides/history?page=1&limit=5`, riderToken);
    if (histR.ok) {
      ok(`4.2 Ride history payload: ${formatBytes(histR.rawSize)}`, histR.rawSize < 100 * 1024,
        `${formatBytes(histR.rawSize)} for 5 rides is too large`);
    }
  }

  // 4.3 Check unpaginated endpoints
  const unpaginatedChecks = [
    { label: 'Available rides (driver)',      url: '/api/rides/available',          token: driverToken },
  ];
  for (const ep of unpaginatedChecks) {
    if (!ep.token) continue;
    const result = await httpGet(`${BASE_URL}${ep.url}`, ep.token);
    if (result.ok) {
      const count = Array.isArray(result.data?.rides) ? result.data.rides.length : '?';
      INFO(`${ep.label}: ${count} items, ${formatBytes(result.rawSize)}`);
      if (result.rawSize > 100 * 1024) {
        issue('payload', `${ep.label} is ${formatBytes(result.rawSize)}`, 'Unbounded — add pagination or limit');
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 5: TIMEOUT & ABORT BEHAVIOR
  // ═══════════════════════════════════════════════════════════════════════════
  HEAD('PHASE 5 — Timeout & Abort Handling');

  // 5.1 Test with very short timeout (simulating slow network)
  const shortR = await httpGet(`${BASE_URL}/api/rides/history?page=1&limit=10`, riderToken, 100);
  if (shortR.error && shortR.error.includes('abort')) {
    ok('5.1 100ms timeout correctly aborts', true);
    metric('Abort handling', 'works', '');
  } else if (shortR.ok) {
    INFO('5.1 Server responded within 100ms (very fast network — timeout test inconclusive)');
  } else {
    ok('5.1 Short timeout handled', !!shortR.error);
  }

  // 5.2 Test with realistic slow timeout (3s)
  const slowR = await httpGet(`${BASE_URL}/api/rides/history?page=1&limit=10`, riderToken, 3000);
  if (slowR.ok) {
    ok(`5.2 Response within 3s: ${slowR.elapsed}ms`, slowR.elapsed < 3000);
  } else {
    warn('5.2 Ride history did NOT respond within 3s', `${slowR.elapsed}ms — problematic for 3G users`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 6: WEBSOCKET UNDER LATENCY
  // ═══════════════════════════════════════════════════════════════════════════
  HEAD('PHASE 6 — WebSocket Performance');

  // 6.1 Connect with polling-first (default)
  try {
    const { socket: pollingSocket, elapsed: pollingMs } = await connectSocket('Polling-first');
    metric('Socket connect (polling+ws)', pollingMs, 'ms');
    INFO(`Polling-first connect: ${pollingMs}ms`);
    if (pollingMs > 3000) warn('6.1 Polling-first socket connect >3s', `${pollingMs}ms`);
    else ok('6.1 Polling-first socket connect', true);
    pollingSocket.disconnect();
  } catch (e) { warn(`6.1 Polling socket: ${e.message}`); }

  // 6.2 Connect with websocket-only (faster but less reliable)
  try {
    const { socket: wsSocket, elapsed: wsMs } = await connectSocket('WS-only', { transports: ['websocket'] });
    metric('Socket connect (ws-only)', wsMs, 'ms');
    INFO(`WebSocket-only connect: ${wsMs}ms`);
    if (wsMs > 2000) warn('6.2 WS-only socket connect >2s', `${wsMs}ms`);
    else ok('6.2 WebSocket-only connect', true);
    wsSocket.disconnect();
  } catch (e) { warn(`6.2 WS-only socket: ${e.message}`); }

  // 6.3 Socket event round-trip with authentication
  let riderSocket, driverSocket;
  try {
    const { socket: rs } = await connectSocket('Rider');
    const { socket: ds } = await connectSocket('Driver');
    riderSocket = rs; driverSocket = ds;

    rs.emit('authenticate', { userId: riderId, userType: 'rider' });
    ds.emit('authenticate', { userId: driverId, userType: 'driver' });
    await sleep(500);

    // Measure event relay latency
    const relayPromise = new Promise((resolve) => {
      const t0 = Date.now();
      riderSocket.once('ride_live_location', () => resolve(Date.now() - t0));
      setTimeout(() => resolve(null), 5000);
    });
    driverSocket.emit('ride_live_location', {
      rideRequestId: 'latency-test', senderId: driverId, senderType: 'driver',
      latitude: 35.92, longitude: 74.31, heading: 0,
    });
    const relayMs = await relayPromise;
    if (relayMs !== null) {
      metric('Socket event relay', relayMs, 'ms');
      INFO(`Socket event relay latency: ${relayMs}ms`);
      ok('6.3 Socket event relay <1s', relayMs < 1000, `${relayMs}ms`);
    } else {
      INFO('6.3 Socket relay timed out (may need active ride)');
    }
  } catch (e) { warn(`6.3: ${e.message}`); }

  // 6.4 Socket duplicate emit check
  if (riderSocket && driverId) {
    let dupeCount = 0;
    const dupeHandler = () => { dupeCount++; };
    riderSocket.on('ride_live_location', dupeHandler);
    if (driverSocket) {
      driverSocket.emit('ride_live_location', {
        rideRequestId: 'dupe-test', senderId: driverId, senderType: 'driver',
        latitude: 35.921, longitude: 74.312, heading: 90,
      });
    }
    await sleep(2000);
    riderSocket.off('ride_live_location', dupeHandler);
    if (dupeCount > 1) {
      issue('performance', `Socket duplicate delivery: ${dupeCount}x for one emit`,
        'emitToUser sends to user room + socket ID. Remove duplicate path.');
    } else if (dupeCount === 1) {
      ok('6.4 No duplicate socket delivery', true);
    } else {
      INFO('6.4 No relay received (needs active ride context)');
    }
  }

  // Cleanup sockets
  if (riderSocket) riderSocket.disconnect();
  if (driverSocket) driverSocket.disconnect();

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 7: RIDE FLOW ON SLOW NETWORK
  // ═══════════════════════════════════════════════════════════════════════════
  HEAD('PHASE 7 — Full Ride Flow Timing (simulated slow network conditions)');

  if (riderToken && driverToken) {
    const { socket: rs2 } = await connectSocket('Rider');
    const { socket: ds2 } = await connectSocket('Driver');
    rs2.emit('authenticate', { userId: riderId, userType: 'rider' });
    ds2.emit('authenticate', { userId: driverId, userType: 'driver' });
    await sleep(500);

    // Update driver location
    await httpPost(`${BASE_URL}/api/drivers/location`,
      { latitude: PICKUP.latitude + 0.003, longitude: PICKUP.longitude + 0.003 }, driverToken);

    const flowTimings = {};
    const flowT0 = Date.now();

    // Create ride request
    let rideRequestId;
    const t1 = Date.now();
    const createR = await httpPost(`${BASE_URL}/api/ride-requests/request-ride`, {
      pickup: PICKUP, destination: DEST,
      offeredFare: 200, radiusMeters: 5000,
      paymentMethod: 'cash', vehicleType: 'ride_mini',
    }, riderToken);
    flowTimings['Create ride'] = Date.now() - t1;

    if (createR.status === 201) {
      rideRequestId = createR.data?.rideRequest?.id;

      // Wait for driver socket event
      const driverReq = await waitOrNull(ds2, 'ride_request', 8000);
      flowTimings['Driver notified'] = Date.now() - t1;

      if (rideRequestId && driverReq) {
        // Driver accepts
        const fareOfferP = waitOrNull(rs2, 'fare_offer', 12000);
        const t2 = Date.now();
        await httpPost(`${BASE_URL}/api/ride-requests/${rideRequestId}/respond`,
          { action: 'accept', counterOffer: null }, driverToken);
        const fo = await fareOfferP;
        flowTimings['Fare offer to rider'] = Date.now() - t2;

        if (fo) {
          // Rider accepts
          const assignedP = waitOrNull(rs2, 'driver_assigned', 10000);
          const t3 = Date.now();
          rs2.emit('fare_response', { rideRequestId, riderId, driverId, action: 'accept', timestamp: Date.now() });
          await assignedP;
          flowTimings['Driver assigned'] = Date.now() - t3;

          // Start + end ride
          const startP = waitOrNull(rs2, 'ride_started', 8000);
          const t4 = Date.now();
          ds2.emit('start_ride', { rideRequestId, driverId });
          await startP;
          flowTimings['Ride started'] = Date.now() - t4;

          const endP = waitOrNull(rs2, 'ride_completed', 10000);
          const t5 = Date.now();
          ds2.emit('end_ride', { rideRequestId, driverId });
          await endP;
          flowTimings['Ride completed'] = Date.now() - t5;
        }
      }
    }

    flowTimings['Total flow'] = Date.now() - flowT0;

    INFO('Ride flow step timings:');
    for (const [step, ms] of Object.entries(flowTimings)) {
      const c = ms < 500 ? '\x1b[32m' : ms < 2000 ? '\x1b[33m' : '\x1b[31m';
      console.log(`    ${c}${String(ms).padStart(6)}ms\x1b[0m  ${step}`);
      metric(`Flow: ${step}`, ms, 'ms');
    }

    const totalFlow = flowTimings['Total flow'] || 0;
    if (totalFlow > 15000) {
      issue('performance', `Full ride flow takes ${(totalFlow / 1000).toFixed(1)}s`,
        'On 3G (500ms RTT), this could be 30s+. Optimize critical path.');
    }
    ok('7.1 Full ride flow completes', totalFlow > 0 && totalFlow < 30000, `${totalFlow}ms`);

    rs2.disconnect();
    ds2.disconnect();
  } else {
    INFO('Skipping Phase 7 (need both tokens)');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 8: SLOW NETWORK SCORE
  // ═══════════════════════════════════════════════════════════════════════════
  HEAD('PHASE 8 — Slow Network Readiness Score');

  const scoreItems = [];

  // Compression
  const compressionActive = compressedR.contentEncoding !== 'none';
  scoreItems.push({ name: 'Gzip compression', score: compressionActive ? 10 : 0, max: 10 });

  // Payload sizes (all checked endpoints under target)
  const payloadWarnings = issues.filter(i => i.severity === 'payload').length;
  scoreItems.push({ name: 'Payload optimization', score: Math.max(0, 15 - payloadWarnings * 5), max: 15 });

  // WebSocket reconnection logic exists (from code review)
  scoreItems.push({ name: 'WS reconnect + critical queue', score: 10, max: 10 });

  // Adaptive network tier system exists
  scoreItems.push({ name: 'Adaptive network (RTT tier)', score: 10, max: 10 });

  // HTTP timeout + retry exists
  scoreItems.push({ name: 'HTTP timeout + retry', score: 8, max: 10 });

  // Directions cache exists
  scoreItems.push({ name: 'Google Directions cache', score: 10, max: 10 });

  // React Query not used despite being installed
  scoreItems.push({ name: 'React Query caching', score: 0, max: 10 });

  // Offline REST queue missing
  scoreItems.push({ name: 'Offline REST queue', score: 0, max: 10 });

  // Image optimization missing (no expo-image)
  scoreItems.push({ name: 'Image optimization (expo-image)', score: 0, max: 10 });

  // No lazy-loaded screens
  scoreItems.push({ name: 'Lazy-loaded screens', score: 0, max: 5 });

  const totalScore = scoreItems.reduce((a, i) => a + i.score, 0);
  const maxScore = scoreItems.reduce((a, i) => a + i.max, 0);
  const pct = ((totalScore / maxScore) * 100).toFixed(0);

  console.log(`\n  \x1b[1mSlow Network Readiness: ${totalScore}/${maxScore} (${pct}%)\x1b[0m\n`);
  for (const item of scoreItems) {
    const bar = item.score === item.max ? '\x1b[32m' : item.score > 0 ? '\x1b[33m' : '\x1b[31m';
    console.log(`    ${bar}${String(item.score).padStart(2)}/${item.max}\x1b[0m  ${item.name}`);
  }
  metric('Slow Network Score', `${totalScore}/${maxScore}`, `(${pct}%)`);

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 9: CODE-LEVEL ISSUES SUMMARY
  // ═══════════════════════════════════════════════════════════════════════════
  HEAD('PHASE 9 — Code-Level Findings for Slow Networks');

  issue('performance', 'emitToUser() double-emits to room + socketId',
    'FIX in server.js: Remove socketId emit — user room alone is sufficient after socket.join().');

  issue('performance', 'GET /transactions returns proofImage base64',
    'FIX in driverWallet.js: Strip proofImage from /transactions like /balance already does.');

  issue('performance', 'React Query installed but unused',
    'FIX: Wrap API calls with useQuery() for automatic caching, stale-while-revalidate, and retry with backoff.');

  issue('performance', 'No expo-image for optimized image loading',
    'FIX: Replace react-native Image with expo-image for disk caching, blurhash placeholders, and progressive loading.');

  issue('performance', 'No offline REST queue for failed POST/PUT',
    'FIX: Queue failed mutations (ride requests, ratings) in AsyncStorage and retry when online.');

  issue('performance', 'GET /rides/available has no pagination',
    'FIX in rides.js: Add .limit(20) and pagination params.');

  issue('performance', 'No production retry for fetch() network errors',
    'FIX in api.ts: Add exponential backoff retry for 5xx and network failures in production, not just dev.');

  issue('performance', 'GoogleMapsService geocode calls lack AbortController',
    'FIX: Add timeout abort to geocode/reverseGeocode fetch calls.');

  // Print issues
  if (issues.length > 0) {
    console.log('\n  \x1b[1mAll Issues:\x1b[0m\n');
    const grouped = {};
    for (const i of issues) { (grouped[i.severity] ||= []).push(i); }
    const order = ['critical', 'performance', 'payload', 'warning'];
    const labels = { critical: '🔴 CRITICAL', performance: '⚡ PERFORMANCE', payload: '📦 PAYLOAD', warning: '⚠️  WARNING' };
    const colors = { critical: '\x1b[31m', performance: '\x1b[33m', payload: '\x1b[36m', warning: '\x1b[33m' };
    for (const sev of order) {
      if (!grouped[sev]?.length) continue;
      console.log(`  ${colors[sev]}${labels[sev]}\x1b[0m`);
      for (const it of grouped[sev]) { console.log(`    • ${it.label}`); if (it.detail) console.log(`      ${it.detail}`); }
      console.log('');
    }
  }

  printReport();
}

function printReport() {
  const total = passed + failed;
  console.log('\n' + '='.repeat(70));
  console.log('  \x1b[1mSLOW NETWORK AUDIT REPORT\x1b[0m');
  console.log('='.repeat(70));
  console.log(`  Assertions: ${total} (${passed} passed, ${failed} failed)`);
  console.log(`  Warnings: ${warnings}`);
  console.log(`  Issues found: ${issues.length}`);

  if (Object.keys(metrics).length > 0) {
    console.log('\n  \x1b[1mKey Metrics:\x1b[0m');
    for (const [label, m] of Object.entries(metrics)) {
      console.log(`    ${label}: ${m.value} ${m.unit}`);
    }
  }

  console.log('='.repeat(70));
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((e) => { console.error('\n💥  Unexpected:', e); printReport(); });
