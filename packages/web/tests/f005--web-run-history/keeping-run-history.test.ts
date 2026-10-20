import { describe, expect, it } from 'vitest';
import { sampleDraft } from '../../src/data/sample.ts';
import { checkDraft } from '../../src/services/draft.ts';
import {
  addRun,
  deleteAll,
  deleteRun,
  deleteRunsOf,
  HISTORY_STORAGE,
  loadHistory,
  runsOf,
  type StoredRun,
} from '../../src/services/history.ts';
import { HistoryStore, localStorageTable } from '../../src/services/history-store.ts';

const decision = checkDraft(sampleDraft).decision;

function memoryStorage(limitChars = Number.POSITIVE_INFINITY): Storage {
  const items = new Map<string, string>();
  const size = () => [...items].reduce((sum, [key, value]) => sum + key.length + value.length, 0);
  return {
    get length() {
      return items.size;
    },
    key: (index) => [...items.keys()][index] ?? null,
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => {
      const previous = items.get(key);
      items.set(key, value);
      if (size() > limitChars) {
        if (previous === undefined) items.delete(key);
        else items.set(key, previous);
        throw new DOMException('Quota exceeded', 'QuotaExceededError');
      }
    },
    removeItem: (key) => void items.delete(key),
    clear: () => items.clear(),
  };
}

function storedRun(draftKey: string, minute: number, padding = ''): StoredRun {
  if (!decision) throw new Error('sample decision is invalid');
  return {
    runId: 'r-same-config',
    historyId: `r-${draftKey}-${minute}`,
    draftKey,
    createdAt: new Date(Date.UTC(2026, 9, 18, 12, minute)).toISOString(),
    decision,
    settings: { samples: 5, seed: 42, reasoning: false, concurrency: 2 },
    lock: [],
    results: [
      {
        status: 'failed',
        model: { id: 'm', version: 'm-1' },
        transport: { id: 'open-router' },
        error: `rate limited${padding}`,
        answers: [],
        latencyMs: 10,
        costUsd: null,
      },
    ],
    stopped: false,
    meta: { name: 'Triage', id: 'ticket-triage', version: 1 },
    models: [{ id: 'm', label: 'Model', source: 'sampled', reasons: false, attribution: false }],
  };
}

describe('Golden', () => {
  it('lists the runs of one decision, newest first', () => {
    const history = [storedRun('a', 1), storedRun('b', 2), storedRun('a', 3)].reduce(addRun, [] as StoredRun[]);

    expect(runsOf(history, 'a').map((run) => run.historyId)).toEqual(['r-a-3', 'r-a-1']);
  });

  it('keeps runs across a save and a load in localStorage when IndexedDB is unavailable', async () => {
    const store = new HistoryStore(localStorageTable(memoryStorage()), null);
    const history = [storedRun('a', 1), storedRun('a', 2)].reduce(addRun, [] as StoredRun[]);

    await store.save(history);

    expect((await store.load()).map((run) => run.historyId)).toEqual(history.map((run) => run.historyId));
  });

  it('deletes exactly the selected run', () => {
    const history = [storedRun('a', 1), storedRun('a', 2)].reduce(addRun, [] as StoredRun[]);

    expect(deleteRun(history, 'r-a-1').map((run) => run.historyId)).toEqual(['r-a-2']);
  });

  it('deletes every run of one decision and keeps the others', () => {
    const history = [storedRun('a', 1), storedRun('b', 2)].reduce(addRun, [] as StoredRun[]);

    expect(deleteRunsOf(history, 'a').map((run) => run.draftKey)).toEqual(['b']);
  });

  it('deletes all history', () => {
    expect(deleteAll()).toEqual([]);
  });
});

describe('Edge', () => {
  it('keeps repeated runs of the same configuration as separate history entries', () => {
    const history = [storedRun('a', 1), storedRun('a', 2)].reduce(addRun, [] as StoredRun[]);

    expect(history.map((run) => [run.runId, run.historyId])).toEqual([
      ['r-same-config', 'r-a-2'],
      ['r-same-config', 'r-a-1'],
    ]);
  });

  it('drops the oldest runs until a new run fits in localStorage, and reports how many', async () => {
    const padding = 'x'.repeat(2000);
    const storage = memoryStorage(5000);
    const history = [storedRun('a', 1, padding), storedRun('b', 2, padding), storedRun('a', 3, padding)].reduce(
      addRun,
      [] as StoredRun[],
    );

    const saved = await new HistoryStore(localStorageTable(storage), null).save(history);

    expect({ kept: saved.history.map((run) => run.historyId)[0], dropped: saved.dropped > 0 }).toEqual({
      kept: 'r-a-3',
      dropped: true,
    });
  });

  it('loads an empty history when nothing is stored', () => {
    expect(loadHistory(memoryStorage())).toEqual([]);
  });
});

describe('Adversarial', () => {
  it('loads an empty history from stored text that is not JSON', () => {
    const storage = memoryStorage();
    storage.setItem(HISTORY_STORAGE, '{not json');

    expect(loadHistory(storage)).toEqual([]);
  });

  it('discards a stored run whose results do not parse against its decision, keeping the rest', () => {
    const storage = memoryStorage();
    const tampered = { ...storedRun('a', 1), results: [{ status: 'ok', answers: [{ questionId: 'injected' }] }] };
    storage.setItem(HISTORY_STORAGE, JSON.stringify([tampered, storedRun('a', 2)]));

    expect(loadHistory(storage).map((run) => run.historyId)).toEqual(['r-a-2']);
  });
});
