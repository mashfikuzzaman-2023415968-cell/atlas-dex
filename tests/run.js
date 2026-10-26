#!/usr/bin/env node
/* Runs every suite in this folder and prints a summary.
   Usage: npm test            (all suites)
          node tests/run.js 04   (just the suite whose name starts with 04) */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const only = process.argv[2];
const files = fs.readdirSync(__dirname)
  .filter(f => f.endsWith('.test.js'))
  .filter(f => !only || f.startsWith(only))
  .sort();

if (!files.length) {
  console.error(only ? `No suite matching "${only}"` : 'No test files found.');
  process.exit(1);
}

let passed = 0, failedSuites = [];

for (const f of files) {
  let out = '';
  let ok = true;
  try {
    out = execFileSync(process.execPath, [path.join(__dirname, f)], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000
    });
  } catch (err) {
    ok = false;
    out = (err.stdout || '') + (err.stderr || '');
  }
  const count = (out.match(/PASS/g) || []).length;
  passed += count;
  if (!ok) failedSuites.push(f);
  console.log(`${ok ? '✓' : '✗'} ${f.padEnd(34)} ${count} assertions`);
  if (!ok) console.log(out.split('\n').filter(l => /FAIL|Error/.test(l)).slice(0, 12).join('\n'));
}

console.log(`\n${passed} assertions across ${files.length} suites`);
if (failedSuites.length) {
  console.log(`FAILED: ${failedSuites.join(', ')}`);
  process.exit(1);
}
console.log('All suites passed.');
