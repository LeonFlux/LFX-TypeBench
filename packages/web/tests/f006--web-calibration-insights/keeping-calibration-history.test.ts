import { describe, expect, it } from 'vitest';
import { sampleDraft } from '../../src/data/sample.ts';
import {
  addCalibration,
  CALIBRATION_STORAGE,
  calibrationsOf,
  deleteCalibration,
  deleteCalibrationsOf,
  type StoredCalibration,
  validCalibrations,
} from '../../src/services/calibrations.ts';
import { checkDraft } from '../../src/services/draft.ts';
import { CalibrationStore, localStorageTable, type RunTable } from '../../src/services/history-store.ts';

const question = checkDraft(sampleDraft).decision?.questions.find((candidate) => candidate.id === 'escalate');

function calibration(minute: number, draftKey = 'a', padding = ''): StoredCalibration {
  if (!question) throw new Error('sample question is missing');
  return {
    calibrationId: `c-${minute}`,
    draftKey,
    createdAt: new Date(Date.UTC(2026, 9, 18, 12, minute)).toISOString(),
    stopped: false,
    meta: { name: `Triage${padding}`, id: 'ticket-triage', version: 3 },
    question,
    settings: { samples: 5, seed: 42 },
    models: [{ id: 'm', label: 'Model', source: 'logprobs' }],
    items: [
      { input: { kind: 'text', text: 'Production is down.' }, truth: 'yes' },
      { input: { kind: 'text', text: 'No rush.' }, truth: 'no' },
    ],
    byModel: {
      m: [
        { index: 0, status: 'ok', probabilities: [0.9, 0.1] },
        { index: 1, status: 'failed', probabilities: null },
      ],
    },
  };
}

function memoryTable(limitChars = Number.POSITIVE_INFINITY) {
  let rows: unknown[] = [];
  const table: RunTable = {
    backend: 'indexeddb',
    readAll: async () => structuredClone(rows),
    writeAll: async (records) => {
      if (JSON.stringify(records).length > limitChars) throw new DOMException('Quota exceeded', 'QuotaExceededError');
      rows = structuredClone(records);
    },
  };
  return { table, rows: () => rows, seed: (raw: unknown[]) => (rows = raw) };
}

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}

describe('Golden', () => {
  it('lists a decision’s calibration runs newest first', () => {
    const history = [calibration(1), calibration(3), calibration(2, 'b')].reduce(addCalibration, []);

    expect(calibrationsOf(history, 'a').map((entry) => entry.calibrationId)).toEqual(['c-3', 'c-1']);
  });

  it('keeps every calibration run, fully inspectable, across a reload', async () => {
    const memory = memoryTable();
    await new CalibrationStore(memory.table).save([calibration(1), calibration(2)]);

    const loaded = await new CalibrationStore(memory.table).load();

    expect(loaded).toEqual([calibration(2), calibration(1)]);
  });

  it('keeps a stopped calibration run with the items answered so far', async () => {
    const memory = memoryTable();
    const stopped = { ...calibration(1), stopped: true };
    await new CalibrationStore(memory.table).save([stopped]);

    expect(await new CalibrationStore(memory.table).load()).toEqual([stopped]);
  });

  it('deletes exactly the selected calibration run', () => {
    const history = [calibration(1), calibration(2)];

    expect(deleteCalibration(history, 'c-1').map((entry) => entry.calibrationId)).toEqual(['c-2']);
  });

  it('deletes all calibration runs of one decision and keeps the others', () => {
    const history = [calibration(1), calibration(2, 'b')];

    expect(deleteCalibrationsOf(history, 'a').map((entry) => entry.calibrationId)).toEqual(['c-2']);
  });
});

describe('Edge', () => {
  it('drops the oldest calibration runs until a new one fits, and says how many', async () => {
    const memory = memoryTable(JSON.stringify([calibration(1, 'a', 'x'.repeat(400))]).length * 2.5);
    const store = new CalibrationStore(memory.table);
    const history = [1, 2, 3, 4].map((minute) => calibration(minute, 'a', 'x'.repeat(400)));

    const saved = await store.save(history);

    expect(saved.dropped).toBe(2);
    expect(saved.history.map((entry) => entry.calibrationId)).toEqual(['c-4', 'c-3']);
  });

  it('keeps calibration runs in localStorage where IndexedDB is unavailable', async () => {
    const storage = memoryStorage();
    await new CalibrationStore(localStorageTable(storage, CALIBRATION_STORAGE)).save([calibration(1)]);

    expect(await new CalibrationStore(localStorageTable(storage, CALIBRATION_STORAGE)).load()).toEqual([
      calibration(1),
    ]);
  });

  it('keeps the question a calibration run was made with after the decision changes', () => {
    const [kept] = validCalibrations([calibration(1)]);

    expect(kept?.question.prompt).toBe(question?.prompt);
    expect(kept?.meta.version).toBe(3);
  });
});

describe('Adversarial', () => {
  it('discards a calibration run with probabilities outside 0..1', () => {
    const tampered = calibration(1);
    tampered.byModel.m = [{ index: 0, status: 'ok', probabilities: [1.5, -0.5] }];

    expect(validCalibrations([tampered, calibration(2)]).map((entry) => entry.calibrationId)).toEqual(['c-2']);
  });

  it('discards a calibration run whose probabilities do not match the options', () => {
    const tampered = calibration(1);
    tampered.byModel.m = [{ index: 0, status: 'ok', probabilities: [1] }];

    expect(validCalibrations([tampered])).toEqual([]);
  });

  it('discards a calibration run with a truth outside the question’s options', () => {
    const tampered = calibration(1);
    tampered.items = [{ input: { kind: 'text', text: 'x' }, truth: 'maybe' }];

    expect(validCalibrations([tampered])).toEqual([]);
  });

  it('discards an answer that points at an item the run does not have', () => {
    const tampered = calibration(1);
    tampered.byModel.m = [{ index: 7, status: 'ok', probabilities: [0.5, 0.5] }];

    expect(validCalibrations([tampered])).toEqual([]);
  });

  it('loads the rest when storage holds garbage', async () => {
    const memory = memoryTable();
    memory.seed(['not a run', { calibrationId: 42 }, calibration(1)]);

    expect(await new CalibrationStore(memory.table).load()).toEqual([calibration(1)]);
  });

  it('starts empty when the localStorage value is not valid JSON', async () => {
    const storage = memoryStorage();
    storage.setItem(CALIBRATION_STORAGE, '{not json');

    expect(await new CalibrationStore(localStorageTable(storage, CALIBRATION_STORAGE)).load()).toEqual([]);
  });
});
