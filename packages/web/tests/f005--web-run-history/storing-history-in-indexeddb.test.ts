import { describe, expect, it } from 'vitest';
import { sampleDraft } from '../../src/data/sample.ts';
import { checkDraft } from '../../src/services/draft.ts';
import { HISTORY_STORAGE, type StoredRun } from '../../src/services/history.ts';
import { HistoryStore, type RunTable } from '../../src/services/history-store.ts';

const decision = checkDraft(sampleDraft).decision;

function storedRun(minute: number, padding = ''): StoredRun {
  if (!decision) throw new Error('sample decision is invalid');
  return {
    runId: 'r-config',
    historyId: `h-${minute}`,
    draftKey: 'a',
    createdAt: new Date(Date.UTC(2026, 9, 18, 12, minute)).toISOString(),
    decision,
    settings: { samples: 5, seed: 42, reasoning: false, concurrency: 2 },
    lock: [],
    results: [],
    stopped: false,
    meta: { name: `Triage${padding}`, id: 'ticket-triage', version: 1 },
    models: [],
  };
}

function memoryTable(limitChars = Number.POSITIVE_INFINITY) {
  let rows: unknown[] = [];
  const table: RunTable = {
    backend: 'indexeddb',
    readAll: async () => structuredClone(rows),
    writeAll: async (runs) => {
      if (JSON.stringify(runs).length > limitChars) throw new DOMException('Quota exceeded', 'QuotaExceededError');
      rows = structuredClone(runs);
    },
  };
  const seed = (raw: unknown[]) => {
    rows = raw;
  };
  return { table, rows: () => rows, seed };
}

function legacyStorage(value: string | null): Storage {
  const items = new Map<string, string>(value === null ? [] : [[HISTORY_STORAGE, value]]);
  return {
    get length() {
      return items.size;
    },
    key: (index) => [...items.keys()][index] ?? null,
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, item) => void items.set(key, item),
    removeItem: (key) => void items.delete(key),
    clear: () => items.clear(),
  };
}

describe('Golden', () => {
  it('saves and loads runs newest first', async () => {
    const { table } = memoryTable();
    const store = new HistoryStore(table, null);

    await store.save([storedRun(1), storedRun(2)]);

    expect((await store.load()).map((run) => run.historyId)).toEqual(['h-2', 'h-1']);
  });

  it('moves history from localStorage into the table once', async () => {
    const legacy = legacyStorage(JSON.stringify([storedRun(1)]));
    const { table } = memoryTable();

    const loaded = await new HistoryStore(table, legacy).load();

    expect({ loaded: loaded.map((run) => run.historyId), legacy: legacy.getItem(HISTORY_STORAGE) }).toEqual({
      loaded: ['h-1'],
      legacy: null,
    });
  });
});

describe('Edge', () => {
  it('drops the oldest runs until the history fits, keeping the newest', async () => {
    const padding = 'x'.repeat(1500);
    const { table } = memoryTable(4000);

    const saved = await new HistoryStore(table, null).save([
      storedRun(1, padding),
      storedRun(2, padding),
      storedRun(3, padding),
    ]);

    expect({ newest: saved.history[0]?.historyId, dropped: saved.dropped > 0 }).toEqual({
      newest: 'h-3',
      dropped: true,
    });
  });

  it('merges legacy runs with runs already in the table', async () => {
    const memory = memoryTable();
    memory.seed([storedRun(2)]);

    const loaded = await new HistoryStore(memory.table, legacyStorage(JSON.stringify([storedRun(1)]))).load();

    expect(loaded.map((run) => run.historyId)).toEqual(['h-2', 'h-1']);
  });
});

describe('Adversarial', () => {
  it('discards invalid rows from the table', async () => {
    const memory = memoryTable();
    memory.seed([{ historyId: 'h-evil', results: '<script>' }, storedRun(1)]);

    expect((await new HistoryStore(memory.table, null).load()).map((run) => run.historyId)).toEqual(['h-1']);
  });
});
