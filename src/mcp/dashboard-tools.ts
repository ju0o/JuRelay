/**
 * Dashboard read tools (PM widget v4).
 *
 *   relay_pm_get_dashboard — one bounded snapshot for the visual widget:
 *     agents (workerId, display name, working|idle, current task, model if known),
 *     task counts by state, goal list, pending delivery count.
 * Pure read. No judgment, no dispatch, no mutation.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as goalTask from '../backend/goal-task.js';
import * as dispatcher from '../backend/dispatcher.js';
import * as pmDelivery from '../backend/pm-delivery.js';
import { PM_WIDGET_RESOURCE_URI, PM_WIDGET_RESOURCE_VERSION } from './app/pm-widget-resource.js';
import { objectSchema, rejectUnknownFields } from './schemas.js';
import type { McpTool, PmServerContext } from './server.js';

interface AgentEntry {
  workerId: string;
  displayName: string;
  state: 'working' | 'idle';
  taskId: string | null;
  taskTitle: string | null;
  model: string | null;
}

function latestLaunchModel(folders: string[]): string | null {
  // Newest run folder first; read worker-launch.log `model` when present.
  const sorted = [...folders].sort().reverse().slice(0, 3);
  for (const folder of sorted) {
    try {
      const text = fs.readFileSync(path.join(folder, 'worker-launch.log'), 'utf8');
      const match = text.match(/"model"\s*:\s*"([^"]+)"/);
      if (match) return match[1];
    } catch {
      // No launch log here — keep looking.
    }
  }
  return null;
}

function runFoldersFor(dataRoot: string, project: string, workerId: string): string[] {
  const out: string[] = [];
  let dates: string[] = [];
  try {
    dates = fs.readdirSync(path.join(dataRoot, project));
  } catch {
    return out;
  }
  for (const date of dates.slice(-14)) {
    const dir = path.join(dataRoot, project, date, `worker-${workerId}`);
    let runs: string[] = [];
    try {
      runs = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const run of runs) out.push(path.join(dir, run));
  }
  return out;
}

export function buildDashboardTools(ctx: PmServerContext): McpTool[] {
  const { dataRoot, project } = ctx;
  return [
    {
      name: 'relay_pm_get_widget_version',
      description:
        'Current widget resource identity (uri, version). The widget polls this ' +
        'itself to notice a newer bundle without any host cache-clear. Pure read.',
      inputSchema: objectSchema({}),
      handler: async (args: Record<string, unknown>) => {
        rejectUnknownFields(args, []);
        return { uri: PM_WIDGET_RESOURCE_URI, version: PM_WIDGET_RESOURCE_VERSION };
      },
    },
    {
      name: 'relay_pm_get_dashboard',
      description:
        'One bounded snapshot for the visual PM widget: agents with working|idle ' +
        'state, current task, and model when known; task counts by state; goals; ' +
        'pending delivery count. Pure read — never judges, dispatches, or mutates.',
      inputSchema: objectSchema({}),
      handler: async (args: Record<string, unknown>) => {
        rejectUnknownFields(args, []);
        const tasks = goalTask.listTasks(dataRoot, project, undefined);
        const byState: Record<string, number> = {};
        const agentTask = new Map<string, { taskId: string; title: string; running: boolean }>();
        for (const task of tasks) {
          byState[task.executionState] = (byState[task.executionState] ?? 0) + 1;
          for (const link of task.linkedRuns || []) {
            const agent = (link as { agent?: string }).agent;
            if (!agent) continue;
            const running = task.executionState === 'RUNNING' || task.executionState === 'DISPATCHED';
            const prev = agentTask.get(agent);
            if (!prev || (running && !prev.running)) {
              agentTask.set(agent, { taskId: task.taskId, title: task.title, running });
            }
          }
        }
        const agents: AgentEntry[] = dispatcher.listWorkersPublic(dataRoot).map((w) => {
          const cur = agentTask.get(w.workerId);
          return {
            workerId: w.workerId,
            displayName: w.displayName || w.workerId,
            state: cur?.running ? 'working' : 'idle',
            taskId: cur?.taskId ?? null,
            taskTitle: cur?.title ?? null,
            model: latestLaunchModel(runFoldersFor(dataRoot, project, w.workerId)),
          };
        });
        let goals: Array<{ goalId: string; title: string; status: string }> = [];
        try {
          goals = goalTask.listGoals(dataRoot, project).map((g) => ({
            goalId: g.goalId, title: g.title, status: g.status,
          }));
        } catch {
          goals = [];
        }
        let pendingDeliveries = 0;
        try {
          pendingDeliveries = pmDelivery.listPendingPmDeliveries(dataRoot, project).length;
        } catch {
          pendingDeliveries = 0;
        }
        return { project, agents, tasks: byState, goals, pendingDeliveries };
      },
    },
  ];
}
