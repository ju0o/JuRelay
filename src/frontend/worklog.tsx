/**
 * 작업 기록 — 자동 목록. 30초마다 board 를 다시 읽어 고른 날짜에 끝난 작업을 보여 준다.
 */
import React, { useEffect, useState } from 'react';
import { must } from './bridge.js';
import { laneErrorLines } from '../shared/projectManager.js';
import { worklogRows, type WorklogRow } from '../shared/worklog.js';

export const WORKLOG_REFRESH_MS = 30_000;

function todayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function AutoWorklog(): React.ReactElement {
  const [date, setDate] = useState(todayYmd);
  const [rows, setRows] = useState<WorklogRow[] | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    const load = (): void => {
      must({ op: 'controlRoom:board' })
        .then(board => { if (alive) { setRows(worklogRows(board, date)); setFailure(null); } })
        .catch((error: unknown) => { if (alive) setFailure(error instanceof Error ? error.message : String(error)); });
    };
    load();
    const timer = setInterval(load, WORKLOG_REFRESH_MS);
    return () => { alive = false; clearInterval(timer); };
  }, [date, attempt]);

  function copy(row: WorklogRow): void {
    const write = navigator.clipboard?.writeText?.bind(navigator.clipboard);
    if (!write) { setCopied(`fail:${row.key}`); return; }
    void write(row.copyText).then(() => setCopied(row.key), () => setCopied(`fail:${row.key}`));
  }

  const lines = failure !== null ? laneErrorLines('작업 기록을 불러오지', failure) : null;
  return (
    <section className="record-log worklog-auto" aria-label="자동 작업 기록">
      <h3>AI가 끝낸 일 — 30초마다 저절로 채워져요</h3>
      <label className="flabel" htmlFor="worklog-date">날짜</label>
      <input id="worklog-date" type="date" value={date} onChange={e => { if (e.target.value) { setRows(null); setDate(e.target.value); } }} />
      {lines && (
        <div className="lovable-error" role="alert">
          <p>{lines[0]}</p>
          <p>{lines[1]}</p>
          <p>{lines[2]}</p>
          <button type="button" className="btn" onClick={() => setAttempt(value => value + 1)}>다시 시도</button>
          {failure && <details><summary>원문 보기</summary><p className="muted">{failure}</p></details>}
        </div>
      )}
      {rows === null ? (!lines && <p className="muted">기록을 읽고 있어요.</p>)
        : rows.length === 0 ? <p className="control-empty">이 날 끝난 작업이 아직 없어요 — AI가 작업을 끝내면 여기에 저절로 생겨요.</p>
        : (
          <div className="record-rows">
            {rows.map(row => (
              <details key={row.key} className="record-row worklog-row">
                <summary>{row.line}</summary>
                <p>지시 → 결과</p>
                <p>{row.ask} → {row.result}</p>
                <button type="button" className="btn record-copy" onClick={() => copy(row)}>
                  {copied === row.key ? '복사했어요 ✓' : copied === `fail:${row.key}` ? '복사하지 못했어요 · 다시 시도' : '복사'}
                </button>
                {row.raw && <details><summary>원문 보기</summary><pre className="muted">{row.raw}</pre></details>}
              </details>
            ))}
          </div>
        )}
    </section>
  );
}
