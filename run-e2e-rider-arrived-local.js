#!/usr/bin/env node
/**
 * Local-only wrapper for rider-arrived persistence E2E.
 */
process.env.LOCAL_ONLY = '1';
if (!process.env.LOCAL_API_PORT) process.env.LOCAL_API_PORT = '8080';

require('./test-rider-arrived-persistence-e2e.js');

