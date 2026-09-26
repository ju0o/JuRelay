import React from 'react';
import { connectionStatusText, type ConnectionPhase } from '../shared/connectionState.js';
import { SettingsView } from '../shared/types.js';

/** Left-rail destinations. Screen order is this array order. */
export type ShellNavId = 'control-room' | 'plan' | 'approvals' | 'records' | 'settings';

export interface ShellNavItem {
  id: ShellNavId;
  label: string;
}

export interface ShellPageCopy {
  title: string;
  lead: string;
}

/* SHELL_HELPERS_START */
/**
 * Rail labels in the order the Founder sees them.
 * 관제실 → 계획 → 승인 규칙 → 작업 기록 → 설정.
 */
export function shellNavItems(): ShellNavItem[] {
  return [
    { id: 'control-room', label: '관제실' },
    { id: 'plan', label: '계획' },
    { id: 'approvals', label: '승인 규칙' },
    { id: 'records', label: '작업 기록' },
    { id: 'settings', label: '설정' },
  ];
}

/**
 * Toggle shows the current state. Unknown after the first answer reads as off.
 * '자동 실행 확인 중' only before the first answer.
 */
export function shellToggleLabel(enabled: boolean | null, phase: ConnectionPhase): string {
  if (phase === 'checking') return '자동 실행 확인 중';
  return enabled === true ? '자동 실행 켜짐' : '자동 실행 꺼짐';
}

/**
 * One Korean sentence per connection phase. Offline and on-but-failing never share a line.
 * Delegates to the SHELL-R2 classifier so the rail and the toggle stay on the same words.
 */
export function shellFailureLine(phase: ConnectionPhase): string {
  return connectionStatusText(phase);
}

/**
 * Top-bar env line. Labels come from the live env list; empty is never a sample name.
 * Offline and on-but-failing each get their own sentence.
 */
export function shellEnvLine(labels: string[], phase: ConnectionPhase): string {
  const known = labels.map((label) => label.trim()).filter(Boolean);
  if (known.length > 0) return `실행 환경: ${known.join(' · ')}`;
  if (phase === 'offline') return '실행 환경: 작업 PC에 연결할 수 없어요';
  if (phase === 'error') return '실행 환경: 작업 PC는 켜져 있는데 환경을 읽지 못했어요';
  if (phase === 'ok') return '실행 환경: 아직 알려진 곳이 없어요';
  return '실행 환경: 확인하고 있어요';
}
/* SHELL_HELPERS_END */

/** One sentence for the top of each rail page: what it is, and what to do now. */
export function shellPageCopy(id: ShellNavId): ShellPageCopy {
  switch (id) {
    case 'control-room':
      return { title: '관제실', lead: '프로젝트별 진행을 보고, 멈춰 있으면 골라 주세요.' };
    case 'plan':
      return { title: '계획', lead: '목표와 작업 순서를 보고, 이대로 진행할지 정해 주세요.' };
    case 'approvals':
      return { title: '승인 규칙', lead: '알아서 진행해도 되는 규칙을 여기서 확인해요.' };
    case 'records':
      return { title: '작업 기록', lead: 'AI에게 준 지시와 받은 결과를 날짜별로 볼 수 있어요.' };
    case 'settings':
      return { title: '설정', lead: '저장 폴더와 프로젝트 자동 진행을 여기서 바꿔요.' };
  }
}

export interface Option {
  value: string;
  label: string;
}

/** A labeled dropdown with an optional "+" add button. */
export function FieldSelect(props: {
  label: string;
  value: string;
  options: Option[];
  onChange: (v: string) => void;
  onAdd: () => void;
}): React.ReactElement {
  return (
    <div className="field">
      <label className="flabel">{props.label}</label>
      <span className="fgrow">
        <select
          value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
        >
          <option value="" disabled>
            선택...
          </option>
          {props.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <button className="mini add" title="추가" onClick={props.onAdd}>
          +
        </button>
      </span>
    </div>
  );
}

/** A plain labeled text input. */
export function FieldText(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}): React.ReactElement {
  return (
    <div className="field">
      <label className="flabel">{props.label}</label>
      <input type="text" value={props.value} onChange={(e) => props.onChange(e.target.value)} />
    </div>
  );
}

/** Inline confirmation for destructive actions — never use native dialog/confirm. */
export function InlineConfirm(props: {
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  busy?: boolean;
  busyLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}): React.ReactElement {
  return (
    <div className="inline-confirm" role="group" aria-label={props.message}>
      <p>{props.message}</p>
      <div className="inline-confirm-actions">
        <button
          className="btn primary"
          type="button"
          disabled={props.busy}
          onClick={props.onConfirm}
        >
          {props.busy ? (props.busyLabel ?? '실행 중…') : (props.confirmLabel ?? '확인')}
        </button>
        <button
          className="btn subtle"
          type="button"
          disabled={props.busy}
          onClick={props.onCancel}
        >
          {props.cancelLabel ?? '취소'}
        </button>
      </div>
    </div>
  );
}

/** DATA_ROOT status + "변경" action shown in the header. */
export function DataRootWidget(props: {
  settings: SettingsView | null;
  onChanged: (s: SettingsView) => void;
  onPick: () => void;
}): React.ReactElement {
  const has = !!(props.settings && props.settings.dataRoot);
  return (
    <div className="datameta" title={props.settings?.dataRoot ?? ''}>
      <span className={`dot ${has ? 'on' : 'off'}`}></span>
      <span className="clamp">
        {has ? props.settings!.dataRoot : 'DATA_ROOT 미지정'}
      </span>
      <button className="mini add" onClick={props.onPick}>
        변경
      </button>
    </div>
  );
}