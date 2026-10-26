/* Shared helpers for the suites. Not a suite itself (run.js only picks up
   *.test.js), so requiring it from a suite costs nothing.                   */

/* Poll until cond() is truthy or the time is up. Resolves to the final truthiness
   instead of throwing, so the assertion that follows reports what failed. Used
   where a fixed sleep used to gate an assertion: it returns as soon as the app
   is ready, and waits up to timeoutMs when the machine is slow. The default is
   generous because a heavily loaded machine once took over 10 s to boot a
   window; a passing condition still returns on the next poll. */
async function waitFor(cond, timeoutMs = 30000, intervalMs = 15) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    let v = false;
    try { v = cond(); } catch { v = false; }
    if (v) return true;
    if (Date.now() >= end) return false;
    await new Promise(r => setTimeout(r, intervalMs));
  }
}

/* Collect uncaught errors from the page and from rejected promises. A suite
   that finishes with any of them has failed, see finish(). A suite that opens
   several windows passes the same array to each, so the process-level hook is
   installed once and feeds every array registered so far.                  */
const sinks = new Set();
let hooked = false;
function trackErrors(w, errs = []) {
  w.addEventListener('error', e => errs.push(e.message));
  sinks.add(errs);
  if (!hooked) {
    hooked = true;
    process.on('unhandledRejection', r => {
      const msg = 'unhandled rejection: ' + ((r && r.message) || r);
      sinks.forEach(list => list.push(msg));
    });
  }
  return errs;
}

/* Print the verdict and exit non-zero when anything failed, runtime errors
   included. Without the exit code a failing suite used to look like a pass. */
function finish(fail, errs, okMessage = 'All tests passed') {
  console.log('\nruntime errors: ' + (errs.length ? errs.join(' | ') : 'none'));
  if (errs.length) { console.log(`  FAIL  no uncaught runtime errors (${errs.length})`); fail++; }
  console.log(fail ? `\n${fail} FAILURES` : '\n' + okMessage);
  process.exit(fail ? 1 : 0);
}

/* A suite body that throws must not hang or pass: report it and fail. */
function crash(err) {
  console.log('  FAIL  suite crashed: ' + (err && err.stack || err));
  process.exit(1);
}

module.exports = { waitFor, trackErrors, finish, crash };
