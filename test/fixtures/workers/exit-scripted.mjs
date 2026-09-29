// Scripted fixture worker for F0 auto-advance dispatch tests.
//
// Behavior from env:
//   ARL_EXIT_PLAN: comma list of exit codes per attempt index, e.g. "1,1,0"
//                  (attempts past the list reuse the last entry).
//   ARL_COUNT_FILE: path to an attempt counter file (created if missing).
//   ARL_STDERR: text written to stderr when exiting non-zero.
import * as fs from 'node:fs';

const plan = String(process.env.ARL_EXIT_PLAN || '0').split(',').map((s) => Number(s));
const countFile = process.env.ARL_COUNT_FILE || '';
let n = 0;
if (countFile) {
  try {
    n = Number(fs.readFileSync(countFile, 'utf8')) || 0;
  } catch {
    n = 0;
  }
  fs.writeFileSync(countFile, String(n + 1));
}
const code = plan[Math.min(n, plan.length - 1)] || 0;
if (code !== 0 && process.env.ARL_STDERR) process.stderr.write(process.env.ARL_STDERR + '\n');
await new Promise((r) => setTimeout(r, 50));
process.exit(code);
