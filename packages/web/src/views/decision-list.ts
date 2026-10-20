import { defaultDrafts } from '../data/sample.ts';
import { $, button, fill, selectMenuItem, tpl } from '../dom.ts';
import { missingDefaults, summaryOf } from '../services/decisions.ts';
import type { Ctx } from '../state.ts';

const view = () => $('nav[aria-labelledby="decisions-h"]');

export function mount(ctx: Ctx) {
  const root = view();
  $('#d-list', root).addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const item = target.closest('[data-key]') as HTMLElement | null;
    const key = item?.dataset.key;
    if (!key) return;
    const remove = !!target.closest('[data-remove-decision]');
    ctx.update(() => (remove ? ctx.actions.removeDraft(key) : ctx.actions.selectDraft(key)), { structure: true });
  });
  button('#d-new', root).addEventListener('click', () => ctx.update(() => ctx.actions.addDraft(), { structure: true }));
  button('#d-restore', root).addEventListener('click', () =>
    ctx.update(() => ctx.actions.restoreDrafts(), { structure: true }),
  );
}

export function render(ctx: Ctx) {
  const root = view();
  const { drafts, draft: active } = ctx.state;
  fill(root, { 'd-count': drafts.length });
  const items = drafts.map((draft) => {
    const item = tpl('tpl-decision');
    const summary = summaryOf(draft);
    item.dataset.key = draft.key;
    fill(item, { name: summary.name || draft.id || '—', questions: summary.questions, version: summary.version });
    const select = $('[data-select-decision]', item);
    const on = draft.key === active.key;
    selectMenuItem(select, on);
    return item;
  });
  $('#d-list', root).replaceChildren(...items);
  button('#d-restore', root).hidden = missingDefaults({ drafts, activeKey: active.key }, defaultDrafts()).length === 0;
}
