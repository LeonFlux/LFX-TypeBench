import {
  consensus,
  divergenceMatrix,
  expectedValue,
  marginOfError,
  probabilitiesOf,
  sumCosts,
  validRuns,
} from '@typed-decisions/core';
import { $, downloadJson, emptyOrFilled, fill, selectTab, tpl, variant } from '../dom.ts';
import { duration, int, pct } from '../format.ts';
import { maybeMoney, money } from '../services/costs.ts';
import type { BenchRun, Ctx } from '../state.ts';
import { renderBars } from './bars.ts';
import { renderHeatTable } from './heat-table.ts';
import { paint } from './palette.ts';
import { labelOf, type Measured, measuredAll, questionOf } from './run-lookup.ts';

const view = () => $('[data-view="results"]');

export function mount(ctx: Ctx) {
  const root = view();
  $('#r-qtabs', root).addEventListener('click', (event) => {
    const tab = (event.target as HTMLElement).closest('[data-qid]') as HTMLElement | null;
    if (!tab) return;
    ctx.update(() => {
      ctx.state.results.questionId = tab.dataset.qid ?? null;
    });
  });
  $('#r-export', root).addEventListener('click', () => {
    const run = ctx.state.run;
    if (run) downloadJson(`${run.meta.id}-${run.runId}.json`, run);
  });
}

function renderTabs(root: HTMLElement, run: BenchRun, activeId: string) {
  $('#r-qtabs', root).replaceChildren(
    ...run.decision.questions.map((question, index) => {
      const tab = tpl('tpl-qtab');
      tab.dataset.qid = question.id;
      fill(tab, { n: index + 1, id: question.id });
      variant(tab, 'qtype', question.type);
      selectTab(tab, question.id === activeId);
      return tab;
    }),
  );
}

function renderErrors(root: HTMLElement, run: BenchRun) {
  const failed = run.results.filter((result) => result.status === 'failed');
  $('#r-errors', root).hidden = failed.length === 0;
  $('#r-error-list', root).replaceChildren(
    ...failed.map((result) => {
      const item = tpl('tpl-error-row');
      fill(item, { label: labelOf(run, result.model.id), message: result.status === 'failed' ? result.error : '' });
      return item;
    }),
  );
}

function renderCard(ctx: Ctx, entry: Measured): HTMLElement {
  const { answer, options, question, model } = entry;
  const card = tpl('tpl-rcard');
  const probabilities = probabilitiesOf(answer, options);
  const n = validRuns(answer);
  const invalid = (answer.runs?.length ?? 0) - n;
  variant(card, 'source', answer.source ?? model.source);
  fill(card, {
    label: model.label,
    answer: answer.choice,
    confidence: pct(probabilities[options.indexOf(answer.choice)] ?? 0),
    n: answer.runs?.length ?? '',
    valid: n,
    invalid,
    residual: pct(answer.residualMass ?? 0, 1),
    band: marginOfError(n).toFixed(2),
  });
  $('[data-invalid-note]', card).hidden = invalid === 0;
  renderBars($('[data-bars]', card), answer, options);
  paint(card, ctx.colorOf(model.id));
  const expected = $('[data-ev]', card);
  expected.hidden = question.type !== 'score';
  if (question.type === 'score') fill(card, { ev: expectedValue(options, probabilities).toFixed(2) });
  return card;
}

const MIN_SCALE = 0.05;
const BASE_SHADE = 0.05;
const SHADE_RANGE = 0.4;

function renderMatrix(root: HTMLElement, run: BenchRun, entries: Measured[]) {
  const matrix = divergenceMatrix(
    entries.map((entry) => ({ id: entry.model.id, probabilities: probabilitiesOf(entry.answer, entry.options) })),
  );
  const scale = Math.max(MIN_SCALE, ...matrix.values.flat());
  renderHeatTable(
    $('#r-matrix', root),
    matrix.ids.map((id) => labelOf(run, id)),
    (row, column) => {
      const value = matrix.values[row]?.[column] ?? 0;
      if (row === column) return { text: '—', shade: 0, self: true };
      return { text: value.toFixed(3), shade: BASE_SHADE + SHADE_RANGE * (value / scale) };
    },
  );
  const maxPair = matrix.maxPair;
  $('[data-maxpair]', root).hidden = !maxPair;
  if (maxPair) {
    fill(root, {
      'r-maxpair': `${labelOf(run, maxPair.a)} ↔ ${labelOf(run, maxPair.b)}`,
      'r-maxval': maxPair.value.toFixed(3),
    });
  }
}

function renderCost(root: HTMLElement, ctx: Ctx, run: BenchRun, entries: Measured[]) {
  const maxMs = Math.max(1, ...entries.map((entry) => entry.answer.latencyMs ?? 0));
  $('#r-cost tbody', root).replaceChildren(
    ...entries.map(({ model, answer }) => {
      const row = tpl('tpl-cost-row');
      const usage = answer.usage;
      paint(row, ctx.colorOf(model.id));
      fill(row, {
        label: model.label,
        calls: usage?.calls ?? '—',
        wall: duration(answer.latencyMs ?? 0),
        tokens: usage ? `${int(usage.inputTokens)} / ${int(usage.outputTokens)}` : '—',
        cost: maybeMoney(usage?.costUsd ?? null),
      });
      (row.querySelector('progress') as HTMLProgressElement).value = (answer.latencyMs ?? 0) / maxMs;
      return row;
    }),
  );
  const answers = run.results.flatMap((result) => result.answers);
  const total = sumCosts(run.results.map((result) => result.costUsd));
  fill(root, {
    'r-total-calls': int(answers.reduce((sum, answer) => sum + (answer.usage?.calls ?? 0), 0)),
    'r-total-wall': duration(Math.max(0, ...run.results.map((result) => result.latencyMs))),
    'r-total-cost': total.complete ? money(total.usd) : `${money(total.usd)} + unknown`,
  });
}

export function render(ctx: Ctx) {
  const root = view();
  const run = ctx.state.run;
  emptyOrFilled(root, !!run);
  if (!run) return;

  const question = questionOf(run, ctx.state.results.questionId);
  const entries = measuredAll(run, question);
  renderTabs(root, run, question.id);
  $('#r-stopped', root).hidden = !run.stopped;
  renderErrors(root, run);

  const agreement = consensus(entries.map((entry) => entry.answer.choice));
  const verdict = $('[data-verdict]', root);
  const kind = agreement.unanimous ? 'unanimous' : 'split';
  verdict.classList.toggle('badge-info', agreement.unanimous);
  verdict.classList.toggle('badge-warning', !agreement.unanimous);
  variant(verdict, 'verdict', kind);
  fill(root, {
    'r-prompt': question.prompt,
    'r-agree': agreement.count,
    'r-total': agreement.total,
    'r-consensus': agreement.answer || '—',
  });

  $('#r-cards', root).replaceChildren(...entries.map((entry) => renderCard(ctx, entry)));
  renderMatrix(root, run, entries);
  renderCost(root, ctx, run, entries);
}
