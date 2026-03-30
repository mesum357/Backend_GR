#!/usr/bin/env node
const { spawnSync } = require('child_process');

const steps = [
  { name: 'cancel-recreate', cmd: 'npm', args: ['run', 'e2e:cancel-recreate'] },
  { name: 'multi-request', cmd: 'npm', args: ['run', 'e2e:multi-request'] },
  { name: 'rider-arrived-persistence', cmd: 'npm', args: ['run', 'e2e:rider-arrived'] },
];

for (const step of steps) {
  console.log(`\n==============================`);
  console.log(`Running ${step.name}`);
  console.log(`==============================\n`);
  const result = spawnSync(step.cmd, step.args, { stdio: 'inherit', shell: true });
  if (result.status !== 0) {
    console.error(`\n${step.name} failed with exit code ${result.status}`);
    process.exit(result.status || 1);
  }
}

console.log('\nAll critical E2E suites passed.');

