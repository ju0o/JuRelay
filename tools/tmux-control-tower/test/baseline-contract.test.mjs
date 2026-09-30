/**
 * Baseline contract for tools/tmux-control-tower/install.sh (CT-0).
 *
 * This is a STATIC regression over the canonicalized prototype. It reads the file and asserts that the
 * behaviour PM depends on is present, and it touches nothing live: no $HOME read, no tmux invocation,
 * no SSH. The install script is never executed here.
 *
 * The window-index assertions are a BASELINE MARKER, not an endorsement. detect_host() currently infers
 * host identity from where a tmux window happens to sit, which misreports any other local pane that
 * occupies window 1. CT-1 removes that inference; this test then fails, on purpose, and that failure is
 * the signal that the defect was actually removed. Keeping the marker is the point: a test that only
 * proves the good behaviour cannot prove the bad behaviour is gone.
 */
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const installPath = join(here, '..', 'install.sh');
const script = await readFile(installPath, 'utf8');

test('the canonical installer is valid bash', () => {
  const result = spawnSync('bash', ['-n', installPath], { encoding: 'utf8' });
  assert.equal(result.status, 0, `bash -n reported: ${result.stderr}`);
  // The prototype ships from a Windows editor, so the file arrives with CRLF. Normalizing it to LF is
  // the ONLY edit made during canonicalization; bash cannot parse a carriage return after `{`.
  assert.equal(script.includes('\r'), false, 'line endings are LF so bash -n can parse the file');
  // wc -l counts newlines; split() also yields a trailing element for the final newline.
  assert.equal(script.split('\n').length - 1, 1095, 'line count is unchanged from the supplied prototype');
});

test('the prototype is canonicalized whole, as a single install function', () => {
  assert.match(script, /^install_tmux_control_tower\(\) \{/);
  assert.match(script, /^install_tmux_control_tower$/m, 'it is invoked');
  assert.match(script, /^unset -f install_tmux_control_tower$/m, 'and the function is not left exported');
  assert.equal(script.includes('\r'), false, 'CRLF is normalized so bash can parse it');
});

test('detect_host exists', () => {
  assert.match(script, /^detect_host\(\) \{$/m);
  assert.match(script, /^get_default_host\(\) \{$/m, 'with the configured local host it falls back to');
});

test('BASELINE MARKER — the legacy window-index host inference is still present', () => {
  // CT-0 imports this unchanged. CT-1 must remove it; when it does, this test fails and that is the
  // intended signal. Do not "fix" this assertion to make the suite green.
  assert.match(script, /case "\$window_index" in/);
  assert.match(script, /0\)\s*\n\s*printf 'MAINPC'/, 'window 0 is inferred as MAINPC');
  assert.match(script, /1\)\s*\n\s*printf 'ASUS'/, 'window 1 is inferred as ASUS');
  assert.match(script, /\*\)\s*\n\s*printf '%s' "\$default_host"/, 'anything else falls back to the local host');
});

test('display_agent exists with a fallback when no title is available', () => {
  assert.match(script, /^display_agent\(\) \{$/m);
  const body = script.slice(script.indexOf('display_agent() {'), script.indexOf('get_default_host() {'));
  // An unrecognised command still yields a label instead of an empty cell.
  assert.match(body, /\*\)\s*\n\s*printf '%s' "\$command"/, 'an unknown command falls back to its own name');
  for (const agent of ['Claude', 'Codex', 'OpenCode', 'SSH', 'Shell']) {
    assert.ok(body.includes(agent), `${agent} is labelled`);
  }
});

test('detect_status exists and the five states are defined', () => {
  assert.match(script, /^detect_status\(\) \{$/m);
  for (const state of ['CHECKING', 'WAITING', 'WORKING', 'IDLE', 'DEAD']) {
    assert.ok(script.includes(state), `${state} is present`);
  }
  const body = script.slice(script.indexOf('detect_status() {'), script.indexOf('detect_status() {') + 4000);
  assert.match(body, /STATUS_RESULT="CHECKING"/);
  assert.match(body, /STATUS_RESULT="WAITING"/);
});

test('the three entry points are installed', () => {
  for (const cmd of ['tmux-control', 'tmux-control-open', 'tmux-control-mark-seen']) {
    assert.ok(script.includes(`$HOME/bin/${cmd}`), `${cmd} is written to ~/bin`);
  }
  assert.match(script, /chmod \+x "\$HOME\/bin\/tmux-control"/);
});

test('watch, tw and tower are wired', () => {
  // The heredoc body is what ends up in ~/.config/ju-shell/tmux-control-tower.sh, so read the file
  // contents between the opening and closing SHELL_EOF markers.
  const open = script.indexOf("<<'SHELL_EOF'");
  const close = script.indexOf('\nSHELL_EOF', open);
  const shell = script.slice(open + "<<'SHELL_EOF'".length, close);
  for (const fn of ['watch', 'tw', 'tower']) {
    assert.match(shell, new RegExp(`^${fn}\\(\\) \\{`, 'm'), `${fn}() is defined`);
  }
  // watch() with no argument opens the tower; with arguments it defers to the real watch(1).
  assert.match(shell, /command watch "\$@"/, 'watch defers to the system command when given arguments');
  assert.ok(shell.includes('tmux-control-open'), 'tw and tower open the control window');
  assert.ok(script.includes('source ~/.config/ju-shell/tmux-control-tower.sh'), 'the shell file is sourced from bashrc');
});

test('Ctrl+b → w opens the control window', () => {
  assert.match(script, /unbind-key w/);
  assert.match(script, /bind-key w run-shell -b "\$HOME\/bin\/tmux-control-open '#\{session_name\}'"/);
});

test('keyboard handling covers Enter, E, R, Q and Ctrl+C', () => {
  // Navigation and exit are announced on the frame, which is where the key list lives.
  assert.match(script, /Enter\s+Open\s+E\s+Rename\s+R\s+Refresh\s+Q \/ Ctrl\+C\s+Exit/);
  const body = script.slice(script.indexOf('case "$key" in'));
  assert.match(body, /'\[A'/, 'arrow up');
  assert.match(body, /'\[B'/, 'arrow down');
  assert.match(body, /E/, 'E rename');
  assert.match(body, /R/, 'R refresh');
  assert.match(body, /Q/, 'Q exit');
  // Ctrl+C and the restore path must leave the terminal usable.
  assert.match(script, /trap (restore_terminal|interrupt_control)/);
  assert.match(script, /^restore_terminal\(\) \{$/m);
  assert.match(script, /^interrupt_control\(\) \{$/m);
  assert.ok(script.includes('tmux switch-client'), 'Enter moves to the selected pane');
});

test('the ASUS install block is present', () => {
  assert.match(script, /if ssh asus 'printf ok'/, 'reachability is probed first');
  assert.match(script, /ssh asus 'bash -s' <<'ASUS_EOF'/, 'and the payload is streamed when reachable');
  // MainPC writes its own configured host, which detect_host() reads back through get_default_host().
  assert.match(script, /printf 'MAINPC\\n' \\\s*\n\s*> "\$HOME\/\.config\/tmux-control-tower\/host"/);
});

test('the installer is not executed by this suite', () => {
  // A guard against a future edit turning this into a live test: every assertion above is a static read
  // of the file, and nothing here spawns the installer or a tmux server.
  assert.ok(script.includes('cat > "$HOME/bin/tmux-control" <<\'CONTROL_EOF\''), 'the installer still writes, rather than this test invoking it');
  assert.equal(process.env.TMUX_CONTROL_TOWER_INSTALL, undefined, 'no install flag is needed to run these tests');
});
