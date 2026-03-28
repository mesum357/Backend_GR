#!/usr/bin/env node
/**
 * Forces ride-cancel E2E to hit the local API (ignores API_URL / BASE_URL in the environment).
 */
process.env.LOCAL_ONLY = '1';
require('./test-ride-cancellation-e2e.js');
