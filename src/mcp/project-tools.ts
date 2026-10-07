/**
 * Project/design read stubs (widget v6 control tower).
 *
 *   relay_pm_get_project — goal + tasks + summary for the Goal/Task tabs.
 *   relay_pm_get_design  — WBS nodes + designs for the design tab.
 *
 * v6 ships these as stubs (empty shapes → widget shows empty states).
 * v7 wires real data. Pure read. No judgment, no dispatch, no mutation.
 *
 * P1.8A adds `relay_pm_list_projects`: the direct answer to "which projects are
 * registered, and which of them is actually running?". It reads the same runtime
 * truth the dashboard uses, so the two can never disagree.
 *
 * P1.8C-01 adds derived ProjectProfile tools:
 *   relay_pm_list_project_profiles
 *   relay_pm_get_project_profile
 *   relay_pm_select_project   (persists selectedProjectId only; zero execution)
 */
import * as goalTask from '../backend/goal-task.js';
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
      name: 'relay_pm_get_project',
      description:
        'Project snapshot for the widget control tower (goal, tasks, summary). ' +
        'Stub in v6: returns empty shapes; the widget renders empty states. Pure read.',
      inputSchema: objectSchema({}),
      handler: async (args: Record<string, unknown>) => {
        rejectUnknownFields(args, []);
        return {
          goal: null,
          tasks: [],
          summary: {
            done: 0, review: 0, remaining: 0, total: 0,
            elapsed_hours: 0, review_hours: 0, remaining_hours: 0,
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