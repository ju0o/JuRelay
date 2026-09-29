/**
 * Project/design read stubs (widget v6 control tower).
 *
 *   relay_pm_get_project — goal + tasks + summary for the Goal/Task tabs.
 *   relay_pm_get_design  — WBS nodes + designs for the design tab.
 *
 * v6 ships these as stubs (empty shapes → widget shows empty states).
 * v7 wires real data. Pure read. No judgment, no dispatch, no mutation.
 */
import { objectSchema, rejectUnknownFields } from './schemas.js';
import type { McpTool, PmServerContext } from './server.js';

export function buildProjectTools(_ctx: PmServerContext): McpTool[] {
  return [
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
