/**
 * Pure Evidence Gate judgment for a frozen task contract.
 *
 * This module does not read or write Tasks, QA attempts, Deliveries, Events,
 * or Plans. Callers pass the contract and the Evidence records already bound
 * to one Run. It can only classify; it never mints a Delivery and never
 * treats a record as QA PASS.
 *
 * Round 38b: a requirement that names a machine-checkable `<TYPE>/<TRUSTLEVEL>`
 * token needs a non-FAIL record of that type at that trust level or higher.
 * Round 38c: a prose requirement with no such token uses the VERIFIED floor.
 * A FAIL record never satisfies either rule. requirementId is `REQ-<index+1>`.
 */
import {
  EVIDENCE_TRUST_LEVELS,
  EVIDENCE_TYPES,
  type EvidenceRecord,
  type EvidenceTrustLevel,
  type EvidenceType,
  type TaskRecord,
} from '../shared/types.js';

const EVIDENCE_TRUST_RANK: Record<string, number> = { CLAIMED: 0, OBSERVED: 1, VERIFIED: 2, ACCEPTED: 3 };

/** Round 38c default floor for prose requirements: VERIFIED, or higher (ACCEPTED). */
const DEFAULT_EVIDENCE_FLOOR_TRUST: EvidenceTrustLevel = 'VERIFIED';

export type EvidenceGateRuleKind = 'token' | 'floor';

interface RequiredEvidenceSpec {
  requirementIndex: number;
  requirement: string;
  type: EvidenceType;
  trustLevel: EvidenceTrustLevel;
}

export interface EvidenceGateRequirement {
  requirementIndex: number;
  requirement: string;
  rule: EvidenceGateRuleKind;
}

export interface EvidenceGateUnmet {
  requirementIndex: number;
  requirement: string;
  parsed?: RequiredEvidenceSpec;
}

export interface EvidenceGateCheck {
  satisfied: boolean;
  known: EvidenceGateRequirement[];
  unmet: EvidenceGateUnmet[];
  present: EvidenceRecord[];
}

export interface EvidenceGateJudgmentRow {
  requirementId: string;
  requirement: string;
  rule: EvidenceGateRuleKind;
}

function parseRequiredEvidenceSpec(requirement: string, index: number): RequiredEvidenceSpec | null {
  const tokenRe = /([A-Za-z][A-Za-z0-9_]*)\s*\/\s*([A-Za-z][A-Za-z0-9_]*)/g;
  let match: RegExpExecArray | null;
  while ((match = tokenRe.exec(requirement)) !== null) {
    const type = (match[1] ?? '').toUpperCase();
    const trust = (match[2] ?? '').toUpperCase();
    if ((EVIDENCE_TYPES as readonly string[]).includes(type) && (EVIDENCE_TRUST_LEVELS as readonly string[]).includes(trust)) {
      return { requirementIndex: index, requirement, type: type as EvidenceType, trustLevel: trust as EvidenceTrustLevel };
    }
  }
  return null;
}

function trustLevelAtLeast(actual: EvidenceTrustLevel, required: EvidenceTrustLevel): boolean {
  const actualRank = EVIDENCE_TRUST_RANK[actual];
  const requiredRank = EVIDENCE_TRUST_RANK[required];
  return actualRank !== undefined && requiredRank !== undefined && actualRank >= requiredRank;
}

function evidenceSatisfiesRequired(record: EvidenceRecord, spec: RequiredEvidenceSpec): boolean {
  return record.type === spec.type
    && trustLevelAtLeast(record.trustLevel, spec.trustLevel)
    && record.status !== 'FAIL';
}

/** Any non-FAIL record at VERIFIED trust or higher. OBSERVED never qualifies. */
function evidenceSatisfiesDefaultFloor(record: EvidenceRecord): boolean {
  return record.status !== 'FAIL' && trustLevelAtLeast(record.trustLevel, DEFAULT_EVIDENCE_FLOOR_TRUST);
}

/**
 * Empty or absent `required_evidence` stays satisfied. Otherwise every entry
 * is classified as `token` or `floor`, and unmet entries keep their rule.
 */
export function checkRequiredEvidence(
  contract: TaskRecord['contract'] | undefined,
  runEvidence: EvidenceRecord[],
): EvidenceGateCheck {
  const required = contract?.required_evidence;
  if (!Array.isArray(required) || required.length === 0) {
    return { satisfied: true, known: [], unmet: [], present: runEvidence };
  }
  const unmet: EvidenceGateUnmet[] = [];
  const known: EvidenceGateRequirement[] = [];
  required.forEach((requirement, index) => {
    const spec = parseRequiredEvidenceSpec(requirement, index);
    if (spec) {
      known.push({ requirementIndex: index, requirement, rule: 'token' });
      if (!runEvidence.some((record) => evidenceSatisfiesRequired(record, spec))) {
        unmet.push({ requirementIndex: index, requirement, parsed: spec });
      }
      return;
    }
    known.push({ requirementIndex: index, requirement, rule: 'floor' });
    if (!runEvidence.some((record) => evidenceSatisfiesDefaultFloor(record))) {
      unmet.push({ requirementIndex: index, requirement });
    }
  });
  return { satisfied: unmet.length === 0, known, unmet, present: runEvidence };
}

export function describeUnmetRequirement(unmet: EvidenceGateUnmet): string {
  const id = `REQ-${unmet.requirementIndex + 1}`;
  return unmet.parsed
    ? `${id} "${unmet.requirement}" (requires ${unmet.parsed.type}/${unmet.parsed.trustLevel})`
    : `${id} "${unmet.requirement}" (floor: VERIFIED evidence absent)`;
}

export function evidenceGateJudgmentRows(check: EvidenceGateCheck): EvidenceGateJudgmentRow[] {
  return check.known.map((row) => ({
    requirementId: `REQ-${row.requirementIndex + 1}`,
    requirement: row.requirement,
    rule: row.rule,
  }));
}
