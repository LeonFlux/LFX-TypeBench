import { $, button, fill, options, select, variant } from '../dom.ts';
import { runsOf } from '../services/history.ts';
import type { Ctx } from '../state.ts';

const view = () => $('#run-bar');
const SHOWN_ON = ['results', 'inspect'];
function runLabel(createdAt: string, models: number, stopped: boolean): string {
  const time = new Date(createdAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  return `${time} · ${models} models${stopped ? ' · stopped' : ''}`;
}

export function mount(ctx: Ctx) {
  const root = view();
  select('#rb-run', root).addEventListener('change', (event) =>
    ctx.update(() => ctx.actions.selectRun((event.target as HTMLSelectElement).value)),
  );
  button('#rb-delete', root).addEventListener('click', () => ctx.update(() => ctx.actions.deleteSelectedRun()));
  button('#rb-delete-all', root).addEventListener('click', () => ctx.update(() => ctx.actions.deleteDecisionRuns()));
  button('#rb-clear', root).addEventListener('click', () => ctx.update(() => ctx.actions.clearHistory()));
}

export function render(ctx: Ctx) {
  const root = view();
  const { state } = ctx;
  root.hidden = !SHOWN_ON.includes(state.view);
  if (root.hidden) return;

  const runs = runsOf(state.history, state.draft.key);
  const picker = select('#rb-run', root);
  options(
    picker,
    runs.map((run) => ({ value: run.historyId, label: runLabel(run.createdAt, run.models.length, run.stopped) })),
    state.run?.historyId ?? null,
  );
  picker.disabled = runs.length === 0;
  button('#rb-delete', root).disabled = !state.run;
  button('#rb-delete-all', root).disabled = runs.length === 0;
  button('#rb-clear', root).disabled = state.history.length === 0;

  variant(root, 'history', runs.length ? 'some' : 'none');
  fill(root, { 'rb-count': runs.length, 'rb-dropped': state.droppedRuns });
  $('[data-pruned]', root).hidden = state.droppedRuns === 0;
}
