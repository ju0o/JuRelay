/**
 * Project/design tools (widget control tower).
 *
 *   relay_pm_get_project — P1.8C-04 bounded single-project dashboard read model
 *   relay_pm_get_design  — WBS nodes + designs (still stub empty shapes)
 *
 * Pure read for get_project / get_design. No judgment, no dispatch, no mutation.
 *
 * P1.8A adds `relay_pm_list_projects`: the direct answer to "which projects are
 * registered, and which of them is actually running?". It reads the same runtime
 * truth the dashboard uses, so the two can never disagree.
 *
 * P1.8C-01 adds derived ProjectProfile tools:
 *   relay_pm_list_project_profiles
 *   relay_pm_get_project_profile
 *   relay_pm_select_project   (persists selectedProjectId only; zero execution)
 *
 * P1.8C-02 adds desired-role assignment tools (zero execution):
 *   relay_pm_get_project_assignments
 *   relay_pm_set_project_assignments
 *
 * P1.8C-04 turns `relay_pm_get_project` into the canonical bounded selected-
 * project dashboard (not a full `relay_pm_get_dashboard` clone).
 */
import * as goalTask from '../backend/goal-task.js';
import {
  AssignmentError,
  getProjectAssignments,
  setProjectAssignments,
  type AssignmentBindingInput,
} from '../backend/project-assignment.js';
import {
  getProjectDashboard,
  PROJECT_DASHBOARD_MAX_RECENT_TASKS,
} from '../backend/project-dashboard.js';
import {
  getProjectProfile,
  listProjectProfiles,
  selectProject,
} from '../backend/project-profile.js';
import { loadUiState } from '../backend/ui-state.js';
import { McpError } from './errors.js';
import { runtimeSnapshot, scopeProjectIdentity } from './dashboard-tools.js';
import { objectSchema, rejectUnknownFields, requireString } from './schemas.js';
import type { TaskRecord } from '../shared/types.js';
import type { McpTool, PmServerContext } from './server.js';

function mapAssignmentError(err: unknown): never {
  if (err instanceof AssignmentError) {
    if (err.code === 'NOT_FOUND') throw new McpError('NOT_FOUND', err.message);
    if (err.code === 'PROJECT_CONFIGURATION_REQUIRED') {
      throw new McpError('INVALID_STATE', err.message);
    }
    throw new McpError('INVALID_ARGUMENT', `${err.code}: ${err.message}`);
  }
  throw err;
}

function asBinding(value: unknown, where: string): AssignmentBindingInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new McpError('INVALID_ARGUMENT', `${where} must be an object`);
  }
  const rec = value as Record<string, unknown>;
  const out: AssignmentBindingInput = {};
  for (const key of ['runtime', 'runtimeAdapterId', 'workerId', 'provider', 'model', 'workspaceRoot'] as const) {
    if (rec[key] === undefined) continue;
    if (typeof rec[key] !== 'string') {
      throw new McpError('INVALID_ARGUMENT', `${where}.${key} must be a string`);
    }
    out[key] = rec[key] as string;
  }
  return out;
}

function asBindingList(value: unknown, where: string): AssignmentBindingInput[] {
  if (!Array.isArray(value)) {
    throw new McpError('INVALID_ARGUMENT', `${where} must be an array`);
  }
  return value.map((item, i) => asBinding(item, `${where}[${i}]`));
}

function profileListInput(ctx: PmServerContext, runtimeProjects?: Parameters<typeof listProjectProfiles>[0]['runtimeProjects']) {
  return {
    dataRoot: ctx.dataRoot,
    scope: ctx.project,
    selectedProjectId: loadUiState(ctx.dataRoot).selectedProjectId,
    runtimeProjects,
    hostRoots: ctx.goalLoop?.workspaceRoot ? [ctx.goalLoop.workspaceRoot] : undefined,
  };
}

export function buildProjectTools(ctx: PmServerContext): McpTool[] {
  return [
    {
      name: 'relay_pm_list_projects',
      description:
        'Every logical project this scope knows about, with the truth about each one: ' +
        'its canonical projectId/projectName, its active Goal and Task, the agent and ' +
        'model performing it, executionState (persisted) and runtimeState (derived from ' +
        'real worker evidence: ACTIVE | STALE | ORPHAN | IDLE | UNKNOWN), lastActivityAt, ' +
        'and the next PM action. Counts per project split persistedRunning from ' +
        'actualActiveRuns / staleRuns / orphanRuns. Records filed before project ' +
        'identity existed are reported under their legacy scope with legacy=true. ' +
        'Pure read — never judges, dispatches, or mutates.',
      inputSchema: objectSchema({}),
      handler: async (args: Record<string, unknown>) => {
        rejectUnknownFields(args, []);
        const { dataRoot, project } = ctx;
        const identity = scopeProjectIdentity(dataRoot, project);
        let tasks: TaskRecord[] = [];
        try {
          tasks = goalTask.listTasks(dataRoot, project, undefined);
        } catch {
          tasks = [];
        }
        const snapshot = runtimeSnapshot(dataRoot, project, tasks);
        return {
          project,
          projectIdentity: {
            projectId: identity.projectId,
            projectName: identity.projectName,
            legacy: identity.legacy,
            genericBucket: identity.genericBucket,
            source: identity.source,
          },
          projects: snapshot.projects,
          activeProjects: snapshot.activeProjects,
          summary: snapshot.summary,
          generatedAt: snapshot.generatedAt,
        };
      },
    },
    {
      name: 'relay_pm_list_project_profiles',
      description:
        'Bounded derived ProjectProfile views for this storage scope. Aggregates ' +
        'ProjectIdentity + WorkspaceConfigV2 + RoleConfig + WorkerRegistry availability ' +
        '+ runtime truth. Does NOT create a profile database. Legacy buckets such as ' +
        '`ws` appear as LEGACY and are never merged into canonical agent-relay. ' +
        'availableWorkers is availability only — not assignment. Pure read.',
      inputSchema: objectSchema({}),
      handler: async (args: Record<string, unknown>) => {
        rejectUnknownFields(args, []);
        const { dataRoot, project } = ctx;
        let tasks: TaskRecord[] = [];
        try {
          tasks = goalTask.listTasks(dataRoot, project, undefined);
        } catch {
          tasks = [];
        }
        let runtimeProjects: ReturnType<typeof runtimeSnapshot>['projects'] = [];
        try {
          runtimeProjects = runtimeSnapshot(dataRoot, project, tasks).projects;
        } catch {
          runtimeProjects = [];
        }
        const listed = listProjectProfiles(profileListInput(ctx, runtimeProjects));
        return {
          project,
          projectIdentity: {
            projectId: listed.scopeIdentity.projectId,
            projectName: listed.scopeIdentity.projectName,
            legacy: listed.scopeIdentity.legacy,
            genericBucket: listed.scopeIdentity.genericBucket,
            source: listed.scopeIdentity.source,
          },
          selectedProjectId: listed.selectedProjectId,
          profiles: listed.profiles,
          generatedAt: listed.generatedAt,
        };
      },
    },
    {
      name: 'relay_pm_get_project_profile',
      description:
        'One derived ProjectProfile view by projectId. Same aggregation rules as ' +
        'relay_pm_list_project_profiles. Pure read — never mutates.',
      inputSchema: objectSchema({ projectId: { type: 'string' } }, ['projectId']),
      handler: async (args: Record<string, unknown>) => {
        rejectUnknownFields(args, ['projectId']);
        const projectId = requireString(args, 'projectId');
        const { dataRoot, project } = ctx;
        let tasks: TaskRecord[] = [];
        try {
          tasks = goalTask.listTasks(dataRoot, project, undefined);
        } catch {
          tasks = [];
        }
        let runtimeProjects: ReturnType<typeof runtimeSnapshot>['projects'] = [];
        try {
          runtimeProjects = runtimeSnapshot(dataRoot, project, tasks).projects;
        } catch {
          runtimeProjects = [];
        }
        const profile = getProjectProfile(profileListInput(ctx, runtimeProjects), projectId);
        if (!profile) {
          throw new McpError('NOT_FOUND', `project profile not found: ${projectId}`);
        }
        return { project, profile };
      },
    },
    {
      name: 'relay_pm_select_project',
      description:
        'Persist the PM selectedProjectId only (CURRENT USER CONTEXT CHANGED). ' +
        'Does NOT create Goal/Task, dispatch, spawn Worker, open terminal/tmux, ' +
        'mutate workspace files, modify role assignments, or touch Git. ' +
        'Unknown projectId is rejected.',
      inputSchema: objectSchema({ projectId: { type: 'string' } }, ['projectId']),
      handler: async (args: Record<string, unknown>) => {
        rejectUnknownFields(args, ['projectId']);
        const projectId = requireString(args, 'projectId');
        const { dataRoot, project } = ctx;
        let tasks: TaskRecord[] = [];
        try {
          tasks = goalTask.listTasks(dataRoot, project, undefined);
        } catch {
          tasks = [];
        }
        let runtimeProjects: ReturnType<typeof runtimeSnapshot>['projects'] = [];
        try {
          runtimeProjects = runtimeSnapshot(dataRoot, project, tasks).projects;
        } catch {
          runtimeProjects = [];
        }
        try {
          const result = selectProject(profileListInput(ctx, runtimeProjects), projectId);
          return {
            project,
            ok: result.ok,
            selectedProjectId: result.selectedProjectId,
            profile: result.profile,
            updatedAt: result.uiState.updatedAt,
            sideEffects: result.sideEffects,
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (/unknown projectId/i.test(msg)) {
            throw new McpError('NOT_FOUND', msg);
          }
          if (/projectId/i.test(msg)) {
            throw new McpError('INVALID_ARGUMENT', msg);
          }
          throw err;
        }
      },
    },
    {
      name: 'relay_pm_get_project_assignments',
      description:
        'Read the desired agent assignments for one project (PM / builders / QA). ' +
        'Derived from WorkspaceConfigV2 or RoleConfig — no assignment database. ' +
        'availableWorkers is availability only, never assignment. Pure read. ' +
        'UNCONFIGURED projects return configurationRequired=true with empty roles.',
      inputSchema: objectSchema({ projectId: { type: 'string' } }, ['projectId']),
      handler: async (args: Record<string, unknown>) => {
        rejectUnknownFields(args, ['projectId']);
        const projectId = requireString(args, 'projectId');
        try {
          const assignment = getProjectAssignments(profileListInput(ctx), projectId);
          return { project: ctx.project, assignment };
        } catch (err) {
          mapAssignmentError(err);
        }
      },
    },
    {
      name: 'relay_pm_set_project_assignments',
      description:
        'Atomically replace desired agent assignments for one project. ' +
        'Writes the owning store only (WorkspaceConfigV2 lane or RoleConfig). ' +
        'Does NOT create Goal/Task/Run, spawn Worker, open tmux, change workspacePath, ' +
        'or change selectedProjectId. Unknown workers/runtimes fail closed. ' +
        'UNCONFIGURED projects are rejected with PROJECT_CONFIGURATION_REQUIRED.',
      inputSchema: objectSchema(
        {
          projectId: { type: 'string' },
          pm: { type: ['object', 'null'] },
          builders: { type: 'array', items: { type: 'object' } },
          qa: { type: 'array', items: { type: 'object' } },
        },
        ['projectId', 'pm', 'builders', 'qa'],
      ),
      handler: async (args: Record<string, unknown>) => {
        rejectUnknownFields(args, ['projectId', 'pm', 'builders', 'qa']);
        const projectId = requireString(args, 'projectId');
        const pm = args.pm === null ? null : asBinding(args.pm, 'pm');
        const builders = asBindingList(args.builders, 'builders');
        const qa = asBindingList(args.qa, 'qa');
        try {
          const result = setProjectAssignments(profileListInput(ctx), {
            projectId,
            pm,
            builders,
            qa,
          });
          return {
            project: ctx.project,
            ok: result.ok,
            store: result.store,
            assignment: result.assignment,
            profile: result.profile,
            sideEffects: result.sideEffects,
          };
        } catch (err) {
          mapAssignmentError(err);
        }
      },
    },
    {
      name: 'relay_pm_get_project',
      description:
        'Bounded single-project dashboard for the selected (or explicit) project. ' +
        'Returns project/path, desired assignment, active Goal, current Task with ' +
        'runtimeState (ACTIVE|STALE|ORPHAN|IDLE|UNKNOWN distinct from persisted ' +
        'executionState), nextAction/nextActionText, bounded counts, and at most ' +
        `${PROJECT_DASHBOARD_MAX_RECENT_TASKS} recent Tasks. ` +
        'Optional projectId overrides the view for this read only — never persists ' +
        'selection. Pure read: zero Goals/Tasks/Runs/workers/assignment/workspace/' +
        'selection mutations. Prefer this over relay_pm_get_dashboard for the ' +
        'selected-project screen (dashboard can exceed host token budgets).',
      inputSchema: objectSchema({ projectId: { type: 'string' } }),
      handler: async (args: Record<string, unknown>) => {
        rejectUnknownFields(args, ['projectId']);
        const projectId = typeof args.projectId === 'string' && args.projectId.trim()
          ? args.projectId.trim()
          : undefined;
        const view = getProjectDashboard({
          dataRoot: ctx.dataRoot,
          scope: ctx.project,
          projectId,
          hostRoots: ctx.goalLoop?.workspaceRoot ? [ctx.goalLoop.workspaceRoot] : undefined,
        });
        return {
          // Storage scope (MCP --project), distinct from view.project object.
          scope: ctx.project,
          schemaVersion: view.schemaVersion,
          basis: view.basis,
          argumentOverride: view.argumentOverride,
          project: view.project,
          assignment: view.assignment,
          goal: view.goal,
          task: view.task,
          recentTasks: view.recentTasks,
          // Alias for older Goal/Task tab code that expected `tasks[]`.
          tasks: view.recentTasks,
          counts: view.counts,
          nextAction: view.nextAction,
          nextActionText: view.nextActionText,
          warnings: view.warnings,
          empty: view.empty,
          runEligibility: view.runEligibility,
          generatedAt: view.generatedAt,
          sideEffects: view.sideEffects,
          summary: {
            done: 0,
            review: view.counts.verificationPending,
            remaining: view.counts.readyTasks,
            total: view.counts.tasks,
            elapsed_hours: 0,
            review_hours: 0,
            remaining_hours: 0,
            persistedRunning: view.counts.persistedRunning,
            actualActiveRuns: view.counts.actualActiveRuns,
            staleRuns: view.counts.staleRuns,
            orphanRuns: view.counts.orphanRuns,
            readyTasks: view.counts.readyTasks,
            verificationPending: view.counts.verificationPending,
          },
        };
      },
    },
    {
      name: 'relay_pm_get_design',
      description:
        'Design snapshot for the widget control tower (WBS nodes, designs). ' +
        'Stub in v6: returns empty shapes; the widget renders empty states. Pure read. ' +
        'designs[].kind is one of erd|wireframe|prototype|wbs.',
      inputSchema: objectSchema({}),
      handler: async (args: Record<string, unknown>) => {
        rejectUnknownFields(args, []);
        return { kind: 'wbs', nodes: [], designs: [] };
      },
    },
  ];
}