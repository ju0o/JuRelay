/**
 * Worker-facing MCP tool registration (Phase E).
 *
 * Worker surface is scope-bound at process startup:
 *   dataRoot / project / taskId / runId are immutable process configuration.
 *   Callers cannot override them via tool arguments.
 *
 * Trust boundary:
 *   All writes use recordWorkerClaim → WORKER_CLAIM / CLAIMED.
 *   Workers CANNOT mint VERIFIED, ACCEPTED, PM_DECISION, or privileged Events.
 *   Workers CANNOT enumerate unrelated project Tasks.
 *   Workers CANNOT read foreign Tasks or Runs (FORBIDDEN).
 *
 * AGENT RESULT ≠ TASK OUTCOME:
 *   relay_worker_submit_result records a WORKER_CLAIM evidence entry only.
 *   It does NOT write result.md, does NOT call markResultReceived, and does
 *   NOT mutate Task executionState or pmState.
 *
 * relay_worker_report_blocked records WORKER_CLAIM evidence only.
 *   It does NOT call transitionExecution(... BLOCKED).
 */
import * as goalTask from '../backend/goal-task.js';
import * as evidenceKernel from '../backend/evidence.js';
import * as assetKernel from '../backend/asset-request.js';
import { McpError } from './errors.js';
import {
  objectSchema,
  optionalString,
  rejectUnknownFields,
  requireString,
} from './schemas.js';
import type { McpTool, WorkerServerContext } from './server.js';

// Re-export WorkerServerContext for convenience
export type { WorkerServerContext };

// ── helpers ─────────────────────────────────────────────────────────────────

function assertBoundTask(requestedTaskId: string, ctx: WorkerServerContext): void {
  if (requestedTaskId !== ctx.taskId) {
    throw new McpError(
      'FORBIDDEN',
      `Worker is bound to taskId=${ctx.taskId}; access to taskId=${requestedTaskId} is FORBIDDEN.`,
    );
  }
}

function assertBoundRun(requestedRunId: string, ctx: WorkerServerContext): void {
  if (requestedRunId !== ctx.runId) {
    throw new McpError(
      'FORBIDDEN',
      `Worker is bound to runId=${ctx.runId}; access to runId=${requestedRunId} is FORBIDDEN.`,
    );
  }
}

// ── Worker read tools ────────────────────────────────────────────────────────

/** Worker read tools — scope-bound to process taskId / runId. */
export function buildWorkerReadTools(ctx: WorkerServerContext): McpTool[] {
  const { dataRoot, project, taskId, runId } = ctx;
  return [
    {
      name: 'relay_worker_get_assignment',
      description:
        'Return the bound assignment (project, taskId, runId) from process configuration. No arguments accepted.',
      inputSchema: objectSchema({}),
      handler: async (args) => {
        rejectUnknownFields(args, []);
        return {
          project,
          taskId,
          runId,
          ...(ctx.clientId ? { clientId: ctx.clientId } : {}),
          ...(ctx.agentId ? { agentId: ctx.agentId } : {}),
          ...(ctx.sessionId ? { sessionId: ctx.sessionId } : {}),
        };
      },
    },
    {
      name: 'relay_worker_get_task_context',
      description:
        'Read the bound Task record. ' +
        'Accepts an optional taskId that MUST match the bound taskId — any other value returns FORBIDDEN.',
      inputSchema: objectSchema({ taskId: { type: 'string' } }),
      handler: async (args) => {
        rejectUnknownFields(args, ['taskId']);
        const requested = optionalString(args, 'taskId');
        if (requested) {
          assertBoundTask(requested, ctx);
        }
        return goalTask.getTask(dataRoot, project, taskId);
      },
    },
    {
      name: 'relay_worker_get_run_context',
      description:
        'Read the bound Run metadata. ' +
        'Accepts an optional runId that MUST match the bound runId — any other value returns FORBIDDEN.',
      inputSchema: objectSchema({ runId: { type: 'string' } }),
      handler: async (args) => {
        rejectUnknownFields(args, ['runId']);
        const requested = optionalString(args, 'runId');
        if (requested) {
          assertBoundRun(requested, ctx);
        }
        const task = goalTask.getTask(dataRoot, project, taskId);
        const link = task.linkedRuns.find((r) => r.runId === runId);
        if (!link) {
          throw new McpError('NOT_FOUND', `Run '${runId}' is not linked to bound task '${taskId}'.`);
        }
        return {
          runId: link.runId,
          folder: link.folder,
          taskRunSequence: link.taskRunSequence,
          agent: link.agent,
          date: link.date,
          taskId,
          goalId: task.goalId,
          project,
        };
      },
    },
    {
      name: 'relay_worker_get_previous_attempts',
      description:
        'List prior linked runs of the bound task, excluding the current bound run. ' +
        'Useful for reviewing earlier attempt context before starting work.',
      inputSchema: objectSchema({}),
      handler: async (args) => {
        rejectUnknownFields(args, []);
        const task = goalTask.getTask(dataRoot, project, taskId);
        const priorAttempts = task.linkedRuns.filter((r) => r.runId !== runId);
        return { taskId, currentRunId: runId, priorAttempts };
      },
    },
  ];
}

// ── Worker write tools ────────────────────────────────────────────────────────

/**
 * Worker write tools — all writes use recordWorkerClaim (WORKER_CLAIM / CLAIMED).
 *
 * Workers CANNOT:
 *   - mint VERIFIED or ACCEPTED evidence
 *   - create PM_DECISION evidence
 *   - create privileged Events (RUN_RESULT_RECEIVED, etc.)
 *   - accept a Task result (no acceptResult call)
 *   - transition Task execution state (no transitionTaskExecution call)
 *   - write result.md or agent-result.md
 *   - call markResultReceived
 */
export function buildWorkerWriteTools(ctx: WorkerServerContext): McpTool[] {
  const { dataRoot, project, taskId, runId } = ctx;

  /** Build source metadata merged with optional caller-supplied metadata. */
  function buildMeta(extra: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      ...extra,
      ...(ctx.clientId ? { clientId: ctx.clientId } : {}),
      ...(ctx.agentId ? { agentId: ctx.agentId } : {}),
      ...(ctx.sessionId ? { sessionId: ctx.sessionId } : {}),
    };
  }

  return [
    {
      name: 'relay_worker_submit_claim',
      description:
        'Record a Worker Claim Evidence entry for the bound run. ' +
        'Trust level is always WORKER_CLAIM / CLAIMED — workers cannot mint VERIFIED or ACCEPTED.',
      inputSchema: objectSchema(
        {
          summary: { type: 'string' },
          artifactRefs: { type: 'array', items: { type: 'string' } },
          metadata: { type: 'object' },
        },
        ['summary'],
      ),
      handler: async (args) => {
        rejectUnknownFields(args, ['summary', 'artifactRefs', 'metadata']);
        const summary = requireString(args, 'summary');
        const artifactRefs = Array.isArray(args.artifactRefs)
          ? (args.artifactRefs as string[])
          : undefined;
        const userMeta =
          args.metadata && typeof args.metadata === 'object' && !Array.isArray(args.metadata)
            ? (args.metadata as Record<string, unknown>)
            : {};
        const task = goalTask.getTask(dataRoot, project, taskId);
        return evidenceKernel.recordWorkerClaim(dataRoot, project, {
          summary,
          goalId: task.goalId,
          taskId,
          runId,
          artifactRefs,
          metadata: buildMeta(userMeta),
          source: { kind: 'worker' },
        });
      },
    },
    {
      name: 'relay_worker_report_progress',
      description:
        'Record a progress note as Worker Claim Evidence. ' +
        'Does NOT mutate Task executionState or pmState.',
      inputSchema: objectSchema(
        {
          summary: { type: 'string' },
          metadata: { type: 'object' },
        },
        ['summary'],
      ),
      handler: async (args) => {
        rejectUnknownFields(args, ['summary', 'metadata']);
        const summary = requireString(args, 'summary');
        const userMeta =
          args.metadata && typeof args.metadata === 'object' && !Array.isArray(args.metadata)
            ? (args.metadata as Record<string, unknown>)
            : {};
        const task = goalTask.getTask(dataRoot, project, taskId);
        return evidenceKernel.recordWorkerClaim(dataRoot, project, {
          summary: `[PROGRESS] ${summary}`,
          goalId: task.goalId,
          taskId,
          runId,
          metadata: buildMeta({ ...userMeta, progressNote: true }),
          source: { kind: 'worker' },
        });
      },
    },
    {
      name: 'relay_worker_report_blocked',
      description:
        'Record a blocked signal as Worker Claim Evidence. ' +
        'Does NOT call transitionExecution(BLOCKED) or mutate any Task state field.',
      inputSchema: objectSchema(
        {
          reason: { type: 'string' },
          metadata: { type: 'object' },
        },
        ['reason'],
      ),
      handler: async (args) => {
        rejectUnknownFields(args, ['reason', 'metadata']);
        const reason = requireString(args, 'reason');
        const userMeta =
          args.metadata && typeof args.metadata === 'object' && !Array.isArray(args.metadata)
            ? (args.metadata as Record<string, unknown>)
            : {};
        const task = goalTask.getTask(dataRoot, project, taskId);
        return evidenceKernel.recordWorkerClaim(dataRoot, project, {
          summary: `[BLOCKED] ${reason}`,
          goalId: task.goalId,
          taskId,
          runId,
          status: 'INCONCLUSIVE',
          metadata: buildMeta({ ...userMeta, blocked: true }),
          source: { kind: 'worker' },
        });
      },
    },
    {
      name: 'relay_worker_submit_result',
      description:
        'Record a result claim as Worker Claim Evidence for the bound run. ' +
        'Does NOT write result.md, does NOT call markResultReceived, ' +
        'does NOT mutate Task executionState or pmState. ' +
        'AGENT RESULT ≠ TASK OUTCOME — the adapter remains the independent observer.',
      inputSchema: objectSchema(
        {
          summary: { type: 'string' },
          artifactRefs: { type: 'array', items: { type: 'string' } },
          metadata: { type: 'object' },
        },
        ['summary'],
      ),
      handler: async (args) => {
        rejectUnknownFields(args, ['summary', 'artifactRefs', 'metadata']);
        const summary = requireString(args, 'summary');
        const artifactRefs = Array.isArray(args.artifactRefs)
          ? (args.artifactRefs as string[])
          : undefined;
        const userMeta =
          args.metadata && typeof args.metadata === 'object' && !Array.isArray(args.metadata)
            ? (args.metadata as Record<string, unknown>)
            : {};
        const task = goalTask.getTask(dataRoot, project, taskId);
        return evidenceKernel.recordWorkerClaim(dataRoot, project, {
          summary: `[RESULT] ${summary}`,
          goalId: task.goalId,
          taskId,
          runId,
          artifactRefs,
          metadata: buildMeta({ ...userMeta, resultClaim: true }),
          source: { kind: 'worker' },
        });
      },
    },
    {
      name: 'relay_worker_request_asset',
      description:
        'Request an image/asset for the bound run (Image Asset Harness). ' +
        'Creates a Task-scoped ASSET_REQUEST (idempotent: same kind+path+prompt ' +
        'returns the existing record). Does NOT generate anything itself; ' +
        'Relay routes it to the configured generation backend. ' +
        'output_path must stay inside the run workspace. ' +
        'Does NOT mutate Task executionState/pmState.',
      inputSchema: objectSchema(
        {
          asset_kind: { type: 'string' },
          purpose: { type: 'string' },
          prompt: { type: 'string' },
          negative_prompt: { type: 'string' },
          style: { type: 'string' },
          aspect_ratio: { type: 'string' },
          transparent_background: { type: 'boolean' },
          output_path: { type: 'string' },
          reference_asset_ids: { type: 'array', items: { type: 'string' } },
          edit_target_asset_id: { type: 'string' },
          svg: { type: 'string' },
          count: { type: 'number' },
          priority: { type: 'string' },
        },
        ['asset_kind', 'purpose', 'prompt', 'output_path'],
      ),
      handler: async (args) => {
        rejectUnknownFields(args, [
          'asset_kind', 'purpose', 'prompt', 'negative_prompt', 'style',
          'aspect_ratio', 'transparent_background', 'output_path',
          'reference_asset_ids', 'edit_target_asset_id', 'svg', 'count', 'priority',
        ]);
        const count = args.count;
        if (count !== undefined && (!Number.isInteger(count) || (count as number) < 1)) {
          throw new McpError('INVALID_ARGUMENT', '잘못된 인자 형식: count');
        }
        const transparent = args.transparent_background;
        if (transparent !== undefined && typeof transparent !== 'boolean') {
          throw new McpError('INVALID_ARGUMENT', '잘못된 인자 형식: transparent_background');
        }
        const refs = args.reference_asset_ids;
        if (refs !== undefined && (!Array.isArray(refs) || !refs.every((x) => typeof x === 'string'))) {
          throw new McpError('INVALID_ARGUMENT', '잘못된 인자 형식: reference_asset_ids');
        }
        const svg = optionalString(args, 'svg');
        try {
          const workspaceRoot = assetKernel.workspaceRootForRun(dataRoot, project, taskId, runId);
          const { record, created } = assetKernel.createAssetRequest(dataRoot, project, {
            asset_kind: requireString(args, 'asset_kind'),
            purpose: requireString(args, 'purpose'),
            prompt: requireString(args, 'prompt'),
            negative_prompt: optionalString(args, 'negative_prompt'),
            style: optionalString(args, 'style'),
            aspect_ratio: optionalString(args, 'aspect_ratio'),
            transparent_background: transparent as boolean | undefined,
            output_path: requireString(args, 'output_path'),
            reference_asset_ids: refs as string[] | undefined,
            edit_target_asset_id: optionalString(args, 'edit_target_asset_id'),
            svg,
            count: count as number | undefined,
            priority: optionalString(args, 'priority'),
            owner_task_id: taskId,
            requester_run_id: runId,
            workspaceRoot,
          });
          return { assetId: record.assetId, status: record.status, created };
        } catch (err) {
          if (err instanceof assetKernel.AssetRequestError) {
            throw new McpError(err.code === 'NOT_FOUND' ? 'NOT_FOUND' : 'INVALID_ARGUMENT', err.message);
          }
          throw err;
        }
      },
    },
    {
      name: 'relay_worker_get_asset',
      description:
        'Read one ASSET_REQUEST bound to this run (status, result path, failure). ' +
        'Workers can only read assets of their own taskId/runId. Pure read.',
      inputSchema: objectSchema({ assetId: { type: 'string' } }, ['assetId']),
      handler: async (args) => {
        rejectUnknownFields(args, ['assetId']);
        const assetId = requireString(args, 'assetId');
        try {
          const rec = assetKernel.getAssetRequest(dataRoot, project, assetId);
          if (rec.taskId !== taskId || rec.runId !== runId) {
            throw new McpError('FORBIDDEN', `Asset belongs to another run; access is FORBIDDEN.`);
          }
          return {
            assetId: rec.assetId, status: rec.status, assetKind: rec.assetKind,
            outputPath: rec.outputPath, result: rec.result ?? null,
            failureReason: rec.failureReason ?? null, attempts: rec.attempts,
          };
        } catch (err) {
          if (err instanceof assetKernel.AssetRequestError) {
            throw new McpError(err.code === 'NOT_FOUND' ? 'NOT_FOUND' : 'INVALID_ARGUMENT', err.message);
          }
          throw err;
        }
      },
    },
  ];
}

/** All Worker tools (read + write). No PM tools included. */
export function buildAllWorkerTools(ctx: WorkerServerContext): McpTool[] {
  return [...buildWorkerReadTools(ctx), ...buildWorkerWriteTools(ctx)];
}
