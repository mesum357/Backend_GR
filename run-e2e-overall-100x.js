#!/usr/bin/env node
/**
 * Run the complete ride-process E2E N times (default 100) and print a precision summary.
 *
 *   API_URL=https://api.mesumabbas.online ADMIN_EMAIL=... ADMIN_PASSWORD=... node run-e2e-overall-100x.js
 *   E2E_ITERATIONS=100 npm run e2e:overall:100
 */
const { spawnSync } = require('child_process');
const path = require('path');

const ITERATIONS = Math.max(1, Number(process.env.E2E_ITERATIONS || 100));
const DELAY_MS = Math.max(0, Number(process.env.E2E_DELAY_MS || 1500));
const TIMEOUT_MS = Math.max(60000, Number(process.env.E2E_TIMEOUT_MS || 180000));
const SCRIPT = path.join(__dirname, 'test-complete-ride-process-e2e.js');
const NET_RETRY = Math.max(0, Number(process.env.E2E_NET_RETRIES || 6));
const NET_RETRY_MS = Math.max(1000, Number(process.env.E2E_NET_RETRY_MS || 8000));

function isNetworkFailure(output, result) {
  const text = String(output || '');
  if (/ENOTFOUND|ETIMEDOUT|ECONNRESET|ECONNREFUSED|socket hang up|network/i.test(text)) return true;
  if (result?.signal === 'SIGTERM' && !(parseResults(text).passed > 0)) return true;
  return false;
}

function runOnce() {
  return spawnSync(process.execPath, [SCRIPT], {
    cwd: __dirname,
    env: process.env,
    encoding: 'utf8',
    timeout: TIMEOUT_MS,
    maxBuffer: 8 * 1024 * 1024,
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseResults(text) {
  const m = String(text || '').match(/RESULTS:\s*(\d+)\s*passed,\s*(\d+)\s*failed/);
  if (!m) return { passed: null, failed: null };
  return { passed: Number(m[1]), failed: Number(m[2]) };
}

async function main() {
  console.log(`\nGB RIDES overall E2E x${ITERATIONS}`);
  console.log(`API: ${process.env.API_URL || process.env.BASE_URL || '(default local)'}`);
  console.log(`${new Date().toISOString()}\n`);

  const failures = [];
  let okRuns = 0;
  let totalPassed = 0;
  let totalFailedAsserts = 0;
  const t0 = Date.now();

  for (let i = 1; i <= ITERATIONS; i++) {
    const started = Date.now();
    let r = runOnce();
    let output = `${r.stdout || ''}${r.stderr || ''}`;
    let parsed = parseResults(output);
    let crashed = r.error || r.status == null;
    let failed = crashed || r.status !== 0 || (parsed.failed != null && parsed.failed > 0);
    let netAttempts = 0;
    while (failed && isNetworkFailure(output, r) && netAttempts < NET_RETRY) {
      netAttempts += 1;
      console.log(`  [${String(i).padStart(3, '0')}/${ITERATIONS}] network glitch, retry ${netAttempts}/${NET_RETRY}…`);
      await sleep(NET_RETRY_MS);
      r = runOnce();
      output = `${r.stdout || ''}${r.stderr || ''}`;
      parsed = parseResults(output);
      crashed = r.error || r.status == null;
      failed = crashed || r.status !== 0 || (parsed.failed != null && parsed.failed > 0);
    }
    const elapsed = Date.now() - started;

    if (parsed.passed != null) totalPassed += parsed.passed;
    if (parsed.failed != null) totalFailedAsserts += parsed.failed;

    if (failed) {
      failures.push({
        i,
        status: r.status,
        signal: r.signal,
        error: r.error?.message || null,
        passed: parsed.passed,
        failed: parsed.failed,
        tail: output.trim().split(/\r?\n/).slice(-12).join('\n'),
      });
      console.log(
        `  [${String(i).padStart(3, '0')}/${ITERATIONS}] FAIL  ${elapsed}ms  asserts ${parsed.passed ?? '?'}/${(parsed.passed ?? 0) + (parsed.failed ?? 0)}  exit=${r.status} ${r.signal || ''}`
      );
    } else {
      okRuns += 1;
      console.log(
        `  [${String(i).padStart(3, '0')}/${ITERATIONS}] PASS  ${elapsed}ms  asserts ${parsed.passed} passed`
      );
    }

    if (i < ITERATIONS && DELAY_MS) await sleep(DELAY_MS);
  }

  const totalMs = Date.now() - t0;
  const pct = ((okRuns / ITERATIONS) * 100).toFixed(1);
  console.log('\n' + '='.repeat(64));
  console.log(`  PRECISION: ${okRuns}/${ITERATIONS} runs passed (${pct}%)`);
  console.log(`  Asserts:   ${totalPassed} passed, ${totalFailedAsserts} failed`);
  console.log(`  Duration:  ${Math.round(totalMs / 1000)}s`);
  console.log('='.repeat(64));

  if (failures.length) {
    console.log('\nFailed iterations:');
    for (const f of failures) {
      console.log(`\n--- run ${f.i} exit=${f.status} ${f.error || ''} ---`);
      console.log(f.tail);
    }
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
