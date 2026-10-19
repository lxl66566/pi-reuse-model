import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { ModelStore, workspaceKey } from './store.ts';

let tempDir: string | undefined;

function tempFile(name: string): string {
  tempDir ??= mkdtempSync(join(tmpdir(), 'pi-reuse-model-'));
  return join(tempDir, name);
}

afterEach(() => {
  if (tempDir) {
    rmSync(tempDir, { force: true, recursive: true });
    tempDir = undefined;
  }
});

describe('workspaceKey', () => {
  it('canonicalizes windows paths across spellings', () => {
    expect(workspaceKey('C:\\A\\B')).toBe('c:/a/b');
    expect(workspaceKey('c:/a/b')).toBe('c:/a/b');
    expect(workspaceKey('\\\\Server\\Share')).toBe('//server/share');
  });

  it('preserves the case of posix paths', () => {
    expect(workspaceKey('/Home/User')).toBe('/Home/User');
  });
});

describe('ModelStore', () => {
  it('round-trips a model record', () => {
    const store = new ModelStore(tempFile('store.json'));
    store.saveModel('/ws', 'prov', 'model-1');

    expect(store.load('/ws')).toMatchObject({
      modelId: 'model-1',
      provider: 'prov',
    });
  });

  it('finds the same workspace across path spellings', () => {
    const store = new ModelStore(tempFile('store.json'));
    store.saveModel('C:\\A\\B', 'prov', 'model-1');

    expect(store.load('c:/a/b')).toMatchObject({ modelId: 'model-1' });
  });

  it('keeps other workspaces when saving', () => {
    const store = new ModelStore(tempFile('store.json'));
    store.saveModel('/ws-a', 'prov', 'model-a');
    store.saveModel('/ws-b', 'prov', 'model-b');

    expect(store.load('/ws-a')).toMatchObject({ modelId: 'model-a' });
    expect(store.load('/ws-b')).toMatchObject({ modelId: 'model-b' });
  });

  it('returns undefined for a missing file', () => {
    const store = new ModelStore(tempFile('missing.json'));

    expect(store.load('/ws')).toBeUndefined();
  });

  it('returns undefined for a corrupt file and recovers on save', () => {
    const path = tempFile('corrupt.json');
    writeFileSync(path, '{not json', 'utf8');
    const store = new ModelStore(path);

    expect(store.load('/ws')).toBeUndefined();
    store.saveModel('/ws', 'prov', 'model-1');

    expect(store.load('/ws')).toMatchObject({ modelId: 'model-1' });
  });

  it('drops malformed entries while keeping valid ones', () => {
    const path = tempFile('mixed.json');
    writeFileSync(
      path,
      JSON.stringify({
        unknownTopLevel: true,
        version: 1,
        workspaces: {
          '/bad-provider': {
            modelId: 'model-2',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
          '/good': {
            modelId: 'model-1',
            provider: 'prov',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
          '/not-an-object': 'junk',
        },
      }),
      'utf8',
    );
    const store = new ModelStore(path);

    expect(store.load('/good')).toMatchObject({ modelId: 'model-1' });
    expect(store.load('/bad-provider')).toBeUndefined();
    expect(store.load('/not-an-object')).toBeUndefined();

    store.saveModel('/other', 'prov', 'model-3');
    const saved: unknown = JSON.parse(readFileSync(path, 'utf8'));
    expect((saved as { version: number }).version).toBe(1);
    expect(
      Object.keys(
        (saved as { workspaces: Record<string, unknown> }).workspaces,
      ).toSorted(),
    ).toEqual(['/good', '/other']);
  });

  it('keeps the stored thinking level when saving a model', () => {
    const store = new ModelStore(tempFile('merge-model.json'));
    store.saveThinkingLevel('/ws', 'high');
    store.saveModel('/ws', 'prov', 'model-1');

    expect(store.load('/ws')).toMatchObject({
      modelId: 'model-1',
      provider: 'prov',
      thinkingLevel: 'high',
    });
  });

  it('keeps the stored model when saving a thinking level', () => {
    const store = new ModelStore(tempFile('merge-level.json'));
    store.saveModel('/ws', 'prov', 'model-1');
    store.saveThinkingLevel('/ws', 'high');

    expect(store.load('/ws')).toMatchObject({
      modelId: 'model-1',
      provider: 'prov',
      thinkingLevel: 'high',
    });
  });

  it('stores a thinking level without a model', () => {
    const store = new ModelStore(tempFile('level-only.json'));
    store.saveThinkingLevel('/ws', 'low');
    const record = store.load('/ws');

    expect(record?.thinkingLevel).toBe('low');
    expect(record?.modelId).toBeUndefined();
    expect(record?.provider).toBeUndefined();
  });

  it('loads a legacy record without a thinking level', () => {
    const path = tempFile('legacy.json');
    writeFileSync(
      path,
      JSON.stringify({
        version: 1,
        workspaces: {
          '/ws': {
            modelId: 'model-1',
            provider: 'prov',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        },
      }),
      'utf8',
    );
    const store = new ModelStore(path);

    expect(store.load('/ws')).toStrictEqual({
      modelId: 'model-1',
      provider: 'prov',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
  });

  it('drops an unknown thinking level but keeps the model', () => {
    const path = tempFile('bad-level.json');
    writeFileSync(
      path,
      JSON.stringify({
        version: 1,
        workspaces: {
          '/level-only': {
            thinkingLevel: 'ultra',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
          '/with-model': {
            modelId: 'model-1',
            provider: 'prov',
            thinkingLevel: 'ultra',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        },
      }),
      'utf8',
    );
    const store = new ModelStore(path);

    expect(store.load('/level-only')).toBeUndefined();
    expect(store.load('/with-model')).toStrictEqual({
      modelId: 'model-1',
      provider: 'prov',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
  });
});
