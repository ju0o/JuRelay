// A worker that stalls: it prints a little, then goes silent forever without exiting.
// This is the T7 subject. It never writes a file and never commits, so the watchdog must
// kill it on the stall timer — long before the adapter's own 30-minute timeout.
//
//   node silent-after-output.mjs            → prints 3 lines, then hangs
//   node silent-after-output.mjs <n>        → prints n lines, then hangs
import { appendFileSync } from "node:fs";

const lines = Number(process.argv[2] ?? 3);
for (let i = 0; i < lines; i += 1) {
  process.stdout.write(`working step ${i + 1}\n`);
  // Touching a file that stays byte-identical is the classic false signal (mtime moves, content does not).
  appendFileSync(`${process.cwd()}/.stall-probe.txt`, "x");
}
setInterval(() => {}, 1 << 30); // stay alive, say nothing, never resolve
