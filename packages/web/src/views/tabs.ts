import { $, fill, selectTab, tpl } from '../dom.ts';
import type { Ctx, RunModel } from '../state.ts';
import { paint } from './palette.ts';

export type Depth = { reached: number; total: number };

export function renderModelTabs<M extends Pick<RunModel, 'id' | 'label'>>(
  container: HTMLElement,
  ctx: Ctx,
  models: M[],
  activeId: string | null,
  depthOf?: (model: M) => Depth,
) {
  container.replaceChildren(
    ...models.map((model) => {
      const tab = tpl('tpl-model-tab');
      tab.dataset.mid = model.id;
      paint(tab, ctx.colorOf(model.id));
      selectTab(tab, model.id === activeId);
      fill(tab, { label: model.label });
      const depth = depthOf?.(model);
      $('[data-depth]', tab).hidden = !depth;
      if (depth) fill(tab, { depth: depth.reached, 'depth-total': depth.total });
      return tab;
    }),
  );
}

export function onModelTab(container: HTMLElement, choose: (modelId: string) => void) {
  container.addEventListener('click', (event) => {
    const tab = (event.target as HTMLElement).closest('[data-mid]') as HTMLElement | null;
    if (tab?.dataset.mid) choose(tab.dataset.mid);
  });
}
