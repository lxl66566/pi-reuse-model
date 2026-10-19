import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  type ExtensionAPI,
  type ExtensionContext,
} from '@earendil-works/pi-coding-agent';
import { afterEach, describe, expect, it } from 'vitest';

import {
  default as reuseModelExtension,
  hasExplicitModelArg,
  recordSelectedModel,
  recordThinkingLevel,
  restoreLastSelection,
} from './index.ts';
import { ModelStore } from './store.ts';

let tempDir: string | undefined;

function tempStore(name: string): ModelStore {
  tempDir ??= mkdtempSync(join(tmpdir(), 'pi-reuse-model-'));
  return new ModelStore(join(tempDir, name));
}

afterEach(() => {
  if (tempDir) {
    rmSync(tempDir, { force: true, recursive: true });
    tempDir = undefined;
  }
});

interface StubModel {
  id: string;
  provider: string;
}

interface StubOptions {
  /** Model references the registry knows, as "provider/id". */
  available?: string[];
  cwd: string;
  model?: StubModel | undefined;
  thinkingLevel?: string | undefined;
}

interface StubPi {
  handlers: Map<string, (event: unknown, ctx: ExtensionContext) => unknown>;
  levels: string[];
  models: StubModel[];
  pi: ExtensionAPI;
  trace: string[];
}

function stubCtx(options: StubOptions): ExtensionContext {
  return {
    cwd: options.cwd,
    model: options.model,
    modelRegistry: {
      find: (provider: string, modelId: string) =>
        options.available?.includes(`${provider}/${modelId}`)
          ? { id: modelId, provider }
          : undefined,
    },
    thinkingLevel: options.thinkingLevel,
  } as unknown as ExtensionContext;
}

function stubPi(options: { failSetModel?: boolean } = {}): StubPi {
  const handlers = new Map<
    string,
    (event: unknown, ctx: ExtensionContext) => unknown
  >();
  const models: StubModel[] = [];
  const levels: string[] = [];
  const trace: string[] = [];
  const pi = {
    on: (
      event: string,
      handler: (event: unknown, ctx: ExtensionContext) => unknown,
    ) => {
      handlers.set(event, handler);
    },
    setModel: async (model: StubModel) => {
      if (options.failSetModel) throw new Error('no auth');
      models.push(model);
      trace.push(`model:${model.provider}/${model.id}`);
      return true;
    },
    setThinkingLevel: (level: string) => {
      levels.push(level);
      trace.push(`level:${level}`);
    },
  } as unknown as ExtensionAPI;
  return { handlers, levels, models, pi, trace };
}

describe('hasExplicitModelArg', () => {
  it('detects model-pinning flags', () => {
    expect(hasExplicitModelArg(['pi', '--model', 'x/y'])).toBe(true);
    expect(hasExplicitModelArg(['pi', '--models', 'x/y'])).toBe(true);
    expect(hasExplicitModelArg(['pi', '--provider', 'x'])).toBe(true);
    expect(hasExplicitModelArg(['pi', '--no-extensions'])).toBe(false);
  });

  it('ignores flag values that merely contain the flag name', () => {
    expect(hasExplicitModelArg(['pi', '--prompt', '--model'])).toBe(true);
    expect(hasExplicitModelArg(['pi', 'say --model'])).toBe(false);
  });
});

describe('restoreLastSelection', () => {
  it('restores the recorded model, then the thinking level', async () => {
    const store = tempStore('restore.json');
    store.saveModel('/ws', 'prov', 'model-1');
    store.saveThinkingLevel('/ws', 'high');
    const { pi, trace } = stubPi();

    await restoreLastSelection(
      pi,
      stubCtx({
        available: ['prov/model-1'],
        cwd: '/ws',
        model: { id: 'default', provider: 'prov' },
        thinkingLevel: 'low',
      }),
      store,
      ['pi'],
    );

    expect(trace).toEqual(['model:prov/model-1', 'level:high']);
  });

  it('skips when the command line pins a model', async () => {
    const store = tempStore('explicit.json');
    store.saveModel('/ws', 'prov', 'model-1');
    store.saveThinkingLevel('/ws', 'high');
    const { pi, trace } = stubPi();

    await restoreLastSelection(pi, stubCtx({ cwd: '/ws' }), store, [
      'pi',
      '--model',
      'other/m',
    ]);

    expect(trace).toEqual([]);
  });

  it('skips when nothing is recorded', async () => {
    const { pi, trace } = stubPi();

    await restoreLastSelection(
      pi,
      stubCtx({ cwd: '/ws' }),
      tempStore('empty.json'),
      ['pi'],
    );

    expect(trace).toEqual([]);
  });

  it('skips when the session already runs the recorded state', async () => {
    const store = tempStore('same.json');
    store.saveModel('/ws', 'prov', 'model-1');
    store.saveThinkingLevel('/ws', 'high');
    const { pi, trace } = stubPi();

    await restoreLastSelection(
      pi,
      stubCtx({
        cwd: '/ws',
        model: { id: 'model-1', provider: 'prov' },
        thinkingLevel: 'high',
      }),
      store,
      ['pi'],
    );

    expect(trace).toEqual([]);
  });

  it('still restores the thinking level when the model already matches', async () => {
    const store = tempStore('same-model.json');
    store.saveModel('/ws', 'prov', 'model-1');
    store.saveThinkingLevel('/ws', 'high');
    const { pi, trace } = stubPi();

    await restoreLastSelection(
      pi,
      stubCtx({
        cwd: '/ws',
        model: { id: 'model-1', provider: 'prov' },
        thinkingLevel: 'low',
      }),
      store,
      ['pi'],
    );

    expect(trace).toEqual(['level:high']);
  });

  it('restores the thinking level when the recorded model is gone', async () => {
    const store = tempStore('gone.json');
    store.saveModel('/ws', 'prov', 'model-1');
    store.saveThinkingLevel('/ws', 'high');
    const { pi, trace } = stubPi();

    await restoreLastSelection(
      pi,
      stubCtx({ available: ['prov/other'], cwd: '/ws', thinkingLevel: 'low' }),
      store,
      ['pi'],
    );

    expect(trace).toEqual(['level:high']);
  });

  it('restores a thinking level recorded without a model', async () => {
    const store = tempStore('level-only.json');
    store.saveThinkingLevel('/ws', 'high');
    const { pi, trace } = stubPi();

    await restoreLastSelection(
      pi,
      stubCtx({ cwd: '/ws', thinkingLevel: 'low' }),
      store,
      ['pi'],
    );

    expect(trace).toEqual(['level:high']);
  });

  it('skips the thinking level when the session already runs it', async () => {
    const store = tempStore('same-level.json');
    store.saveModel('/ws', 'prov', 'model-1');
    store.saveThinkingLevel('/ws', 'high');
    const { levels, models, pi } = stubPi();

    await restoreLastSelection(
      pi,
      stubCtx({
        available: ['prov/model-1'],
        cwd: '/ws',
        model: { id: 'default', provider: 'prov' },
        thinkingLevel: 'high',
      }),
      store,
      ['pi'],
    );

    expect(models).toEqual([{ id: 'model-1', provider: 'prov' }]);
    expect(levels).toEqual([]);
  });

  it('survives setModel rejecting and still restores the level', async () => {
    const store = tempStore('reject.json');
    store.saveModel('/ws', 'prov', 'model-1');
    store.saveThinkingLevel('/ws', 'high');
    const { pi, trace } = stubPi({ failSetModel: true });

    await expect(
      restoreLastSelection(
        pi,
        stubCtx({ available: ['prov/model-1'], cwd: '/ws' }),
        store,
        ['pi'],
      ),
    ).resolves.toBeUndefined();
    expect(trace).toEqual(['level:high']);
  });
});

describe('recordSelectedModel', () => {
  it('stores the selected model for the workspace', () => {
    const store = tempStore('record.json');

    recordSelectedModel(
      stubCtx({ cwd: '/ws' }),
      { id: 'model-1', provider: 'prov' },
      store,
    );

    expect(store.load('/ws')).toMatchObject({
      modelId: 'model-1',
      provider: 'prov',
    });
  });

  it('ignores a missing model', () => {
    const store = tempStore('record-none.json');

    recordSelectedModel(stubCtx({ cwd: '/ws' }), undefined, store);

    expect(store.load('/ws')).toBeUndefined();
  });
});

describe('recordThinkingLevel', () => {
  it('stores the selected level for the workspace', () => {
    const store = tempStore('record-level.json');

    recordThinkingLevel(stubCtx({ cwd: '/ws' }), 'high', store);

    expect(store.load('/ws')).toMatchObject({ thinkingLevel: 'high' });
  });

  it('keeps the stored model', () => {
    const store = tempStore('record-level-model.json');
    recordSelectedModel(
      stubCtx({ cwd: '/ws' }),
      { id: 'model-1', provider: 'prov' },
      store,
    );

    recordThinkingLevel(stubCtx({ cwd: '/ws' }), 'low', store);

    expect(store.load('/ws')).toMatchObject({
      modelId: 'model-1',
      provider: 'prov',
      thinkingLevel: 'low',
    });
  });
});

describe('reuseModelExtension', () => {
  it('restores on startup and new sessions, not on resume or fork', async () => {
    const store = tempStore('wiring.json');
    store.saveModel('/ws', 'prov', 'model-1');
    store.saveThinkingLevel('/ws', 'high');
    const { handlers, pi, trace } = stubPi();
    reuseModelExtension(pi, store);
    const ctx = stubCtx({
      available: ['prov/model-1'],
      cwd: '/ws',
      model: { id: 'default', provider: 'prov' },
      thinkingLevel: 'low',
    });

    await handlers.get('session_start')!({ reason: 'startup' }, ctx);
    await handlers.get('session_start')!({ reason: 'new' }, ctx);
    await handlers.get('session_start')!({ reason: 'resume' }, ctx);
    await handlers.get('session_start')!({ reason: 'fork' }, ctx);

    expect(trace).toEqual([
      'model:prov/model-1',
      'level:high',
      'model:prov/model-1',
      'level:high',
    ]);
  });

  it('records every model and thinking level selection', () => {
    const store = tempStore('wiring-record.json');
    const { handlers, pi } = stubPi();
    reuseModelExtension(pi, store);

    handlers.get('model_select')!(
      { model: { id: 'model-1', provider: 'prov' } },
      stubCtx({ cwd: '/ws' }),
    );
    handlers.get('thinking_level_select')!(
      { level: 'high', previousLevel: 'low' },
      stubCtx({ cwd: '/ws' }),
    );

    expect(store.load('/ws')).toMatchObject({
      modelId: 'model-1',
      provider: 'prov',
      thinkingLevel: 'high',
    });
  });
});
