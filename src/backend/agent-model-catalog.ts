/**
 * P2-OWNER-R01 — Agent model catalog (trusted CLI / local cache only).
 * Never invent model IDs. Never print secrets.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import type { WorkerRegistryRecord } from './worker-registry.js';

export type ModelChoiceSource =
  | 'cli'
  | 'local_cache'
  | 'wrapper_allowlist'
  | 'cli_help_alias';

export interface ModelChoice {
  modelId: string;
  displayName?: string;
  provider?: string;
  source: ModelChoiceSource;
}

export interface AgentModelCatalog {
  workerId: string;
  runtime: string;
  supportsExplicitModel: boolean;
  constraintNote?: string;
  models: ModelChoice[];
  defaultModelId?: string | null;
  authOk?: boolean;
}

const MODEL_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,80}$/;

/** Claude /model aliases documented by Claude Code when logged in. */
export const CLAUDE_MODEL_ALIASES: ReadonlyArray<ModelChoice> = [
  { modelId: 'sonnet', displayName: 'Sonnet (alias)', source: 'cli_help_alias' },
  { modelId: 'opus', displayName: 'Opus (alias)', source: 'cli_help_alias' },
  { modelId: 'haiku', displayName: 'Haiku (alias)', source: 'cli_help_alias' },
  { modelId: 'fable', displayName: 'Fable (alias)', source: 'cli_help_alias' },
  { modelId: 'best', displayName: 'Best (alias)', source: 'cli_help_alias' },
  { modelId: 'default', displayName: 'Default (alias)', source: 'cli_help_alias' },
];

function runtimeOf(worker: WorkerRegistryRecord): string {
  return (worker.observationAdapterId || '').trim().toLowerCase() || 'unknown';
}

function uniqueModels(models: ModelChoice[]): ModelChoice[] {
  const seen = new Set<string>();
  const out: ModelChoice[] = [];
  for (const m of models) {
    const id = m.modelId.trim();
    if (!id || !MODEL_ID_RE.test(id) || seen.has(id)) continue;
    seen.add(id);
    out.push({ ...m, modelId: id });
  }
  return out;
}

function readClaudeCatalogFromCache(configDir: string): ModelChoice[] {
  const dir = path.join(configDir, 'cache', 'model-catalog');
  if (!fs.existsSync(dir)) return [];
  let newest: { mtime: number; file: string } | null = null;
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.json')) continue;
    const file = path.join(dir, name);
    try {
      const st = fs.statSync(file);
      if (!newest || st.mtimeMs > newest.mtime) newest = { mtime: st.mtimeMs, file };
    } catch { /* skip */ }
  }
  if (!newest) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(newest.file, 'utf8')) as {
      catalog?: { config?: { models?: Array<{ id?: unknown; name?: unknown }> } };
    };
    const list = raw?.catalog?.config?.models;
    if (!Array.isArray(list)) return [];
    const out: ModelChoice[] = [];
    for (const m of list) {
      if (!m || typeof m.id !== 'string') continue;
      out.push({
        modelId: m.id,
        ...(typeof m.name === 'string' ? { displayName: m.name } : {}),
        source: 'local_cache',
      });
    }
    return out;
  } catch {
    return [];
  }
}

function claudeAuthOk(configDir: string): boolean {
  try {
    const r = spawnSync('claude', ['auth', 'status'], {
      encoding: 'utf8',
      timeout: 15_000,
      env: { ...process.env, CLAUDE_CONFIG_DIR: configDir },
      shell: false,
    });
    const text = `${r.stdout || ''}${r.stderr || ''}`;
    return /"loggedIn"\s*:\s*true/.test(text) || /\bloggedIn\b.*\btrue\b/i.test(text);
  } catch {
    return fs.existsSync(path.join(configDir, '.credentials.json'));
  }
}

function catalogClaude(worker: WorkerRegistryRecord): AgentModelCatalog {
  const configDir =
    worker.driverOptions?.claude?.configDir ||
    path.join(os.homedir(), '.claude-pro');
  const authOk = claudeAuthOk(configDir);
  const fromCache = readClaudeCatalogFromCache(configDir);
  const models = uniqueModels([...fromCache, ...CLAUDE_MODEL_ALIASES]);
  return {
    workerId: worker.workerId,
    runtime: 'claude-code',
    supportsExplicitModel: true,
    authOk,
    models: authOk ? models : [],
    defaultModelId: authOk ? (fromCache[0]?.modelId ?? 'sonnet') : null,
    ...(authOk
      ? {
          constraintNote:
            fromCache.length > 0
              ? 'Claude Pro login OK. Models from local model-catalog cache + /model aliases.'
              : 'Claude Pro login OK. Catalog cache empty — aliases only until cache refreshes.',
        }
      : {
          constraintNote:
            'Claude profile not logged in. Log in to this configDir before selecting models.',
        }),
  };
}

function readCodexModels(): { models: ModelChoice[]; defaultModelId: string | null } {
  const home = path.join(os.homedir(), '.codex');
  const models: ModelChoice[] = [];
  let defaultModelId: string | null = null;
  const cachePath = path.join(home, 'models_cache.json');
  try {
    const raw = JSON.parse(fs.readFileSync(cachePath, 'utf8')) as {
      models?: Array<string | { id?: unknown; slug?: unknown; model?: unknown }>;
    };
    if (Array.isArray(raw.models)) {
      for (const m of raw.models) {
        const id =
          typeof m === 'string'
            ? m
            : typeof m?.id === 'string'
              ? m.id
              : typeof m?.slug === 'string'
                ? m.slug
                : typeof m?.model === 'string'
                  ? m.model
                  : null;
        if (id) models.push({ modelId: id, source: 'local_cache' });
      }
    }
  } catch { /* ignore */ }
  const cfgPath = path.join(home, 'config.toml');
  try {
    const text = fs.readFileSync(cfgPath, 'utf8');
    const m = /^model\s*=\s*"([^"]+)"/m.exec(text);
    if (m?.[1]) defaultModelId = m[1];
  } catch { /* ignore */ }
  return { models: uniqueModels(models), defaultModelId };
}

function catalogCodex(worker: WorkerRegistryRecord): AgentModelCatalog {
  const { models, defaultModelId } = readCodexModels();
  return {
    workerId: worker.workerId,
    runtime: 'codex',
    supportsExplicitModel: true,
    authOk: true,
    models,
    defaultModelId,
    constraintNote:
      models.length > 0
        ? 'Models from ~/.codex/models_cache.json (local_cache). Unknown ids fail closed.'
        : 'Codex model cache empty — cannot invent models.',
  };
}

function runCliLines(command: string, args: string[], timeoutMs = 30_000): string[] {
  try {
    const r = spawnSync(command, args, {
      encoding: 'utf8',
      timeout: timeoutMs,
      shell: false,
      env: process.env,
    });
    const text = `${r.stdout || ''}\n${r.stderr || ''}`;
    return text.split(/\r?\n/);
  } catch {
    return [];
  }
}

function catalogOpenCode(worker: WorkerRegistryRecord): AgentModelCatalog {
  const lines = runCliLines('opencode', ['models']);
  const models: ModelChoice[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.includes(' ')) continue;
    if (!t.includes('/')) continue;
    const provider = t.slice(0, t.indexOf('/'));
    models.push({ modelId: t, provider, source: 'cli' });
  }
  const uniq = uniqueModels(models);
  // builder-opencode free-tier policy: expose all discovered; dispatcher/wrapper still fail-closed on non-free for free-only workers
  return {
    workerId: worker.workerId,
    runtime: 'opencode',
    supportsExplicitModel: true,
    authOk: uniq.length > 0,
    models: uniq,
    defaultModelId: uniq.find((m) => m.modelId === 'opencode/big-pickle')?.modelId ?? uniq[0]?.modelId ?? null,
    constraintNote:
      'From `opencode models`. Free-tier-only workers still reject non-free models at dispatch.',
  };
}

function catalogGrok(worker: WorkerRegistryRecord): AgentModelCatalog {
  const lines = runCliLines('grok', ['models']);
  const models: ModelChoice[] = [];
  let defaultModelId: string | null = null;
  let authOk = false;
  for (const line of lines) {
    if (/logged in/i.test(line)) authOk = true;
    const def = /Default model:\s*(\S+)/i.exec(line);
    if (def?.[1]) defaultModelId = def[1];
    const bullet = /^\s*[-*]\s+(\S+)/.exec(line);
    if (bullet?.[1]) {
      models.push({ modelId: bullet[1].replace(/[(),]/g, ''), source: 'cli' });
    }
  }
  const uniq = uniqueModels(models);
  return {
    workerId: worker.workerId,
    runtime: 'grok',
    supportsExplicitModel: true,
    authOk: authOk || uniq.length > 0,
    models: uniq,
    defaultModelId: defaultModelId ?? uniq[0]?.modelId ?? null,
    constraintNote: 'From `grok models`.',
  };
}

function catalogCommandCode(worker: WorkerRegistryRecord): AgentModelCatalog {
  const lines = runCliLines('commandcode', ['--list-models']);
  const models: ModelChoice[] = [];
  for (const line of lines) {
    const m = /^([A-Za-z0-9][A-Za-z0-9._:/-]*)\s{2,}/.exec(line.trim());
    if (m?.[1] && !/^(Available|Open|Anthropic|OpenAI|Google|Provider)/i.test(m[1])) {
      const id = m[1];
      const provider = id.includes('/') ? id.slice(0, id.indexOf('/')) : undefined;
      models.push({
        modelId: id,
        ...(provider ? { provider } : {}),
        source: 'cli',
      });
    }
  }
  const uniq = uniqueModels(models);
  return {
    workerId: worker.workerId,
    runtime: 'commandcode',
    supportsExplicitModel: true,
    authOk: uniq.length > 0,
    models: uniq,
    defaultModelId: uniq[0]?.modelId ?? null,
    constraintNote: 'From `commandcode --list-models`.',
  };
}

function catalogCline(worker: WorkerRegistryRecord): AgentModelCatalog {
  // No reliable non-interactive model list; expose constraint only.
  return {
    workerId: worker.workerId,
    runtime: 'cline',
    supportsExplicitModel: false,
    authOk: false,
    models: [],
    defaultModelId: null,
    constraintNote:
      'Cline model list requires interactive auth; worker blocked for R01 until auth is refreshed.',
  };
}

function isTestFixtureWorker(worker: WorkerRegistryRecord): boolean {
  const caps = (worker.capabilities || []).map((c) => String(c).toLowerCase());
  if (caps.includes('test-fixture') || caps.includes('fixture')) return true;
  if ((worker.observationAdapterId || '').trim() === 'test-fixture') return true;
  const prefix = Array.isArray(worker.launchArgsPrefix) ? worker.launchArgsPrefix : [];
  return prefix.some((a) => {
    const s = String(a).replace(/\\/g, '/');
    return s.includes('exit-zero') || s.includes('stay-alive') || s.includes('fixtures/workers/');
  });
}

function catalogTestFixture(worker: WorkerRegistryRecord): AgentModelCatalog {
  return {
    workerId: worker.workerId,
    runtime: runtimeOf(worker) || 'test-fixture',
    supportsExplicitModel: true,
    authOk: true,
    models: [{ modelId: 'test-model', source: 'wrapper_allowlist' }],
    defaultModelId: 'test-model',
    constraintNote: 'Test-fixture worker allowlist (test-model only).',
  };
}

export function listModelsForWorker(
  _dataRoot: string,
  worker: WorkerRegistryRecord,
): AgentModelCatalog {
  // Offline / fixture workers: stable catalog so R01 selection tests need no live CLIs.
  if (isTestFixtureWorker(worker)) {
    return catalogTestFixture(worker);
  }
  const runtime = runtimeOf(worker);
  if (runtime === 'claude-code' || worker.workerId.includes('claude')) {
    return catalogClaude(worker);
  }
  if (runtime === 'codex' || worker.workerId.includes('codex')) {
    return catalogCodex(worker);
  }
  if (runtime === 'opencode' || worker.workerId.includes('opencode')) {
    return catalogOpenCode(worker);
  }
  if (runtime === 'grok' || worker.workerId.includes('grok')) {
    return catalogGrok(worker);
  }
  if (runtime === 'commandcode' || worker.workerId.includes('commandcode')) {
    return catalogCommandCode(worker);
  }
  if (runtime === 'cline' || worker.workerId.includes('cline')) {
    return catalogCline(worker);
  }
  return {
    workerId: worker.workerId,
    runtime,
    supportsExplicitModel: false,
    models: [],
    constraintNote: `No model catalog provider for runtime '${runtime}'.`,
  };
}

export function isModelAllowedForWorker(
  dataRoot: string,
  worker: WorkerRegistryRecord,
  modelId: string,
): boolean {
  const id = modelId.trim();
  if (!MODEL_ID_RE.test(id)) return false;
  const catalog = listModelsForWorker(dataRoot, worker);
  if (!catalog.supportsExplicitModel) return false;
  if (catalog.models.some((m) => m.modelId === id)) return true;
  // OpenCode free-tier workers: still require membership in discovered list (no invent).
  return false;
}

export function isFreeTierOpenCodeModel(modelId: string): boolean {
  const bare = modelId.includes('/') ? modelId.slice(modelId.indexOf('/') + 1) : modelId;
  return /-free$/i.test(bare) || bare === 'big-pickle' || modelId.endsWith('/big-pickle');
}
