import {
  accuracyOf,
  agreement,
  type BatchAnswer,
  calibrationBins,
  callsPerQuestion,
  confusionMatrix,
  type Drill,
  expectedCalibrationError,
  modelScores,
  optionBreakdown,
  optionsOf,
  type Question,
  type Scored,
} from '@typed-decisions/core';
import { batchItems, type GoldItem, labeledQuestionIds } from '../data/sample.ts';
import { $, button, emptyOrFilled, fill, flag, options, select, setVars, tpl, variant } from '../dom.ts';
import { int, pct } from '../format.ts';
import { calibrationsOf, type StoredCalibration } from '../services/calibrations.ts';
import { costLabel, estimateEach } from '../services/costs.ts';
import { checkDraft } from '../services/draft.ts';
import type { Ctx } from '../state.ts';
import { mountItems, renderItems } from './calibrate-items.ts';
import { renderHeatTable } from './heat-table.ts';
import { canCall, enabledEntries, enabledModels } from './models.ts';
import { paint } from './palette.ts';
import { onModelTab, renderModelTabs } from './tabs.ts';

const view = () => $('[data-view="calibrate"]');
const WELL_CALIBRATED_POINTS = 3;

export function goldOf(ctx: Ctx): GoldItem[] {
  return ctx.gold[ctx.state.draft.id] ?? [];
}

export function labeledQuestions(ctx: Ctx): Question[] {
  const decision = checkDraft(ctx.state.draft).decision;
  const gold = goldOf(ctx);
  const labeled = labeledQuestionIds(gold);
  return (decision?.questions ?? []).filter(
    (question) =>
      labeled.includes(question.id) &&
      gold.every((item) => optionsOf(question).includes(item.labels[question.id] ?? '')),
  );
}

export function mount(ctx: Ctx) {
  const root = view();
  const batch = () => ctx.state.batch;
  select('#c-question', root).addEventListener('change', (event) =>
    ctx.update(() => {
      batch().questionId = (event.target as HTMLSelectElement).value;
    }),
  );
  select('#c-size', root).addEventListener('change', (event) =>
    ctx.update(() => {
      batch().size = Number((event.target as HTMLSelectElement).value);
    }),
  );
  button('#c-run', root).addEventListener('click', () => void ctx.actions.batch());
  onModelTab($('#c-models', root), (modelId) =>
    ctx.update(() => {
      batch().modelId = modelId;
      batch().drill = null;
    }),
  );
  select('#c-history', root).addEventListener('change', (event) =>
    ctx.update(() => ctx.actions.selectCalibration((event.target as HTMLSelectElement).value)),
  );
  button('#c-delete', root).addEventListener('click', () => ctx.update(() => ctx.actions.deleteSelectedCalibration()));
  button('#c-delete-all', root).addEventListener('click', () =>
    ctx.update(() => ctx.actions.deleteDecisionCalibrations()),
  );
  $('#c-bins', root).addEventListener('click', (event) => {
    const bin = (event.target as HTMLElement).closest<HTMLElement>('[data-bin]')?.dataset.bin;
    if (bin !== undefined) drillInto(ctx, { bin: Number(bin) });
  });
  $('#c-cm', root).addEventListener('click', (event) => {
    const cell = (event.target as HTMLElement).closest('td');
    const row = cell?.parentElement as HTMLTableRowElement | null;
    const labels = selectedOptions(ctx);
    const truth = labels[row?.sectionRowIndex ?? -1];
    const predicted = labels[(cell?.cellIndex ?? 0) - 1];
    if (truth !== undefined && predicted !== undefined) drillInto(ctx, { truth, predicted });
  });
  mountItems(ctx, root);
}

function drillInto(ctx: Ctx, drill: Drill) {
  ctx.update(() => {
    ctx.state.batch.drill = drill;
    ctx.state.batch.itemIndex = null;
  });
}

export function selectedCalibration(ctx: Ctx): StoredCalibration | null {
  const own = calibrationsOf(ctx.state.calibrations, ctx.state.draft.key);
  return own.find((entry) => entry.calibrationId === ctx.state.batch.calibrationId) ?? own[0] ?? null;
}

function selectedOptions(ctx: Ctx): string[] {
  const calibration = selectedCalibration(ctx);
  return calibration ? optionsOf(calibration.question) : [];
}

export function scoredOf(calibration: StoredCalibration, answers: readonly BatchAnswer[]): Scored[] {
  const labels = optionsOf(calibration.question);
  return answers.flatMap((answer) =>
    answer.status === 'ok' && answer.probabilities
      ? [{ truth: calibration.items[answer.index]?.truth ?? '', options: labels, probabilities: answer.probabilities }]
      : [],
  );
}

function renderCurve(root: HTMLElement, items: Scored[], label: string) {
  const bins = calibrationBins(items);
  $('#c-bins', root).replaceChildren(
    ...bins.map((bin, index) => {
      const element = tpl('tpl-bin');
      flag(element, 'empty', bin.n === 0);
      element.dataset.bin = String(index);
      (element as HTMLButtonElement).disabled = bin.n === 0;
      setVars(element, {
        '--h': `${((bin.accuracy ?? 0) * 100).toFixed(1)}%`,
        '--b': `${(bin.meanConfidence * 100).toFixed(1)}%`,
      });
      fill(element, { label: bin.n ? pct(bin.accuracy ?? 0) : '—' });
      element.title = bin.n ? `${bin.correct}/${bin.n} right at ${pct(bin.meanConfidence)} mean confidence` : '0';
      return element;
    }),
  );
  $('#c-bin-labels', root).replaceChildren(
    ...bins.map((bin) => {
      const element = tpl('tpl-bin-label');
      fill(element, { range: `${Math.round(bin.lo * 100)}–${Math.round(bin.hi * 100)}\nn=${bin.n}` });
      return element;
    }),
  );

  const busiest = bins.reduce((best, bin) => (bin.n > best.n ? bin : best), bins[0] ?? bins[0]);
  if (!busiest) return;
  const gap = Math.round(((busiest.accuracy ?? 0) - busiest.meanConfidence) * 100);
  const kind = Math.abs(gap) <= WELL_CALIBRATED_POINTS ? 'ok' : gap < 0 ? 'over' : 'under';
  variant($('[data-callout]', root), 'cal', kind);
  fill(root, {
    'c-model': label,
    'c-model-2': label,
    'c-model-3': label,
    'c-ece': expectedCalibrationError(bins).toFixed(3),
    'c-bin-range': `${Math.round(busiest.lo * 100)}–${Math.round(busiest.hi * 100)}%`,
    'c-bin-conf': pct(busiest.meanConfidence),
    'c-bin-acc': pct(busiest.accuracy ?? 0),
    'c-gap-over': Math.abs(gap),
    'c-gap-under': Math.abs(gap),
  });
}

const BASE_SHADE = 0.04;
const SHADE_RANGE = 0.86;
const DARK_SHARE = 0.5;

function renderConfusion(root: HTMLElement, items: Scored[], labels: string[]) {
  const matrix = confusionMatrix(labels, items);
  fill(root, { 'c-acc': pct(accuracyOf(matrix), 1) });
  renderHeatTable($('#c-cm', root), labels, (row, column) => {
    const counts = matrix[row] ?? [];
    const count = counts[column] ?? 0;
    const share = count / (counts.reduce((sum, value) => sum + value, 0) || 1);
    return {
      text: String(count),
      shade: BASE_SHADE + share * SHADE_RANGE,
      dark: share > DARK_SHARE,
      diagonal: row === column,
    };
  });
}

const unavailable = '—';
const score = (value: number | null) => (value === null ? unavailable : value.toFixed(3));
const share = (value: number | null) => (value === null ? unavailable : pct(value, 1));
const points = (value: number | null) =>
  value === null ? unavailable : `${value > 0 ? '+' : value < 0 ? '−' : '±'}${Math.abs(Math.round(value * 100))} pts`;

function renderSummary(root: HTMLElement, ctx: Ctx, calibration: StoredCalibration) {
  const labels = optionsOf(calibration.question);
  const truths = calibration.items.map((item) => item.truth);
  $('#c-summary tbody', root).replaceChildren(
    ...calibration.models.map((model) => {
      const scores = modelScores(labels, truths, calibration.byModel[model.id] ?? []);
      const row = tpl('tpl-summary-row');
      paint(row, ctx.colorOf(model.id));
      variant(row, 'source', model.source);
      fill(row, {
        label: model.label,
        n: calibration.settings.samples,
        acc: share(scores.accuracy),
        conf: share(scores.meanConfidence),
        gap: points(scores.gap),
        ece: score(scores.ece),
        brier: score(scores.brier),
        count: scores.answered,
        failed: scores.failed,
      });
      return row;
    }),
  );
}

function renderOptions(root: HTMLElement, calibration: StoredCalibration, answers: readonly BatchAnswer[]) {
  const labels = optionsOf(calibration.question);
  const truths = calibration.items.map((item) => item.truth);
  $('#c-options tbody', root).replaceChildren(
    ...optionBreakdown(labels, truths, answers).map((stats) => {
      const row = tpl('tpl-option-row');
      fill(row, {
        option: stats.option,
        support: stats.support,
        picked: stats.picked,
        precision: share(stats.precision),
        recall: share(stats.recall),
      });
      return row;
    }),
  );
}

const SAME_PICK_SHADE = 0.86;

function renderAgreement(root: HTMLElement, calibration: StoredCalibration) {
  const section = $('#c-agreement', root);
  section.hidden = calibration.models.length < 2;
  if (section.hidden) return;
  const labels = optionsOf(calibration.question);
  const truths = calibration.items.map((item) => item.truth);
  const byModel = Object.fromEntries(
    calibration.models.map((model) => [model.id, calibration.byModel[model.id] ?? []]),
  );
  const result = agreement(labels, truths, byModel);
  fill(section, {
    'c-unanimous': share(result.unanimous),
    'c-all-right': result.allRight,
    'c-all-wrong': result.allWrong,
    'c-split': result.split,
  });
  renderHeatTable(
    $('#c-pairs', section),
    calibration.models.map((model) => model.label),
    (row, column) => {
      const value = result.pairs[row]?.[column] ?? null;
      return {
        text: share(value),
        shade: (value ?? 0) * SAME_PICK_SHADE,
        self: row === column,
        dark: (value ?? 0) > 0.5,
      };
    },
  );
}

export function render(ctx: Ctx) {
  const root = view();
  const batch = ctx.state.batch;
  const questions = labeledQuestions(ctx);
  if (!questions.some((question) => question.id === batch.questionId)) batch.questionId = questions[0]?.id ?? null;
  const questionSelect = select('#c-question', root);
  options(
    questionSelect,
    questions.map((question) => question.id),
    batch.questionId,
  );
  questionSelect.disabled = !questions.length;
  select('#c-size', root).value = String(batch.size);

  const models = enabledModels(ctx);
  const calls =
    batch.size * models.reduce((sum, model) => sum + callsPerQuestion(model, ctx.state.settings.samples), 0);
  const question = questions.find((candidate) => candidate.id === batch.questionId);
  const inputs = question ? batchItems(goldOf(ctx), question.id, batch.size).map((item) => item.input) : [];
  const cost = question ? costLabel(estimateEach(inputs, question, enabledEntries(ctx), ctx.state.settings)) : '—';
  fill(root, { 'c-n': batch.size, 'c-calls': int(calls), 'c-cost': cost });
  button('#c-run', root).disabled = !batch.questionId || !models.length || !!batch.running || !canCall(ctx.state);
  const progress = $('#c-progress', root) as HTMLProgressElement;
  progress.hidden = !batch.running;
  if (batch.running) progress.value = batch.running.total ? batch.running.done / batch.running.total : 0;

  const calibrations = calibrationsOf(ctx.state.calibrations, ctx.state.draft.key);
  const calibration = selectedCalibration(ctx);
  emptyOrFilled(root, !!calibration);
  if (!calibration) return;
  batch.calibrationId = calibration.calibrationId;

  const picker = select('#c-history', root);
  options(
    picker,
    calibrations.map((entry) => ({ value: entry.calibrationId, label: calibrationLabel(entry) })),
    calibration.calibrationId,
  );
  fill(root, {
    'c-asked': calibration.question.id,
    'c-version': calibration.meta.version,
    'c-items': calibration.items.length,
    'c-dropped': ctx.state.droppedCalibrations,
  });
  $('[data-c-stopped]', root).hidden = !calibration.stopped;
  $('[data-c-pruned]', root).hidden = ctx.state.droppedCalibrations === 0;

  if (!calibration.models.some((model) => model.id === batch.modelId))
    batch.modelId = calibration.models[0]?.id ?? null;
  const active = calibration.models.find((model) => model.id === batch.modelId);
  if (!active) return;
  const answers = calibration.byModel[active.id] ?? [];
  const scored = scoredOf(calibration, answers);

  renderModelTabs($('#c-models', root), ctx, calibration.models, active.id);
  paint(root, ctx.colorOf(active.id));
  fill(root, { 'c-model-4': active.label, 'c-model-5': active.label });
  renderCurve(root, scored, active.label);
  renderConfusion(root, scored, optionsOf(calibration.question));
  renderSummary(root, ctx, calibration);
  renderOptions(root, calibration, answers);
  renderAgreement(root, calibration);
  renderItems(ctx, root, calibration, active.id);
}

function calibrationLabel(entry: StoredCalibration): string {
  const time = new Date(entry.createdAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  const models = `${entry.models.length} model${entry.models.length === 1 ? '' : 's'}`;
  return `${time} · ${entry.question.id} · ${entry.items.length} items · ${models}${entry.stopped ? ' · stopped' : ''}`;
}
