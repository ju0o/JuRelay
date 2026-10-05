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
 */
import * as goalTask from '../backend/goal-task.js';
import { runtimeSnapshot, scopeProjectIdentity } from './dashboard-tools.js';
import { objectSchema, rejectUnknownFields } from './schemas.js';
import type { TaskRecord } from '../shared/types.js';
import type { McpTool, PmServerContext } from './server.js';

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