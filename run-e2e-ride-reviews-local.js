#!/usr/bin/env node
/**
 * Forces the ride+reviews E2E to hit the local API (ignores API_URL / BASE_URL in the environment).
 */
process.env.LOCAL_ONLY = '1';
require('./test-full-ride-e2e-with-reviews.js');
