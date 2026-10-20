import { type Answer, argmax, probabilitiesOf, validRuns } from '@typed-decisions/core';
import { fill, flag, tpl } from '../dom.ts';
import { pct } from '../format.ts';

export function countsOf(answer: Answer, options: string[]): number[] {
  const answers = answer.runs?.map((run) => run.answer) ?? [];
  return options.map((option) => answers.filter((candidate) => candidate === option).length);
}

export function renderBars(container: HTMLElement, answer: Answer, options: string[]) {
  const probabilities = probabilitiesOf(answer, options);
  const top = argmax(probabilities);
  const counts = countsOf(answer, options);
  const n = validRuns(answer);
  container.replaceChildren(
    ...options.map((option, index) => {
      const row = tpl('tpl-bar');
      const probability = probabilities[index] ?? 0;
      fill(row, { label: option, value: answer.runs ? `${counts[index]}/${n}` : pct(probability) });
      (row.querySelector('progress') as HTMLProgressElement).value = probability;
      flag(row, 'top', index === top);
      row.title = `${option}: ${pct(probability, 1)}`;
      return row;
    }),
  );
}
