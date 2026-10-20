import { callsPerQuestion, segmentInput, withoutSegment } from '@typed-decisions/core';
import { $, $$, button, emptyOrFilled, fill, flag, options, select, setVars, tpl, variant } from '../dom.ts';
import { int, pct, signed } from '../format.ts';
import { costLabel, estimateEach } from '../services/costs.ts';
import type { BenchRun, Ctx, RunModel } from '../state.ts';
import { renderBars } from './bars.ts';
import { canCall, enabledModels } from './models.ts';
import { availability, type Level, paint, setLevel } from './palette.ts';
import { type Measured, measured, questionOf, succeeded } from './run-lookup.ts';
import { type Depth, onModelTab, renderModelTabs } from './tabs.ts';

const view = () => $('[data-view="inspect"]');
const INVALID_ANSWER = 'unusable reply';

const measuredLevel = (model: RunModel): Level => (model.source === 'logprobs' ? 'direct' : 'estimated');

const LEVELS: Record<string, (model: RunModel) => Level> = {
  probabilities: measuredLevel,
  reasoning: (model) => availability(model.reasons),
  attribution: (model) => availability(model.attribution),
  knockout: measuredLevel,
};

export const knockoutKey = (runId: string, modelId: string, questionId: string) => `${runId}|${modelId}|${questionId}`;

export function mount(ctx: Ctx) {
  const root = view();
  const inspect = () => ctx.state.inspect;
  select('#i-question', root).addEventListener('change', (event) =>
    ctx.update(() => {
      inspect().questionId = (event.target as HTMLSelectElement).value;
      inspect().traceIndex = 0;
      inspect().koTarget = null;
    }),
  );
  onModelTab($('#i-models', root), (modelId) =>
    ctx.update(() => {
      inspect().modelId = modelId;
      inspect().traceIndex = 0;
    }),
  );
  const step = (by: number) =>
    ctx.update(() => {
      inspect().traceIndex += by;
    });
  button('#i-trace-prev', root).addEventListener('click', () => step(-1));
  button('#i-trace-next', root).addEventListener('click', () => step(1));
  button('#i-trace-other', root).addEventListener('click', () =>
    ctx.update(() => {
      const traces = tracesOf(current(ctx));
      const answer = traces[inspect().traceIndex]?.answer;
      const next = traces.findIndex((trace, index) => index > inspect().traceIndex && trace.answer !== answer);
      const wrapped = traces.findIndex((trace) => trace.answer !== answer);
      inspect().traceIndex = next >= 0 ? next : Math.max(0, wrapped);
    }),
  );
  select('#i-ko-target', root).addEventListener('change', (event) =>
    ctx.update(() => {
      inspect().koTarget = (event.target as HTMLSelectElement).value;
    }),
  );
  button('#i-ko-run', root).addEventListener('click', () => void ctx.actions.knockout());
}

export function current(ctx: Ctx): Measured | null {
  const run = ctx.state.run;
  if (!run) return null;
  const inspect = ctx.state.inspect;
  const ids = succeeded(run).map((result) => result.model.id);
  if (!ids.includes(inspect.modelId ?? '')) inspect.modelId = ids[0] ?? null;
  const question = questionOf(run, inspect.questionId);
  inspect.questionId = question.id;
  return inspect.modelId ? measured(run, inspect.modelId, question) : null;
}

function tracesOf(entry: Measured | null) {
  return (entry?.answer.runs ?? []).filter((run) => run.reasoning !== null);
}

function depthOf(model: RunModel): Depth {
  const levels = Object.values(LEVELS).map((level) => level(model));
  return { reached: levels.filter((level) => level !== 'closed').length, total: levels.length };
}

function renderLadder(root: HTMLElement, model: RunModel) {
  for (const row of $$('#i-ladder [data-cap]', root)) {
    const capability = row.dataset.cap ?? '';
    const level = LEVELS[capability]?.(model) ?? 'closed';
    setLevel(row, level);
    const status = $('[data-status]', row);
    if (!status.firstElementChild) {
      const template = document.getElementById('tpl-status') as HTMLTemplateElement;
      status.append(...template.content.cloneNode(true).childNodes);
    }
    variant(status, 'status', level);
    if (capability === 'probabilities') variant(row, capability, model.source);
    if (capability === 'reasoning') variant(row, capability, model.reasons ? 'returned' : 'none');
  }
}

function renderDistribution(root: HTMLElement, ctx: Ctx, entry: Measured) {
  const { answer, model, options } = entry;
  const panel = $('#i-dist-h', root).closest('section') as HTMLElement;
  variant(panel, 'source', answer.source ?? model.source);
  fill(root, {
    'i-model': model.label,
    'i-n': answer.runs?.length ?? '',
    'i-residual': pct(answer.residualMass ?? 0, 1),
  });
  const bars = $('#i-bars', root);
  renderBars(bars, answer, options);
  paint(bars, ctx.colorOf(model.id));
  $('[data-residual]', root).hidden = answer.residualMass === undefined;
  $('[data-tally]', root).hidden = !answer.runs;
  if (!answer.runs) return;

  const tally = $('#i-tally', root);
  paint(tally, ctx.colorOf(model.id));
  tally.replaceChildren(
    ...answer.runs.map((run, index) => {
      const cell = tpl('tpl-tally');
      cell.title = `#${index + 1}: ${run.answer ?? run.error ?? INVALID_ANSWER}`;
      flag(cell, 'top', run.answer === answer.choice);
      flag(cell, 'invalid', run.answer === null);
      return cell;
    }),
  );
  fill(root, { 'i-tally-top': answer.choice });
}

function renderReasoning(root: HTMLElement, ctx: Ctx, entry: Measured) {
  const panel = $('[data-panel="reasoning"]', root);
  const traces = tracesOf(entry);
  panel.hidden = traces.length === 0;
  if (!traces.length) return;

  const inspect = ctx.state.inspect;
  inspect.traceIndex = ((inspect.traceIndex % traces.length) + traces.length) % traces.length;
  const trace = traces[inspect.traceIndex];
  fill(panel, {
    'i-trace-index': inspect.traceIndex + 1,
    'i-trace-count': traces.length,
    'i-trace-answer': trace?.answer ?? INVALID_ANSWER,
  });
  $('#i-trace', root).textContent = trace?.reasoning ?? '';
  const several = traces.length > 1;
  button('#i-trace-prev', root).disabled = !several;
  button('#i-trace-next', root).disabled = !several;
  button('#i-trace-other', root).disabled = new Set(traces.map((candidate) => candidate.answer)).size < 2;
}

function renderKnockout(root: HTMLElement, ctx: Ctx, run: BenchRun, entry: Measured) {
  const inspect = ctx.state.inspect;
  if (!inspect.koTarget || !entry.options.includes(inspect.koTarget)) inspect.koTarget = entry.answer.choice;
  options(select('#i-ko-target', root), entry.options, inspect.koTarget);

  const model = enabledModels(ctx).find((candidate) => candidate.id === entry.model.id);
  const perSegment = model ? callsPerQuestion(model, run.settings.samples) : run.settings.samples;
  const segments = segmentInput(run.decision.input);
  const entries = ctx.state.entries.filter((candidate) => candidate.id === entry.model.id);
  const inputs = segments.map((segment) => withoutSegment(run.decision.input, segment));
  fill(root, {
    'i-ko-calls': int(segments.length * perSegment),
    'i-ko-cost': costLabel(estimateEach(inputs, entry.question, entries, run.settings)),
  });
  const running = ctx.state.koRunning;
  const progress = $('#i-ko-progress', root) as HTMLProgressElement;
  progress.hidden = !running;
  if (running) progress.value = running.total ? running.done / running.total : 0;
  button('#i-ko-run', root).disabled = !!running || !canCall(ctx.state) || !model;

  const knockout =
    ctx.state.knockouts[knockoutKey(ctx.state.run?.historyId ?? run.runId, entry.model.id, entry.question.id)];
  $('[data-ko-empty]', root).hidden = !!knockout;
  $('[data-ko-filled]', root).hidden = !knockout;
  if (!knockout) return;

  const target = knockout.options.indexOf(inspect.koTarget);
  const shifts = knockout.rows.map((row) => row.delta?.[target] ?? 0);
  const maxAbs = Math.max(0.1, ...shifts.map(Math.abs));
  let sampled = false;
  $('#i-ko-rows', root).replaceChildren(
    ...knockout.rows.map((row) => {
      const element = tpl('tpl-ko-row');
      const delta = row.delta?.[target] ?? null;
      const band = row.halfWidth?.[target] ?? 0;
      sampled ||= !!row.halfWidth;
      flag(element, 'noise', delta !== null && !!row.halfWidth && Math.abs(delta) < band);
      flag(element, 'failed', delta === null);
      if (row.error) element.title = row.error;
      fill(element, { segment: row.segment.text, delta: delta === null ? '—' : signed(delta) });
      setVars(element, {
        '--neg': delta !== null && delta < 0 ? `${((-delta / maxAbs) * 100).toFixed(1)}%` : '0%',
        '--pos': delta !== null && delta > 0 ? `${((delta / maxAbs) * 100).toFixed(1)}%` : '0%',
      });
      return element;
    }),
  );
  const noise = $('[data-ko-noise]', root);
  noise.hidden = !sampled;
  if (sampled) {
    const widest = Math.max(...knockout.rows.map((row) => row.halfWidth?.[target] ?? 0));
    fill(noise, { 'i-ko-band': widest.toFixed(2), 'i-ko-n': run.settings.samples });
  }
}

export function render(ctx: Ctx) {
  const root = view();
  const run = ctx.state.run;
  emptyOrFilled(root, !!run);
  if (!run) return;
  const entry = current(ctx);
  options(
    select('#i-question', root),
    run.decision.questions.map((question) => question.id),
    ctx.state.inspect.questionId,
  );
  const answered = succeeded(run).map((result) => result.model.id);
  renderModelTabs(
    $('#i-models', root),
    ctx,
    run.models.filter((model) => answered.includes(model.id)),
    ctx.state.inspect.modelId,
    depthOf,
  );
  if (!entry) return;

  renderLadder(root, entry.model);
  renderDistribution(root, ctx, entry);
  renderReasoning(root, ctx, entry);
  renderKnockout(root, ctx, run, entry);
}
