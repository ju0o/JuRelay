/**
 * DEBUG-ONLY (P1.8B) — minimal MCP App render probe.
 *
 * PURPOSE
 * The production widget does not visually open in ChatGPT, and there are two very different
 * possible reasons: the host cannot mount ANY MCP App from this tunnel/App registration, or the
 * 85 KB widget breaks inside the host. Guessing between them by editing the real widget would burn
 * a day and destroy the working UI. This file is the smallest thing that can answer it: a complete,
 * valid MCP App with no CSS, no JS, no CDN, no fetch, no postMessage, no polling, no CSP
 * dependency and no Agent Relay logic at all. If ChatGPT mounts this, the host is capable and the
 * defect is inside the widget. If ChatGPT does not mount this, the widget is innocent.
 *
 * The URI is content-derived from the HTML below for the same reason the production URI is: the URI
 * is the cache key, so it must name exactly one content. There is deliberately no nonce, no query
 * parameter and no date substitution.
 *
 * REMOVAL
 * This module, its tool, its resource and its registration are temporary diagnostics. P1.8B removes
 * them once the boundary is proven. Nothing else may import this file, so deletion cannot leave a
 * dangling dependency in the production path.
 */

import { createHash } from 'node:crypto';

/**
 * Exactly the minimal component under test. Any addition (asset, script, style, fetch) would move
 * the boundary this probe is meant to establish, so it is byte-frozen.
 */
export const WIDGET_PROBE_HTML = `<!doctype html>
<html>
<body>
  <h1>Agent Relay Widget Probe</h1>
  <p>MOUNT_OK</p>
</body>
</html>
`;

export const WIDGET_PROBE_MIME_TYPE = 'text/html;profile=mcp-app';
export const WIDGET_PROBE_RESOURCE_NAME = 'Agent Relay Widget Probe';
export const WIDGET_PROBE_RESOURCE_DESCRIPTION =
  'DEBUG-ONLY mount probe: a static page with no assets, no script and no network access.';

export const WIDGET_PROBE_RESOURCE_URI =
  `ui://agent-relay/widget-probe-${createHash('sha256').update(WIDGET_PROBE_HTML, 'utf8').digest('hex').slice(0, 8)}`;

export const WIDGET_PROBE_PROOF = 'MOUNT_OK';

/**
 * No CSP block at all: the probe loads nothing from anywhere, so a host that requires a CSP
 * declaration still has nothing to enforce. If the host rejects it anyway, that is the finding.
 */
export function widgetProbeResourceMeta(): Record<string, unknown> {
  return { ui: { prefersBorder: true } };
}

export interface WidgetProbeToolLike {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => unknown;
  _meta: Record<string, unknown>;
}

/** The probe's render tool. Same descriptor shape as the production render tool. */
export function buildWidgetProbeTool(): WidgetProbeToolLike {
  return {
    name: 'relay_pm_open_widget_probe',
    description:
      'DEBUG-ONLY mount probe. Renders a static page with no assets, no script and no network ' +
      'access, to prove whether this ChatGPT App registration can mount an MCP App component at all.',
    inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
    _meta: {
      ui: { resourceUri: WIDGET_PROBE_RESOURCE_URI },
      'openai/outputTemplate': WIDGET_PROBE_RESOURCE_URI,
    },
    handler: async () => ({
      probe: WIDGET_PROBE_PROOF,
      uri: WIDGET_PROBE_RESOURCE_URI,
      note: 'DEBUG-ONLY: removed after P1.8B diagnosis.',
    }),
  };
}