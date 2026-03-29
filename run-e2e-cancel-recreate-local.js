#!/usr/bin/env node
process.env.LOCAL_ONLY = '1';
require('./test-cancel-recreate-driver-visibility-e2e.js');

