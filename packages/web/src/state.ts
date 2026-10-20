import type { CatalogEntry, Drill, Health, ItemFilter, Knockout, RunRecord, RunSettings } from '@typed-decisions/core';
import type { GoldItem } from './data/sample.ts';
import type { StoredCalibration } from './services/calibrations.ts';
import type { Draft } from './services/draft.ts';
import type { StoredRun } from './services/history.ts';
import type { ModelEntry, ProbabilitySource } from './services/registry.ts';
import type { ModelColor } from './views/palette.ts';

export type View = 'define' | 'results' | 'inspect' | 'calibrate';

export type Progress = { done: number; total: number };

export type Activity = Progress & { controller: AbortController };

export type RunModel = {
  id: string;
  label: string;
  source: ProbabilitySource;
  reasons: boolean;
  attribution: boolean;
};

export type BenchRun = RunRecord & { meta: { name: string; id: string; version: number }; models: RunModel[] };

export type State = {
  drafts: Draft[];
  draft: Draft;
  history: StoredRun[];
  droppedRuns: number;
  apiKey: string;
  server: Health | null;
  modelIds: string[];
  entries: ModelEntry[];
  enabled: Set<string>;
  catalog: CatalogEntry[] | null;
  catalogStatus: 'loading' | 'ready' | 'offline';
  addOpen: boolean;
  addError: 'unknown' | 'duplicate' | 'offline' | null;
  freeOnly: boolean;
  lastRun: 'idle' | 'done' | 'stopped';
  settings: RunSettings;
  requestsPerMinute: number;
  run: StoredRun | null;
  running: Activity | null;
  view: View;
  results: { questionId: string | null };
  inspect: { modelId: string | null; questionId: string | null; traceIndex: number; koTarget: string | null };
  knockouts: Record<string, Knockout>;
  koRunning: Activity | null;
  batch: {
    questionId: string | null;
    modelId: string | null;
    size: number;
    running: Activity | null;
    calibrationId: string | null;
    filter: ItemFilter;
    drill: Drill;
    itemIndex: number | null;
  };
  calibrations: StoredCalibration[];
  droppedCalibrations: number;
};

export type RenderOptions = { structure?: boolean };

export type Ctx = {
  state: State;
  gold: Record<string, GoldItem[]>;
  update: (mutate: () => void, options?: RenderOptions) => void;
  colorOf: (modelId: string) => ModelColor;
  actions: {
    run: () => Promise<void>;
    knockout: () => Promise<void>;
    batch: () => Promise<void>;
    selectDraft: (key: string) => void;
    removeDraft: (key: string) => void;
    addDraft: () => void;
    restoreDrafts: () => void;
    selectRun: (runId: string) => void;
    deleteSelectedRun: () => void;
    deleteDecisionRuns: () => void;
    clearHistory: () => void;
    selectCalibration: (calibrationId: string) => void;
    deleteSelectedCalibration: () => void;
    deleteDecisionCalibrations: () => void;
  };
};

export type ViewModule = { mount: (ctx: Ctx) => void; render: (ctx: Ctx, options?: RenderOptions) => void };
