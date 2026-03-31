#!/usr/bin/env node
process.env.LOCAL_ONLY = '1';
if (!process.env.LOCAL_API_PORT) process.env.LOCAL_API_PORT = '8080';

require('./test-driver-view-count-finding-modal-e2e.js');

