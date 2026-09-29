// Deterministic fixture worker that goes silent forever (but stays alive).
// Writes its own pid into <workspace>/.arl-silent/<pid> so a test can SIGSTOP
// it and simulate a stalled Run with a live process.
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

const dir = path.join(os.tmpdir(), 'arl-silent-pids');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, `${process.pid}.pid`), String(process.pid));

// Say something first so the detector sees a real heartbeat, then go mute.
process.stdout.write('worker started, pid=' + process.pid + '\n');
setInterval(() => { /* alive, silent */ }, 1000);
