# tmux Control Tower

## Current

Local tmux Agent Control Tower prototype.

A tmux pane monitor that runs on the machine it monitors: it lists the panes of the current session,
shows which AI agent is in each one, classifies it as CHECKING / WAITING / WORKING / IDLE / DEAD, and
lets the operator move to a pane, rename it, refresh, or quit without leaving the keyboard.

- `tmux-control` — the control tower frame
- `tmux-control-open` — open or return to the CONTROL window
- `tmux-control-mark-seen` — clear the CHECKING marker for a pane
- `watch` / `tw` / `tower` — shell wrappers (`watch` with arguments still defers to `watch(1)`)
- `Ctrl+b` then `w` — bound to `tmux-control-open` for the current session
- keys in the frame: `↑ ↓` select, `Enter` move to pane, `E` rename, `R` refresh, `Q` / `Ctrl+C` exit

## Source

Canonicalized from the PM-provided working prototype.

`install.sh` is that prototype verbatim. The only change made during import was line endings: the file
arrived with CRLF from a Windows editor, and `bash` cannot parse a carriage return after `{`, so it was
normalized to LF. Nothing else was edited — no refactor, no split into multiple runtime files, no
behaviour change. The baseline contract test pins the line count at 1095 for exactly this reason.

## Product constraints

- local-first
- no central server
- no mandatory cloud service
- zero operator hosting cost

The operator runs this on their own PC. It has no account, no backend and no per-user cost, so adding
users does not add server cost to anyone.

## Known baseline defect

Host identity currently contains legacy tmux window-index inference.

`detect_host()` infers the host from where a tmux window happens to sit:

```
window 0 → MAINPC
window 1 → ASUS
```

That is a guess about layout, not identity. Reordering the windows, or any other local pane landing in
window 1, makes it report the wrong host. `get_default_host()` already reads the configured local host
from `~/.config/tmux-control-tower/host`, and that value is authoritative when the script runs on ASUS.

**Do NOT fix it in CT-0.** CT-0 only makes the prototype the Git source of truth.

The `BASELINE MARKER` test in `test/baseline-contract.test.mjs` asserts the window-index inference is
still present. It is not an endorsement of the behaviour — it is the marker that CT-1 removed a defect
that actually existed. When CT-1 removes it, that test is expected to fail, and its failure is the
confirmation.

## Next

CT-1: replace window-index HOST inference with explicit metadata.

Pane and window tmux metadata are the intended source, falling back to the configured local host, with
hostname only as a last resort. Existing pane-title agent detection stays as a fallback, and the `E`
rename UX keeps working.

## Install

Not automated. Review `install.sh` before running it: it writes `~/bin/tmux-control*`, appends to
`~/.tmux.conf` and `~/.bashrc`, and streams the same tool to `asus` over SSH when that host is
reachable. It backs up `~/.tmux.conf` and `~/.bashrc` first, but it is a prototype installer, not a
packaged installer.

## Tests

```
node --test tools/tmux-control-tower/test/baseline-contract.test.mjs
bash -n tools/tmux-control-tower/install.sh
```

Static only: the suite reads the installer and asserts the baseline. It does not execute it, does not
touch `$HOME`, does not start tmux, and does not reach over SSH.
