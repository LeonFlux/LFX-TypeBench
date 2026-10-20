import { argmax, type BatchAnswer, type ItemFilter, itemsMatching, optionsOf } from '@typed-decisions/core';
import { $, $$, fill, flag, tpl, variant } from '../dom.ts';
import { pct } from '../format.ts';
import type { StoredCalibration } from '../services/calibrations.ts';
import type { Ctx } from '../state.ts';
import { paint } from './palette.ts';

const FILTERS: ItemFilter[] = ['all', 'wrong', 'confidently-wrong', 'disagree', 'all-wrong', 'failed'];
const BIN_COUNT = 10;

type Outcome = 'right' | 'wrong' | 'failed';

export function mountItems(ctx: Ctx, root: HTMLElement) {
  const batch = () => ctx.state.batch;
  $('#c-filters', root).addEventListener('click', (event) => {
    const filter = (event.target as HTMLElement).closest<HTMLElement>('[data-filter]')?.dataset.filter;
    if (filter)
      ctx.update(() => {
        batch().filter = filter as ItemFilter;
        batch().itemIndex = null;
      });
  });
  $('#c-drill-clear', root).addEventListener('click', () =>
    ctx.update(() => {
      batch().drill = null;
    }),
  );
  $('#c-items', root).addEventListener('click', (event) => {
    const index = (event.target as HTMLElement).closest<HTMLElement>('[data-index]')?.dataset.index;
    if (index !== undefined)
      ctx.update(() => {
        batch().itemIndex = Number(index);
      });
  });
  $('#c-item-close', root).addEventListener('click', () =>
    ctx.update(() => {
      batch().itemIndex = null;
    }),
  );
}

function inputText(calibration: StoredCalibration, index: number): string {
  const input = calibration.items[index]?.input;
  if (!input) return '';
  return input.kind === 'text' ? input.text : JSON.stringify(input.json, null, 2);
}

function answerAt(answers: readonly BatchAnswer[] | undefined, index: number) {
  const answer = answers?.find((candidate) => candidate.index === index);
  return answer?.status === 'ok' && answer.probabilities ? answer.probabilities : null;
}

function outcomeOf(calibration: StoredCalibration, probabilities: number[] | null, index: number): Outcome {
  if (!probabilities) return 'failed';
  return optionsOf(calibration.question)[argmax(probabilities)] === calibration.items[index]?.truth ? 'right' : 'wrong';
}

function pickLabel(labels: string[], probabilities: number[] | null) {
  if (!probabilities) return { answer: '—', confidence: '—' };
  const top = argmax(probabilities);
  return { answer: labels[top] ?? '', confidence: pct(probabilities[top] ?? 0) };
}

export function renderItems(ctx: Ctx, root: HTMLElement, calibration: StoredCalibration, modelId: string) {
  const { batch } = ctx.state;
  const labels = optionsOf(calibration.question);
  const request = {
    options: labels,
    truths: calibration.items.map((item) => item.truth),
    byModel: calibration.byModel,
    modelId,
    drill: batch.drill,
  };
  for (const tab of $$('[data-filter]', root)) {
    const filter = tab.dataset.filter as ItemFilter;
    tab.classList.toggle('tab-active', filter === batch.filter);
    tab.setAttribute('aria-selected', String(filter === batch.filter));
    fill(tab, { count: itemsMatching({ ...request, filter }).length });
    tab.hidden = !FILTERS.includes(filter);
  }

  const drill = $('#c-drill', root);
  drill.hidden = !batch.drill;
  if (batch.drill) {
    variant(drill, 'drill', 'bin' in batch.drill ? 'bin' : 'cell');
    if ('bin' in batch.drill) {
      const lo = Math.round((batch.drill.bin / BIN_COUNT) * 100);
      fill(drill, { 'c-drill-bin': `${lo}–${lo + 100 / BIN_COUNT}%` });
    } else {
      fill(drill, { 'c-drill-truth': batch.drill.truth, 'c-drill-predicted': batch.drill.predicted });
    }
  }

  const shown = itemsMatching({ ...request, filter: batch.filter });
  fill(root, { 'c-shown': shown.length });
  $('[data-c-no-items]', root).hidden = shown.length > 0;
  const answers = calibration.byModel[modelId];
  $('#c-items tbody', root).replaceChildren(
    ...shown.map((index) => {
      const row = tpl('tpl-item-row');
      const probabilities = answerAt(answers, index);
      row.dataset.index = String(index);
      flag(row, 'open', index === batch.itemIndex);
      variant(row, 'outcome', outcomeOf(calibration, probabilities, index));
      fill(row, {
        n: index + 1,
        input: inputText(calibration, index),
        truth: calibration.items[index]?.truth ?? '',
        ...pickLabel(labels, probabilities),
      });
      return row;
    }),
  );

  renderItem(ctx, root, calibration, shown.includes(batch.itemIndex ?? -1) ? batch.itemIndex : null);
}

function renderItem(ctx: Ctx, root: HTMLElement, calibration: StoredCalibration, index: number | null) {
  const panel = $('#c-item', root);
  panel.hidden = index === null;
  if (index === null) return;
  const labels = optionsOf(calibration.question);
  fill(panel, {
    'c-item-n': index + 1,
    'c-item-truth': calibration.items[index]?.truth ?? '',
    'c-item-input': inputText(calibration, index),
  });
  $('#c-item-models', panel).replaceChildren(
    ...calibration.models.map((model) => {
      const card = tpl('tpl-item-model');
      const probabilities = answerAt(calibration.byModel[model.id], index);
      paint(card, ctx.colorOf(model.id));
      variant(card, 'outcome', outcomeOf(calibration, probabilities, index));
      fill(card, { label: model.label, ...pickLabel(labels, probabilities) });
      const top = probabilities ? argmax(probabilities) : -1;
      $('[data-bars]', card).replaceChildren(
        ...(probabilities ?? []).map((probability, option) => {
          const bar = tpl('tpl-bar');
          fill(bar, { label: labels[option] ?? '', value: pct(probability, 1) });
          (bar.querySelector('progress') as HTMLProgressElement).value = probability;
          flag(bar, 'top', option === top);
          return bar;
        }),
      );
      return card;
    }),
  );
}
