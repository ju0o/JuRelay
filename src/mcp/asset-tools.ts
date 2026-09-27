/**
 * Asset PM tools (Image Asset Harness, T7).
 *
 *   relay_pm_deliver_asset — ChatGPT delivers generated pixels by URL.
 *     Relay itself downloads, validates, and writes the file.
 *     No API keys, no chat-mcp dependency.
 *   relay_pm_list_assets — pure read of this project's asset requests.
 */
import * as assetKernel from '../backend/asset-request.js';
import { CHATGPT_BACKEND_ID, fetchImageToWorkspace } from '../backend/asset-chatgpt.js';
import { objectSchema, optionalString, rejectUnknownFields, requireString } from './schemas.js';
import { mapCoreError } from './errors.js';
import { McpError } from './errors.js';
import type { McpTool, PmServerContext } from './server.js';

function positiveInt(value: unknown, name: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Number.isInteger(value) || (value as number) <= 0) {
    throw new McpError('INVALID_ARGUMENT', `잘못된 인자 형식: ${name}`);
  }
  return value as number;
}

export function buildAssetPmTools(ctx: PmServerContext): McpTool[] {
  const { dataRoot, project } = ctx;
  return [
    {
      name: 'relay_pm_deliver_asset',
      description:
        'Deliver ChatGPT-generated image pixels for an ASSET_REQUEST. ' +
        'Relay downloads the imageUrl itself (https + allowlisted host only), ' +
        'validates magic bytes and size, and writes it under the run workspace. ' +
        'REQUESTED assets auto-route to the chatgpt backend first. ' +
        'Returns the stored path and QA-pending status.',
      inputSchema: objectSchema(
        {
          assetId: { type: 'string' },
          imageUrl: { type: 'string' },
          width: { type: 'number' },
          height: { type: 'number' },
        },
        ['assetId', 'imageUrl'],
      ),
      handler: async (args) => {
        rejectUnknownFields(args, ['assetId', 'imageUrl', 'width', 'height']);
        const assetId = requireString(args, 'assetId');
        const imageUrl = requireString(args, 'imageUrl');
        const width = positiveInt(args.width, 'width');
        const height = positiveInt(args.height, 'height');
        try {
          let rec = assetKernel.getAssetRequest(dataRoot, project, assetId);
          if (rec.status === 'REQUESTED') {
            rec = assetKernel.routeAssetRequest(dataRoot, project, assetId, CHATGPT_BACKEND_ID);
          }
          if (rec.backendId !== CHATGPT_BACKEND_ID) {
            throw new assetKernel.AssetRequestError(
              'INVALID_STATE', `asset ${assetId} is bound to backend ${rec.backendId ?? '-'}.`,
            );
          }
          if (rec.status === 'ROUTED' || rec.status === 'REWORK') {
            rec = assetKernel.markAssetGenerating(dataRoot, project, assetId);
          } else if (rec.status !== 'GENERATING') {
            throw new assetKernel.AssetRequestError(
              'CONFLICT', `expected=GENERATING but found ${rec.status} (deliver).`,
            );
          }
          const workspaceRoot = assetKernel.workspaceRootForRun(
            dataRoot, project, rec.taskId, rec.runId,
          );
          const fetched = await fetchImageToWorkspace(imageUrl, workspaceRoot, rec.outputPath);
          void fetched;
          const done = assetKernel.markAssetDelivered(
            dataRoot, project, assetId,
            { path: rec.outputPath, width, height, source: CHATGPT_BACKEND_ID },
          );
          return {
            assetId: done.assetId, status: done.status,
            outputPath: done.outputPath, source: done.result?.source ?? null,
          };
        } catch (err) {
          if (err instanceof assetKernel.AssetRequestError) {
            throw mapCoreError(err);
          }
          throw new McpError('INVALID_ARGUMENT', err instanceof Error ? err.message : String(err));
        }
      },
    },
    {
      name: 'relay_pm_list_assets',
      description:
        'List this project\'s ASSET_REQUESTs (id, kind, status, output path). Pure read.',
      inputSchema: objectSchema({ status: { type: 'string' } }),
      handler: async (args) => {
        rejectUnknownFields(args, ['status']);
        const status = optionalString(args, 'status');
        const all = assetKernel.listAssetRequests(dataRoot, project);
        return {
          assets: all
            .filter((r) => !status || r.status === status)
            .map((r) => ({
              assetId: r.assetId, assetKind: r.assetKind, status: r.status,
              outputPath: r.outputPath, taskId: r.taskId,
              result: r.result ?? null, attempts: r.attempts,
            })),
        };
      },
    },
  ];
}
