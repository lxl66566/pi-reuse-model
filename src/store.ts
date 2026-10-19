import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';

/** Thinking levels pi recognizes, in increasing intensity. */
const THINKING_LEVELS = [
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const;

export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

/** The model and thinking level a workspace last had selected. */
export interface WorkspaceModelRecord {
  modelId?: string | undefined;
  provider?: string | undefined;
  thinkingLevel?: ThinkingLevel | undefined;
  /** ISO 8601 timestamp of the last change, for debugging only. */
  updatedAt: string;
}

interface StoreFile {
  version: 1;
  workspaces: Record<string, WorkspaceModelRecord>;
}

/** Persists the last used model and thinking level per workspace as JSON. */
export class ModelStore {
  constructor(private readonly filePath: string) {}

  /** Returns the record for `cwd`, or undefined when absent or unreadable. */
  load(cwd: string): undefined | WorkspaceModelRecord {
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.filePath, 'utf8'));
      return toWorkspaces(parsed)[workspaceKey(cwd)];
    } catch {
      return undefined;
    }
  }

  /** Records the model for `cwd`, keeping the stored thinking level. */
  saveModel(cwd: string, provider: string, modelId: string): void {
    this.patch(cwd, { modelId, provider });
  }

  /** Records the thinking level for `cwd`, keeping the stored model. */
  saveThinkingLevel(cwd: string, level: ThinkingLevel): void {
    this.patch(cwd, { thinkingLevel: level });
  }

  /** Merges `patch` into the record for `cwd`, merging with other workspaces. */
  private patch(cwd: string, change: Partial<WorkspaceModelRecord>): void {
    let workspaces: Record<string, WorkspaceModelRecord>;
    try {
      workspaces = toWorkspaces(
        JSON.parse(readFileSync(this.filePath, 'utf8')),
      );
    } catch {
      workspaces = {};
    }
    workspaces[workspaceKey(cwd)] = {
      ...workspaces[workspaceKey(cwd)],
      ...change,
      updatedAt: new Date().toISOString(),
    };

    // Write to a temp file and rename, so a crash can never leave a
    // half-written store.
    mkdirSync(dirname(this.filePath), { recursive: true });
    const file: StoreFile = { version: 1, workspaces };
    const tempFile = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    writeFileSync(tempFile, `${JSON.stringify(file, null, 2)}\n`, 'utf8');
    try {
      renameSync(tempFile, this.filePath);
    } catch (error) {
      try {
        rmSync(tempFile, { force: true });
      } catch {
        // Best-effort cleanup; the rename error matters more.
      }
      throw error;
    }
  }
}

/**
 * Canonical key for a workspace directory. Windows paths are lowercased and
 * use forward slashes so the same workspace reached via different path
 * spellings shares one record.
 */
export function workspaceKey(
  cwd: string,
  platform: NodeJS.Platform = process.platform,
): string {
  const normalized = cwd.replaceAll('\\', '/');
  return platform === 'win32' ? normalized.toLowerCase() : normalized;
}

/**
 * Collapses a parsed entry into a record: provider and modelId are kept as a
 * pair, an unknown thinking level is dropped, and entries with neither a
 * model nor a level are rejected.
 */
function toRecord(value: unknown): undefined | WorkspaceModelRecord {
  if (typeof value !== 'object' || value === null) return undefined;
  const { modelId, provider, thinkingLevel, updatedAt } =
    value as Partial<WorkspaceModelRecord>;

  const hasModel = typeof provider === 'string' && typeof modelId === 'string';
  const level = toThinkingLevel(thinkingLevel);
  if (typeof updatedAt !== 'string' || (!hasModel && !level)) return undefined;

  return {
    ...(hasModel ? { modelId, provider } : {}),
    ...(level ? { thinkingLevel: level } : {}),
    updatedAt,
  };
}

/** Returns `value` when it is a known thinking level, else undefined. */
function toThinkingLevel(value: unknown): ThinkingLevel | undefined {
  return typeof value === 'string' &&
    (THINKING_LEVELS as readonly string[]).includes(value)
    ? (value as ThinkingLevel)
    : undefined;
}

/** Collapses a parsed file into records, dropping anything malformed. */
function toWorkspaces(value: unknown): Record<string, WorkspaceModelRecord> {
  const workspaces = (value as null | { workspaces?: unknown })?.workspaces;
  if (typeof workspaces !== 'object' || workspaces === null) return {};

  const result: Record<string, WorkspaceModelRecord> = {};
  for (const [key, record] of Object.entries(
    workspaces as Record<string, unknown>,
  )) {
    const parsed = toRecord(record);
    if (parsed) result[key] = parsed;
  }
  return result;
}
