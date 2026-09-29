// A worker that keeps working: it prints continuously and keeps editing a real file's CONTENT.
// The watchdog must never kill it, no matter how long it runs. This is the T6 subject and the
// sharp contrast with a heartbeat model, which cannot tell this apart from a hang.
import { writeFileSync } from "node:fs";

const out = `${process.cwd()}/live-work.txt`;
let n = 0;
setInterval(() => {
  n += 1;
  process.stdout.write(`tick ${n}\n`);
  writeFileSync(out, `content-${n}\n`);   // content genuinely changes → real progress
}, 120);
setTimeout(() => {
  process.stdout.write(JSON.stringify({ status: "IMPLEMENTED", commitSha: "0".repeat(40) }) + "\n");
  process.exit(0);
}, Number(process.argv[2] ?? 3000));
