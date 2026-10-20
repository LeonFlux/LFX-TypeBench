import './styles.css';
import {
  type Answer,
  fetchHealth,
  loadCatalog,
  type RunSettings,
  runBatch,
  runDecision,
  runKnockout,
} from '@typed-decisions/core';
import { batchItems, defaultDrafts, goldSets } from './data/sample.ts';
import { $, $$, button, fill, selectMenuItem, variant } from './dom.ts';
import {
  addCalibration,
  deleteCalibration,
  deleteCalibrationsOf,
  newestCalibrationFirst,
  type StoredCalibration,
} from './services/calibrations.ts';
import {
  activeDraft,
  addDecision,
  newKey,
  removeDecision,
  restoreDefaults,
  selectDecision,
  workspaceOf,
} from './services/decisions.ts';
import { checkDraft, type Draft } from './services/draft.ts';
import { addRun, deleteAll, deleteRun, deleteRunsOf, newestFirst, runsOf, type StoredRun } from './services/history.ts';
import {
  type CalibrationStore,
  type HistoryStore,
  openCalibrationStore,
  openHistoryStore,
} from './services/history-store.ts';
import { buildModel, resolveModels } from './services/registry.ts';
import { healthCheck } from './services/server-status.ts';
import { localArea, readApiKey, readConfig, writeConfig } from './services/session.ts';
import { applyTheme } from './services/theme.ts';
import type { Ctx, RenderOptions, State, View, ViewModule } from './state.ts';
import * as calibrate from './views/calibrate-view.ts';
import * as decisionList from './views/decision-list.ts';
import * as define from './views/define-view.ts';
import * as inspect from './views/inspect-view.ts';
import { callTransport, canCall, canRun, enabledEntries, runModels } from './views/models.ts';
import { colorAt } from './views/palette.ts';
import * as results from './views/results-view.ts';
import * as runBar from './views/run-bar.ts';

const VIEWS: Record<View, ViewModule> = { define, results, inspect, calibrate };
const DEFAULT_SETTINGS: RunSettings = { samples: 5, seed: 42, reasoning: true, concurrency: 2 };
const DEFAULT_BATCH_SIZE = 20;
const DEFAULT_REQUESTS_PER_MINUTE = 20;
const PROGRESS_THROTTLE_MS = 100;
const HEALTH_FRESH_MS = 5000;

function initialState(): State {
  const saved = readConfig();
  const modelIds = saved?.models ?? [];
  const workspace = workspaceOf(saved?.drafts ?? defaultDrafts(), saved?.activeKey);
  return {
    drafts: workspace.drafts,
    draft: activeDraft(workspace) ?? (workspace.drafts[0] as Draft),
    history: [],
    droppedRuns: 0,
    apiKey: readApiKey(),
    server: null,
    modelIds,
    entries: [],
    enabled: new Set((saved?.enabled ?? []).filter((id) => modelIds.includes(id))),
    catalog: null,
    catalogStatus: 'loading',
    addOpen: false,
    addError: null,
    freeOnly: false,
    lastRun: 'idle',
    settings: saved?.settings ?? { ...DEFAULT_SETTINGS },
    requestsPerMinute: saved?.requestsPerMinute ?? DEFAULT_REQUESTS_PER_MINUTE,
    run: null,
    running: null,
    view: 'define',
    results: { questionId: null },
    inspect: { modelId: null, questionId: null, traceIndex: 0, koTarget: null },
    knockouts: {},
    koRunning: null,
    batch: {
      questionId: null,
      modelId: null,
      size: DEFAULT_BATCH_SIZE,
      running: null,
      calibrationId: null,
      filter: 'all',
      drill: null,
      itemIndex: null,
    },
    calibrations: [],
    droppedCalibrations: 0,
  };
}

const state = initialState();

function saveSession() {
  writeConfig({
    drafts: state.drafts,
    activeKey: state.draft.key,
    models: state.modelIds,
    enabled: [...state.enabled],
    settings: state.settings,
    requestsPerMinute: state.requestsPerMinute,
  });
}

function render(options: RenderOptions = {}) {
  const { draft } = state;
  fill(document, {
    'crumb-name': draft.name || draft.id || '—',
    'crumb-version': draft.version,
  });
  variant(document, 'mode', state.server ? 'server' : 'static');
  renderTopbar();
  decisionList.render(ctx);
  runBar.render(ctx);
  VIEWS[state.view].render(ctx, options);
}

const ACTIVITY_NAMES = { run: 'running', knockout: 'knockout', batch: 'batch' } as const;

function activeWork() {
  if (state.running) return { name: ACTIVITY_NAMES.run, activity: state.running };
  if (state.koRunning) return { name: ACTIVITY_NAMES.knockout, activity: state.koRunning };
  if (state.batch.running) return { name: ACTIVITY_NAMES.batch, activity: state.batch.running };
  return null;
}

function renderTopbar() {
  const bar = $('#h-run');
  const work = activeWork();
  variant(bar, 'run-state', work ? 'running' : state.lastRun);
  if (work) fill(bar, { 'h-kind': work.name, 'h-done': work.activity.done, 'h-total': work.activity.total });
  button('#h-run-btn', bar).hidden = !!work;
  button('#h-run-btn', bar).disabled = !canRun(ctx);
  button('#h-stop-btn', bar).hidden = !work;
}

function stop() {
  activeWork()?.activity.controller.abort();
}

function transport() {
  return callTransport(state);
}

function throttled(apply: (done: number, total: number) => void) {
  let last = 0;
  return (done: number, total: number) => {
    apply(done, total);
    const now = performance.now();
    if (done === total || now - last > PROGRESS_THROTTLE_MS) {
      last = now;
      render();
    }
  };
}

function showRun(historyId?: string) {
  const runs = runsOf(state.history, state.draft.key);
  state.run = runs.find((candidate) => candidate.historyId === historyId) ?? runs[0] ?? null;
  state.results.questionId = state.run?.decision.questions[0]?.id ?? null;
  state.inspect = { modelId: null, questionId: null, traceIndex: 0, koTarget: null };
}

let historyStore: HistoryStore | null = null;
let saving: Promise<void> = Promise.resolve();

async function persistHistory(store: HistoryStore) {
  const saved = await store.save(state.history);
  state.history = saved.history;
  state.droppedRuns = saved.dropped;
  render();
}

function keepHistory(history: StoredRun[]) {
  state.history = [...history].sort(newestFirst);
  const store = historyStore;
  if (store) saving = saving.then(() => persistHistory(store));
}

async function loadRunHistory() {
  const store = await openHistoryStore(localArea());
  historyStore = store;
  state.history = await store.load();
  showRun();
  render({ structure: true });
}

let calibrationStore: CalibrationStore | null = null;

async function persistCalibrations(store: CalibrationStore) {
  const saved = await store.save(state.calibrations);
  state.calibrations = saved.history;
  state.droppedCalibrations = saved.dropped;
  render();
}

function keepCalibrations(history: StoredCalibration[]) {
  state.calibrations = [...history].sort(newestCalibrationFirst);
  const store = calibrationStore;
  if (store) saving = saving.then(() => persistCalibrations(store));
}

function showCalibration(calibrationId: string | null) {
  const batch = state.batch;
  batch.calibrationId = calibrationId;
  batch.filter = 'all';
  batch.drill = null;
  batch.itemIndex = null;
}

async function loadCalibrations() {
  const store = await openCalibrationStore(localArea());
  calibrationStore = store;
  state.calibrations = await store.load();
  render({ structure: true });
}

function selectCalibration(calibrationId: string) {
  showCalibration(calibrationId);
}

function deleteSelectedCalibration() {
  const { calibrationId } = state.batch;
  if (!calibrationId) return;
  keepCalibrations(deleteCalibration(state.calibrations, calibrationId));
  showCalibration(null);
}

function deleteDecisionCalibrations() {
  keepCalibrations(deleteCalibrationsOf(state.calibrations, state.draft.key));
  showCalibration(null);
}

function selectRun(historyId: string) {
  showRun(historyId);
}

function deleteSelectedRun() {
  if (!state.run) return;
  keepHistory(deleteRun(state.history, state.run.historyId));
  showRun();
}

function deleteDecisionRuns() {
  keepHistory(deleteRunsOf(state.history, state.draft.key));
  showRun();
}

function clearHistory() {
  keepHistory(deleteAll());
  showRun();
}

function selectDraft(key: string) {
  const workspace = selectDecision({ drafts: state.drafts, activeKey: state.draft.key }, key);
  state.draft = activeDraft(workspace) ?? state.draft;
  showRun();
  showCalibration(null);
}

function removeDraft(key: string) {
  const workspace = removeDecision({ drafts: state.drafts, activeKey: state.draft.key }, key);
  state.drafts = workspace.drafts;
  keepHistory(deleteRunsOf(state.history, key));
  keepCalibrations(deleteCalibrationsOf(state.calibrations, key));
  selectDraft(workspace.activeKey);
}

function addDraft() {
  const workspace = addDecision({ drafts: state.drafts, activeKey: state.draft.key });
  state.drafts = workspace.drafts;
  selectDraft(workspace.activeKey);
}

function restoreDrafts() {
  state.drafts = restoreDefaults({ drafts: state.drafts, activeKey: state.draft.key }, defaultDrafts()).drafts;
}

async function run() {
  await detectServer();
  const draft = state.draft;
  const { decision } = checkDraft(draft);
  const entries = enabledEntries(ctx);
  if (!decision || !entries.length || !canCall(state) || state.running) return;

  const controller = new AbortController();
  state.running = { done: 0, total: 0, controller };
  render();
  const shared = transport();
  try {
    const record = await runDecision({
      decision,
      models: entries.map((entry) => buildModel(entry, shared)),
      settings: { ...state.settings },
      signal: controller.signal,
      onProgress: (done, total) => {
        if (!state.running) return;
        state.running.done = done;
        state.running.total = total;
        define.renderProgress(ctx);
        renderTopbar();
      },
    });
    const { name, id, version } = draft;
    const stored: StoredRun = {
      ...record,
      meta: { name, id, version },
      models: runModels(ctx),
      draftKey: draft.key,
      historyId: newKey(),
    };
    keepHistory(addRun(state.history, stored));
    state.lastRun = record.stopped ? 'stopped' : 'done';
    state.running = null;
    if (state.draft.key !== draft.key) return render();
    showRun(stored.historyId);
    location.hash = '#results';
  } catch (error) {
    console.error(error);
    state.running = null;
    render();
  }
}

async function knockout() {
  const runRecord = state.run;
  const entry = inspect.current(ctx);
  const modelEntry = state.entries.find((candidate) => candidate.id === entry?.model.id);
  if (!runRecord || !entry || !modelEntry || state.koRunning || !canCall(state)) return;

  const controller = new AbortController();
  state.koRunning = { done: 0, total: 1, controller };
  render();
  try {
    const result = await runKnockout({
      decision: runRecord.decision,
      model: buildModel(modelEntry, transport()),
      questionId: entry.question.id,
      baseline: entry.answer as Answer,
      settings: runRecord.settings,
      signal: controller.signal,
      onProgress: throttled((done, total) => {
        if (state.koRunning) state.koRunning = { done, total, controller };
      }),
    });
    state.knockouts[inspect.knockoutKey(runRecord.historyId, entry.model.id, entry.question.id)] = result;
  } finally {
    state.koRunning = null;
    render();
  }
}

async function batch() {
  const { decision } = checkDraft(state.draft);
  const settings = state.batch;
  const entries = enabledEntries(ctx);
  if (!decision || !settings.questionId || !entries.length || settings.running || !canCall(state)) return;

  const questionId = settings.questionId;
  const controller = new AbortController();
  settings.running = { done: 0, total: 1, controller };
  render();
  const shared = transport();
  const question = decision.questions.find((candidate) => candidate.id === questionId);
  const items = batchItems(calibrate.goldOf(ctx), questionId, settings.size);
  try {
    const outcome = await runBatch({
      decision,
      models: entries.map((entry) => buildModel(entry, shared)),
      questionId,
      items,
      settings: { ...state.settings },
      signal: controller.signal,
      onProgress: throttled((done, total) => {
        if (settings.running) settings.running = { done, total, controller };
      }),
    });
    if (question) {
      const calibration: StoredCalibration = {
        calibrationId: newKey(),
        draftKey: state.draft.key,
        createdAt: new Date().toISOString(),
        stopped: outcome.stopped,
        meta: { name: state.draft.name, id: state.draft.id, version: state.draft.version },
        question,
        settings: { samples: state.settings.samples, seed: state.settings.seed },
        models: runModels(ctx).map(({ id, label, source }) => ({ id, label, source })),
        items,
        byModel: outcome.byModel,
      };
      keepCalibrations(addCalibration(state.calibrations, calibration));
      showCalibration(calibration.calibrationId);
    }
  } finally {
    settings.running = null;
    render();
  }
}

const ctx: Ctx = {
  state,
  gold: goldSets(),
  update(mutate, options) {
    mutate();
    saveSession();
    render(options);
  },
  colorOf: (modelId) => colorAt(state.modelIds.indexOf(modelId)),
  actions: {
    run,
    knockout,
    batch,
    selectDraft,
    removeDraft,
    addDraft,
    restoreDrafts,
    selectRun,
    deleteSelectedRun,
    deleteDecisionRuns,
    clearHistory,
    selectCalibration,
    deleteSelectedCalibration,
    deleteDecisionCalibrations,
  },
};

function route() {
  const name = location.hash.slice(1);
  state.view = name in VIEWS ? (name as View) : 'define';
  for (const section of $$('[data-view]')) section.hidden = section.dataset.view !== state.view;
  for (const link of $$('[data-nav]')) {
    selectMenuItem(link, link.dataset.nav === state.view);
  }
  render({ structure: true });
  window.scrollTo({ top: 0 });
}

async function refreshCatalog() {
  try {
    const catalog = await loadCatalog();
    state.catalog = catalog;
    state.catalogStatus = 'ready';
    state.entries = resolveModels(state.modelIds, catalog);
  } catch (error) {
    state.catalogStatus = 'offline';
    console.warn('OpenRouter catalog unavailable.', error);
  }
  render({ structure: true });
}

const checkServer = healthCheck(
  () => fetchHealth(),
  () => performance.now(),
  HEALTH_FRESH_MS,
);

async function detectServer() {
  const health = await checkServer();
  const changed = JSON.stringify(health) !== JSON.stringify(state.server);
  state.server = health;
  if (changed) render({ structure: true });
}

window.addEventListener('focus', () => void detectServer());

showRun();
for (const module of [...Object.values(VIEWS), decisionList, runBar]) module.mount(ctx);
button('#h-run-btn').addEventListener('click', () => void run());
button('#h-stop-btn').addEventListener('click', stop);
window.addEventListener('hashchange', route);
route();
applyTheme(document);
void detectServer();
void loadRunHistory();
void loadCalibrations();
void refreshCatalog();
