import {
  CALIBRATION_STORAGE,
  newestCalibrationFirst,
  type StoredCalibration,
  validCalibrations,
} from './calibrations.ts';
import { HISTORY_STORAGE, isQuotaError, loadHistory, newestFirst, type StoredRun, validRuns } from './history.ts';

export type Backend = 'indexeddb' | 'localstorage';

export type RunTable = {
  backend: Backend;
  readAll(): Promise<unknown[]>;
  writeAll(records: unknown[]): Promise<void>;
};

export type Saved<T> = { history: T[]; dropped: number };

const DATABASE = 'decision-bench';
const DATABASE_VERSION = 2;
const RUNS = 'runs';
const CALIBRATIONS = 'calibrations';
const KEY_PATHS: Record<string, string> = { [RUNS]: 'historyId', [CALIBRATIONS]: 'calibrationId' };

class RecordStore<T> {
  protected readonly table: RunTable;
  private readonly validate: (raw: unknown[]) => T[];
  private readonly order: (a: T, b: T) => number;

  constructor(table: RunTable, validate: (raw: unknown[]) => T[], order: (a: T, b: T) => number) {
    this.table = table;
    this.validate = validate;
    this.order = order;
  }

  async load(): Promise<T[]> {
    return this.validate(await this.table.readAll().catch(() => []));
  }

  async save(records: T[]): Promise<Saved<T>> {
    let kept = [...records].sort(this.order);
    let dropped = 0;
    for (;;) {
      try {
        await this.table.writeAll(kept);
        return { history: kept, dropped };
      } catch (error) {
        if (!isQuotaError(error) || kept.length <= 1) return { history: kept, dropped };
        kept = kept.slice(0, -1);
        dropped++;
      }
    }
  }
}

export class CalibrationStore extends RecordStore<StoredCalibration> {
  constructor(table: RunTable) {
    super(table, validCalibrations, newestCalibrationFirst);
  }
}

export class HistoryStore extends RecordStore<StoredRun> {
  private readonly legacy: Storage | null;

  constructor(table: RunTable, legacy: Storage | null) {
    super(table, validRuns, newestFirst);
    this.legacy = legacy;
  }

  override async load(): Promise<StoredRun[]> {
    const stored = await super.load();
    const legacyRuns = this.table.backend === 'localstorage' ? [] : loadHistory(this.legacy);
    if (!legacyRuns.length) return stored;

    const known = new Set(stored.map((run) => run.historyId));
    const merged = [...stored, ...legacyRuns.filter((run) => !known.has(run.historyId))].sort(newestFirst);
    const saved = await this.save(merged);
    this.legacy?.removeItem(HISTORY_STORAGE);
    return saved.history;
  }
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

function openDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  const request = factory.open(DATABASE, DATABASE_VERSION);
  request.onupgradeneeded = () => {
    for (const [store, keyPath] of Object.entries(KEY_PATHS)) {
      if (!request.result.objectStoreNames.contains(store)) request.result.createObjectStore(store, { keyPath });
    }
  };
  return requestResult(request);
}

export function indexedDbTable(database: IDBDatabase, store = RUNS): RunTable {
  return {
    backend: 'indexeddb',
    async readAll() {
      const transaction = database.transaction(store, 'readonly');
      return requestResult(transaction.objectStore(store).getAll());
    },
    async writeAll(records) {
      const transaction = database.transaction(store, 'readwrite');
      const objectStore = transaction.objectStore(store);
      objectStore.clear();
      for (const record of records) objectStore.put(record);
      await transactionDone(transaction);
    },
  };
}

export function localStorageTable(storage: Storage | null, key = HISTORY_STORAGE): RunTable {
  return {
    backend: 'localstorage',
    readAll: async () => {
      const raw: unknown = JSON.parse(storage?.getItem(key) ?? '[]');
      return Array.isArray(raw) ? raw : [];
    },
    writeAll: async (records) => storage?.setItem(key, JSON.stringify(records)),
  };
}

function browserIndexedDb(): IDBFactory | null {
  try {
    return globalThis.indexedDB ?? null;
  } catch {
    return null;
  }
}

async function preferredTable(storage: Storage | null, store: string, key: string): Promise<RunTable> {
  const factory = browserIndexedDb();
  if (!factory) return localStorageTable(storage, key);
  try {
    return indexedDbTable(await openDatabase(factory), store);
  } catch {
    return localStorageTable(storage, key);
  }
}

export async function openHistoryStore(legacy: Storage | null): Promise<HistoryStore> {
  return new HistoryStore(await preferredTable(legacy, RUNS, HISTORY_STORAGE), legacy);
}

export async function openCalibrationStore(storage: Storage | null): Promise<CalibrationStore> {
  return new CalibrationStore(await preferredTable(storage, CALIBRATIONS, CALIBRATION_STORAGE));
}
