/**
 * F0 Phase 1+2: wake queue + AUTO_ADVANCE rules + 3 scenarios.
 * Server-free logic tests (V5). Human interventions counted, not asserted away.
 */
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const wake = await import('../dist/server/backend/wake-queue.js');
const adv = await import('../dist/server/backend/auto-advance.js');

let ROOT = '';
before(() => {
  ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'f0-'));
});
const PROJ = 'proj';

describe('wake queue (Phase 1)', () => {
  it('payload carries the standard schema', () => {
    const { record, deduped } = wake.emitRunFailedWake(ROOT, PROJ, {
      goalId: 'G1', taskId: 'T1', runId: 'r1', workerId: 'builder-opencode',
      model: 'big-pickle', reasonText: 'exit 1 boom', failureCategory: 'transient',
      attemptsUsed: 1, nextRecommendedAction: 'retry',
    });
    assert.equal(deduped, false);
    const p = record.payload;
    for (const k of ['goalId', 'taskId', 'runId', 'workerId', 'model', 'oldState', 'newState',
      'reason', 'failureCategory', 'blockerSummary', 'nextRecommendedAction',
      'attemptsUsed', 'attemptsMax', 'eventId', 'createdAt']) {
      assert.ok(p[k] !== undefined, 'payload.' + k);
    }
    assert.equal(p.oldState, 'RUNNING');
    assert.equal(p.newState, 'RUN_FAILED');
    assert.equal(record.acknowledged, false);
  });
  it('same event re-emitted exactly once (dedup)', () => {
    const a = wake.emitRunFailedWake(ROOT, PROJ, {
      goalId: 'G1', taskId: 'T2', runId: 'r1', workerId: 'w',
      reasonText: 'x', attemptsUsed: 1,
    });
    const b = wake.emitRunFailedWake(ROOT, PROJ, {
      goalId: 'G1', taskId: 'T2', runId: 'r1', workerId: 'w',
      reasonText: 'x', attemptsUsed: 1,
    });
    assert.equal(a.deduped, false);
    assert.equal(b.deduped, true);
    assert.equal(a.record.eventId, b.record.eventId);
  });
  it('distinct runs are distinct events', () => {
    const a = wake.emitRunFailedWake(ROOT, PROJ, {
      goalId: 'G1', taskId: 'T3', runId: 'r1', workerId: 'w', reasonText: 'x',
    });
    const b = wake.emitRunFailedWake(ROOT, PROJ, {
      goalId: 'G1', taskId: 'T3', runId: 'r2', workerId: 'w', reasonText: 'x',
    });
    assert.notEqual(a.record.eventId, b.record.eventId);
    assert.equal(b.deduped, false);
  });
  it('pending backlog survives and drains on acknowledge (resume)', () => {
    const before = wake.listPendingWakes(ROOT, PROJ).length;
    wake.emitWake(ROOT, PROJ, { reason: 'VERIFYING', goalId: 'G', taskId: 'TV', runId: 'rv' });
    wake.emitWake(ROOT, PROJ, { reason: 'GOAL_COMPLETE', goalId: 'G', taskId: 'TG', runId: '' });
    assert.equal(wake.listPendingWakes(ROOT, PROJ).length, before + 2);
    const [first] = wake.listPendingWakes(ROOT, PROJ).slice(-2);
    wake.acknowledgeWake(ROOT, PROJ, first.eventId);
    assert.equal(wake.listPendingWakes(ROOT, PROJ).length, before + 1);
  });
});

describe('AUTO_ADVANCE rule table (Phase 2)', () => {
  const D = (o) => adv.recordOutcome(ROOT, PROJ, o);
  it('pass and qa-pass dispatch next, no human', () => {
    assert.deepEqual(
      [D({ taskId: 'R1', kind: 'pass' }).action, D({ taskId: 'R1', kind: 'pass' }).humanRequired],
      ['dispatch-next', false]);
    const q = D({ taskId: 'R2', kind: 'qa-pass' });
    assert.equal(q.action, 'dispatch-next');
    assert.equal(q.humanRequired, false);
  });
  it('fail ladder: retry -> fallback -> wake-pm(human)', () => {
    const f1 = D({ taskId: 'R3', kind: 'fail', failureCategory: 'transient' });
    assert.equal(f1.action, 'retry');
    assert.equal(f1.humanRequired, false);
    assert.equal(f1.consecutiveFailures, 1);
    const f2 = D({ taskId: 'R3', kind: 'fail', failureCategory: 'transient', fallbackAvailable: true });
    assert.equal(f2.action, 'fallback');
    assert.equal(f2.humanRequired, false);
    const f3 = D({ taskId: 'R3', kind: 'fail', failureCategory: 'transient', fallbackAvailable: true });
    assert.equal(f3.action, 'wake-pm');
    assert.equal(f3.humanRequired, true);
    assert.equal(f3.wakeAction, 'needs-human');
  });
  it('budget/permission wakes immediately (human)', () => {
    const b = D({ taskId: 'R4', kind: 'fail', failureCategory: 'budget' });
    assert.equal(b.action, 'wake-pm');
    assert.equal(b.humanRequired, true);
  });
  it('qa-fail: retry once, then wake-pm (human)', () => {
    const q1 = D({ taskId: 'R5', kind: 'qa-fail' });
    assert.equal(q1.action, 'retry');
    assert.equal(q1.humanRequired, false);
    const q2 = D({ taskId: 'R5', kind: 'qa-fail' });
    assert.equal(q2.action, 'wake-pm');
    assert.equal(q2.humanRequired, true);
  });
  it('thin CHANGES reason wakes (human); final task notifies (no human)', () => {
    const c = D({ taskId: 'R6', kind: 'fail', reasonSufficient: false });
    assert.equal(c.action, 'wake-pm');
    assert.equal(c.humanRequired, true);
    const f = D({ taskId: 'R7', kind: 'pass', finalTask: true });
    assert.equal(f.action, 'notify-final');
    assert.equal(f.humanRequired, false);
  });
  it('counters persist across reloads', () => {
    D({ taskId: 'R8', kind: 'fail', failureCategory: 'transient' });
    assert.equal(adv.getConsecutiveFailures(ROOT, PROJ, 'R8'), 1);
    D({ taskId: 'R8', kind: 'pass' });
    assert.equal(adv.getConsecutiveFailures(ROOT, PROJ, 'R8'), 0);
  });
});

describe('scenarios (interventions counted)', () => {
  // Harness plays Supervisor: applies decisions, emits wakes, counts humans.
  function drive(tasks) {
    // tasks: [{id, runs: ['pass'|'fail(transient)'|'fail-budget'|'qa-fail', ...]}]
    let interventions = 0;
    let wakes = 0;
    let dupes = 0;
    const log = [];
    for (const t of tasks) {
      let runNo = 0;
      for (const step of t.runs) {
        runNo++;
        const runId = `${t.id}-run${runNo}`;
        if (step === 'pass' || step === 'qa-pass') {
          const d = adv.recordOutcome(ROOT, PROJ, {
            taskId: t.id, kind: step, finalTask: t.final === true,
          });
          log.push(`${t.id}/${runId}: ${d.action}`);
          if (d.humanRequired) interventions++;
          if (d.action === 'notify-final') {
            const w = wake.emitWake(ROOT, PROJ, {
              reason: 'GOAL_COMPLETE', goalId: 'G', taskId: t.id, runId: runId,
              nextRecommendedAction: 'notify',
            });
            wakes += w.deduped ? 0 : 1;
          }
          break;
        }
        const kind = step.startsWith('qa') ? 'qa-fail' : 'fail';
        const cat = step === 'fail-budget' ? 'budget' : 'transient';
        const d = adv.recordOutcome(ROOT, PROJ, {
          taskId: t.id, kind, failureCategory: cat, fallbackAvailable: true,
        });
        // Noise rule: wake records ONLY on human-required paths.
        // retry/fallback are logged in the run record, never woken.
        if (d.humanRequired) {
          const w = wake.emitRunFailedWake(ROOT, PROJ, {
            goalId: 'G', taskId: t.id, runId, workerId: 'builder-opencode',
            reasonText: `${step} at ${runId}`, failureCategory: cat,
            attemptsUsed: d.consecutiveFailures,
            nextRecommendedAction: 'needs-human',
          });
          if (w.deduped) dupes++; else wakes++;
          const w2 = wake.emitRunFailedWake(ROOT, PROJ, {
            goalId: 'G', taskId: t.id, runId, workerId: 'builder-opencode',
            reasonText: `${step} at ${runId}`, failureCategory: cat,
            attemptsUsed: d.consecutiveFailures,
            nextRecommendedAction: 'needs-human',
          });
          assert.equal(w2.deduped, true, 'double report suppressed');
        }
        log.push(`${t.id}/${runId}: ${d.action}${d.humanRequired ? ' HUMAN' : ''}`);
        if (d.humanRequired) {
          interventions++;
          break; // progress stops for a human
        }
      }
    }
    return { interventions, wakes, dupes, log };
  }

  it('S1: 5 consecutive successes -> 0 interventions', () => {
    const r = drive([
      { id: 'S1a', runs: ['pass'] }, { id: 'S1b', runs: ['pass'] },
      { id: 'S1c', runs: ['pass'] }, { id: 'S1d', runs: ['pass'] },
      { id: 'S1e', runs: ['pass'] },
    ]);
    assert.equal(r.interventions, 0);
    assert.equal(r.wakes, 0);
  });
  it('S2: one failure then retry success -> 0 interventions, 0 wakes', () => {
    const r = drive([{ id: 'S2a', runs: ['fail', 'pass'] }]);
    assert.equal(r.interventions, 0);
    assert.equal(r.wakes, 0, 'retry path is log-only, got: ' + r.log.join(' | '));
    assert.equal(r.dupes, 0, 'no duplicate wakes counted');
  });
  it('S3: three consecutive failures -> 1 intervention, 1 wake', () => {
    const r = drive([{ id: 'S3a', runs: ['fail', 'fail', 'fail'] }]);
    assert.equal(r.interventions, 1);
    assert.equal(r.wakes, 1, 'only the human-required wake, got: ' + r.log.join(' | '));
    assert.equal(r.dupes, 0, 'no duplicate wakes');
    assert.ok(r.log.join(' ').includes('retry'));
    assert.ok(r.log.join(' ').includes('fallback'));
    assert.ok(r.log.join(' ').includes('wake-pm HUMAN'));
  });
  it('pending backlog drains after the scenarios (resume)', () => {
    const pending = wake.listPendingWakes(ROOT, PROJ);
    assert.ok(pending.length > 0, 'backlog exists');
    for (const w of pending) wake.acknowledgeWake(ROOT, PROJ, w.eventId);
    assert.equal(wake.listPendingWakes(ROOT, PROJ).length, 0);
  });
});
