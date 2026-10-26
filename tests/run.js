#!/usr/bin/env node
/* Runs every suite in this folder and prints a summary.
   Usage: npm test            (all suites)
          node tests/run.js 04   (just the suite whose name starts with 04)

   A suite counts as failed when its exit code is non-zero, when its output has
   a FAIL line or a non-empty "runtime errors:" line (even if it exited 0), or
   when it never printed a single PASS line, so a suite that silently stops
   checking things cannot pass.                                              */

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
  const reasons = [];
  try {
    /* A suite that takes 20 s on an idle machine once needed over 5 minutes
       under heavy load, so the ceiling only stops a real hang. */
    out = execFileSync(process.execPath, [path.join(__dirname, f)], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 600000
    });
  } catch (err) {
    ok = false;
    reasons.push(err.status != null ? `exit code ${err.status}` : `did not finish (${err.code || err.signal || 'error'})`);
    out = (err.stdout || '') + (err.stderr || '');
  }

  const lines = out.split('\n');
  const passLines = lines.filter(l => /^\s*PASS\b/.test(l));
  const failLines = lines.filter(l => /^\s*FAIL\b/.test(l));
  const errLines = lines.filter(l => /^runtime errors: (?!none\s*$)/.test(l));

  if (failLines.length) { ok = false; reasons.push(`${failLines.length} FAIL line${failLines.length === 1 ? '' : 's'}`); }
  if (errLines.length)  { ok = false; reasons.push('runtime errors'); }
  if (!passLines.length) { ok = false; reasons.push('no PASS lines'); }

  passed += passLines.length;
  if (!ok) failedSuites.push(f);
  console.log(`${ok ? '✓' : '✗'} ${f.padEnd(34)} ${passLines.length} assertions${ok ? '' : '  (' + reasons.join(', ') + ')'}`);
  if (!ok) {
    const show = [...failLines, ...errLines];
    /* A crash leaves no FAIL line, so fall back to anything that looks like an error. */
    if (!show.length) show.push(...lines.filter(l => /Error|exception|rejection/i.test(l)));
    console.log(show.slice(0, 30).map(l => '    ' + l.trimEnd()).join('\n'));
  }
}

console.log(`\n${passed} assertions across ${files.length} suites`);
if (failedSuites.length) {
  console.log(`FAILED: ${failedSuites.join(', ')}`);
  process.exit(1);
}
console.log('All suites passed.');
