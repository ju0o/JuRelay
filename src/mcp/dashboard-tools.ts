/**
 * Dashboard read tools (PM widget v4).
 *
 *   relay_pm_get_dashboard — one bounded snapshot for the visual widget:
 *     agents (workerId, display name, working|idle, current task, model if known),
 *     task counts by state, goal list, pending delivery count.
 * Pure read. No judgment, no dispatch, no mutation.
 *
 * P1.8A — project-centric truth, added without changing a single existing key.
 *
 * The old `tasks` counter is a count of *persisted* executionState strings, so a
 * Task whose worker died weeks ago was still counted as RUNNING next to a live
 * one. The additive block answers the questions that counter could not:
 *
 *   projectIdentity  the canonical identity of this storage scope
 *   projects[]        one row per logical project: its Goal, its Task, the agent,
 *                     the model, executionState AND runtimeState, last activity,
 *                     and the next PM action
 *   summary           persistedRunning vs actualActiveRuns / staleRuns /
 *                     orphanRuns / readyTasks / verificationPending
 *   selectedProject   the ONE project the view is about (TASK 7, option C)
 *   activeProjects[]  every project where something may still be running
 *
 * An ORPHAN run is never counted as active, and the legacy keys keep their exact
 * previous shape so the existing widget cannot crash on this change.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as goalTask from '../backend/goal-task.js';
import * as dispatcher from '../backend/dispatcher.js';
import * as pmDelivery from '../backend/pm-delivery.js';
import {
  buildProjectRuntimeViews,
  selectProjectView,
  type ProjectRuntimeSnapshot,
} from '../backend/runtime-truth.js';
import {
  loadProjectRegistry,
  resolveProjectIdentity,
  type ProjectIdentity,
} from '../backend/project-identity.js';
import { PM_WIDGET_RESOURCE_URI, PM_WIDGET_RESOURCE_VERSION } from './app/pm-widget-resource.js';
import { objectSchema, rejectUnknownFields } from './schemas.js';
import type { GoalRecord, TaskRecord } from '../shared/types.js';
import type { McpTool, PmServerContext } from './server.js';

interface AgentEntry {
  workerId: string;
  displayName: string;
  state: 'working' | 'idle';
  taskId: string | null;
  taskTitle: string | null;
  model: string | null;
}

/**
 * What the portfolio is doing right now, plus QA slot pressure.
 *
 * The portfolio is its own rail (Founder 2026-09-29): its workers are deliberately NOT in the ws worker
 * registry, so `agents` — which comes from that registry — cannot describe them. This reads the runner's
 * own small portfolio-live.json mirror instead, which carries the Korean task title, the AI, the pid and
 * whether that process is alive.
 *
 * It never reads state.json: that is ~10 MB of 2 000+ tasks and this tool is polled continuously. A
 * missing, malformed, or partial file yields null and the widget keeps the count it already had.
 */
export interface PortfolioLiveEntry {
  taskId: string;
  title: string;
  projectId: string | null;
  phase: 'build' | 'qa';
  pid: number | null;
  runtime: string | null;
  model: string | null;
  workerId: string;
  workspace: string | null;
  startedAt: string;
  alive: boolean | null;
}

export interface PortfolioLive {
  qaActive: number;
  qaWaiting: number;
  qaTotal: number;
  maxQa: number;
  builders: PortfolioLiveEntry[];
  qa: PortfolioLiveEntry[];
  updatedAt?: string;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readPortfolioLive(dataRoot: string): PortfolioLive | null {
  try {
    const raw = fs.readFileSync(path.join(dataRoot, 'portfolio-execution', 'portfolio-live.json'), 'utf8');
    const parsed = JSON.parse(raw) as Partial<PortfolioLive>;
    const qaActive = num(parsed.qaActive);
    const qaWaiting = num(parsed.qaWaiting);
    if (qaActive === null || qaWaiting === null) return null;
    // A malformed entry is dropped rather than surfaced: the Founder must never see a half-built card.
    const entry = (raw: unknown): PortfolioLiveEntry | null => {
      const e = raw as Partial<PortfolioLiveEntry>;
      if (!e || typeof e.taskId !== 'string' || !e.taskId) return null;
      return {
        taskId: e.taskId,
        // Never an empty title — a blank card tells the Founder nothing.
        title: typeof e.title === 'string' && e.title.trim() ? e.title.trim() : e.taskId,
        projectId: typeof e.projectId === 'string' ? e.projectId : null,
        phase: e.phase === 'qa' ? 'qa' : 'build',
        pid: num(e.pid),
        runtime: typeof e.runtime === 'string' ? e.runtime : null,
        model: typeof e.model === 'string' ? e.model : null,
        workerId: typeof e.workerId === 'string' && e.workerId ? e.workerId : `portfolio-${e.phase ?? 'build'}-${e.taskId}`,
        workspace: typeof e.workspace === 'string' ? e.workspace : null,
        startedAt: typeof e.startedAt === 'string' ? e.startedAt : new Date(0).toISOString(),
        alive: typeof e.alive === 'boolean' ? e.alive : null,
      };
    };
    return {
      qaActive,
      qaWaiting,
      qaTotal: num(parsed.qaTotal) ?? qaActive + qaWaiting,
      maxQa: num(parsed.maxQa) ?? 1,
      builders: Array.isArray(parsed.builders) ? parsed.builders.map(entry).filter((e): e is PortfolioLiveEntry => e !== null) : [],
      qa: Array.isArray(parsed.qa) ? parsed.qa.map(entry).filter((e): e is PortfolioLiveEntry => e !== null) : [],
      ...(typeof parsed.updatedAt === 'string' ? { updatedAt: parsed.updatedAt } : {}),
    };
  } catch {
    return null;
  }
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

/**
 * The canonical identity of this storage scope. Cheap, read-only, and asked for
 * often enough to deserve its own tool (see project-tools.ts).
 */
export function scopeProjectIdentity(dataRoot: string, project: string): ProjectIdentity {
  return resolveProjectIdentity({ scope: project, registry: loadProjectRegistry(dataRoot) });
}

/**
 * Runtime truth for every logical project in this scope.
 *
 * Deliberately never reads the whole Run tree: it consults the Dispatcher's live
 * handles, one /proc sweep (3 s cache), and only the newest linked Run folder of
 * in-flight Tasks. A malformed Task is skipped rather than failing the read.
 */
export function runtimeSnapshot(
  dataRoot: string,
  project: string,
  tasks?: readonly TaskRecord[],
  goals?: readonly GoalRecord[],
): ProjectRuntimeSnapshot {
  const taskList = tasks ?? goalTask.listTasks(dataRoot, project, undefined);
  let goalList: readonly GoalRecord[];
  try {
    goalList = goals ?? goalTask.listGoals(dataRoot, project);
  } catch {
    goalList = [];
  }
  return buildProjectRuntimeViews({
    tasks: taskList,
    goals: goalList,
    scope: project,
    scopeIdentity: scopeProjectIdentity(dataRoot, project),
    registry: loadProjectRegistry(dataRoot),
    liveHandles: dispatcher.listActiveDispatches(project),
    orphanSuspectedOf: (taskId) => dispatcher.getRecoveryRecord(dataRoot, project, taskId) !== undefined,
  });
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
        'state, current task, and model when known; task counts by persisted ' +
        'state; goals; pending delivery count; and portfolio (the live portfolio ' +
        'rail: what its workers are doing, with title, AI, pid, alive flag, and ' +
        'QA slot pressure). ' +
        'P1.8A: also returns projectIdentity, projects[] (per-project Goal, Task, ' +
        'agent, model, executionState AND runtimeState, lastActivityAt, ' +
        'nextAction), summary (actualActiveRuns / staleRuns / orphanRuns / ' +
        'readyTasks / verificationPending vs persistedRunning), selectedProject ' +
        'and activeProjects[]. Pass projectId to choose which project the view is ' +
        'about. ' +
        'Pure read — never judges, dispatches, or mutates.',
      inputSchema: objectSchema({ projectId: { type: 'string' } }),
      handler: async (args: Record<string, unknown>) => {
        rejectUnknownFields(args, ['projectId']);
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
        // P1.8A — the block that makes a stored RUNNING distinguishable from a
        // live Run. Never throws: a read tool that dies on one bad record is
        // worse than one that omits it.
        let runtime: ProjectRuntimeSnapshot | null = null;
        try {
          runtime = runtimeSnapshot(dataRoot, project, tasks);
        } catch {
          runtime = null;
        }
        const selected = runtime
          ? selectProjectView(runtime, args.projectId)
          : { project: null, basis: 'SCOPE' as const };
        const identity = scopeProjectIdentity(dataRoot, project);
        const summary = runtime
          ? {
            projects: runtime.summary.projects,
            tasks: runtime.summary.tasks,
            persistedRunning: runtime.summary.persistedRunning,
            actualActiveRuns: runtime.summary.activeRuns,
            staleRuns: runtime.summary.staleRuns,
            orphanRuns: runtime.summary.orphanRuns,
            readyTasks: runtime.summary.readyTasks,
            verificationPending: runtime.summary.verificationPending,
            generatedAt: runtime.generatedAt,
          }
          : {
            projects: 0,
            tasks: 0,
            persistedRunning: 0,
            actualActiveRuns: 0,
            staleRuns: 0,
            orphanRuns: 0,
            readyTasks: 0,
            verificationPending: 0,
            generatedAt: new Date().toISOString(),
          };
        return {
          project,
          agents,
          tasks: byState,
          goals,
          pendingDeliveries,
          portfolio: readPortfolioLive(dataRoot),
          projectIdentity: {
            projectId: identity.projectId,
            projectName: identity.projectName,
            scope: project,
            legacy: identity.legacy,
            genericBucket: identity.genericBucket,
            source: identity.source,
          },
          projects: runtime ? runtime.projects : [],
          activeProjects: runtime ? runtime.activeProjects : [],
          selectedProject: selected.project,
          selectedProjectBasis: selected.basis,
          summary,
        };
      },
    },
  ];
}
