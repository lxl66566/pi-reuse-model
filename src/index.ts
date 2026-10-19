import { join } from 'node:path';

/**
 * pi extension entry point. Makes every fresh session — startup and /new —
 * start on the model and thinking level last used in this workspace instead
 * of the configured defaults. Load with `pi --extension ./src/index.ts`, from
 * the user/project extensions directory, or via the `pi.extensions` field in
 * package.json.
 */
import {
  getAgentDir,
  type ExtensionAPI,
  type ExtensionContext,
} from '@earendil-works/pi-coding-agent';

import {
  ModelStore,
  type ThinkingLevel,
  type WorkspaceModelRecord,
} from './store.ts';

const STORE_FILE = 'pi-reuse-model.json';

/** CLI flags that pin a model for the invocation; an explicit choice wins over the stored one. */
const MODEL_CLI_FLAGS = new Set(['--model', '--models', '--provider']);

/** The part of a model identity this extension records and restores. */
interface ModelRef {
  id: string;
  provider: string;
}

export function hasExplicitModelArg(argv: readonly string[]): boolean {
  return argv.some(arg => MODEL_CLI_FLAGS.has(arg));
}

export function recordSelectedModel(
  ctx: ExtensionContext,
  model: ModelRef | undefined,
  store: ModelStore,
): void {
  if (!model) return;
  try {
    store.saveModel(ctx.cwd, model.provider, model.id);
  } catch {
    // Recording must never break the session.
  }
}

export function recordThinkingLevel(
  ctx: ExtensionContext,
  level: ThinkingLevel,
  store: ModelStore,
): void {
  try {
    store.saveThinkingLevel(ctx.cwd, level);
  } catch {
    // Recording must never break the session.
  }
}

/**
 * Switch the session to the model and thinking level last used in this
 * workspace. Skips when the command line pins a model, when nothing is
 * recorded, when the session already runs that state, or when the model is
 * no longer available.
 */
export async function restoreLastSelection(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  store: ModelStore,
  argv: readonly string[] = process.argv,
): Promise<void> {
  if (hasExplicitModelArg(argv)) return;

  const record = store.load(ctx.cwd);
  if (!record) return;

  await restoreModel(pi, ctx, record);
  restoreThinkingLevel(pi, ctx, record);
}

export default function reuseModelExtension(
  pi: ExtensionAPI,
  store: ModelStore = defaultStore(),
): void {
  pi.on('session_start', (event, ctx) => {
    // resume and fork restore the model from the session transcript itself.
    if (event.reason !== 'startup' && event.reason !== 'new') return;
    return restoreLastSelection(pi, ctx, store);
  });

  pi.on('model_select', (event, ctx) => {
    recordSelectedModel(ctx, event.model, store);
  });

  pi.on('thinking_level_select', (event, ctx) => {
    recordThinkingLevel(ctx, event.level, store);
  });
}

function defaultStore(): ModelStore {
  return new ModelStore(join(getAgentDir(), STORE_FILE));
}

async function restoreModel(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  record: WorkspaceModelRecord,
): Promise<void> {
  const { modelId, provider } = record;
  if (!provider || !modelId) return;

  const current = ctx.model;
  if (current && current.provider === provider && current.id === modelId)
    return;

  const target = ctx.modelRegistry.find(provider, modelId);
  if (!target) return;

  try {
    // False means no auth for the provider; keep the resolved default then.
    await pi.setModel(target);
  } catch {
    // Keep the resolved default when the restore fails.
  }
}

function restoreThinkingLevel(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  record: WorkspaceModelRecord,
): void {
  const { thinkingLevel } = record;
  if (!thinkingLevel || ctx.thinkingLevel === thinkingLevel) return;
  try {
    // Runs after the model restore: pi resets the level on every model switch.
    pi.setThinkingLevel(thinkingLevel);
  } catch {
    // Keep the derived default when the restore fails.
  }
}
