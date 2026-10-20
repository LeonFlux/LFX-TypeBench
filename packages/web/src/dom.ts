export function $(selector: string, root: ParentNode = document): HTMLElement {
  const element = root.querySelector<HTMLElement>(selector);
  if (!element) throw new Error(`Missing element ${selector}`);
  return element;
}

export function $$(selector: string, root: ParentNode = document): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(selector)];
}

export function input(selector: string, root: ParentNode = document): HTMLInputElement {
  return $(selector, root) as HTMLInputElement;
}

export function select(selector: string, root: ParentNode = document): HTMLSelectElement {
  return $(selector, root) as HTMLSelectElement;
}

export function button(selector: string, root: ParentNode = document): HTMLButtonElement {
  return $(selector, root) as HTMLButtonElement;
}

export function tpl(id: string): HTMLElement {
  const template = document.getElementById(id) as HTMLTemplateElement | null;
  const first = template?.content.firstElementChild;
  if (!first) throw new Error(`Missing template ${id}`);
  return first.cloneNode(true) as HTMLElement;
}

function within(root: HTMLElement | Document, selector: string): HTMLElement[] {
  const self = root instanceof HTMLElement && root.matches(selector) ? [root] : [];
  return [...self, ...$$(selector, root)];
}

export function fill(root: HTMLElement | Document, data: Record<string, string | number>) {
  for (const [key, value] of Object.entries(data)) {
    for (const element of within(root, `[data-slot="${key}"]`)) element.textContent = String(value);
  }
}

export function variant(root: HTMLElement | Document, group: string, value: string | boolean) {
  for (const element of within(root, `[data-variant-of="${group}"]`)) {
    element.hidden = element.dataset.variant !== String(value);
  }
}

export function setVars(element: HTMLElement, vars: Record<string, string | number>) {
  for (const [key, value] of Object.entries(vars)) element.style.setProperty(key, String(value));
}

export function flag(element: HTMLElement, name: string, on: boolean) {
  element.toggleAttribute(`data-${name}`, on);
}

export function emptyOrFilled(view: HTMLElement, filled: boolean) {
  for (const element of $$(':scope > [data-empty]', view)) element.hidden = filled;
  for (const element of $$(':scope > [data-filled]', view)) element.hidden = !filled;
}

export type Choice = string | { value: string; label: string };

export function options(
  element: HTMLSelectElement | HTMLDataListElement,
  choices: Choice[],
  selected: string | null = null,
) {
  element.replaceChildren(
    ...choices.map((choice) => {
      const option = document.createElement('option');
      option.value = typeof choice === 'string' ? choice : choice.value;
      option.label = typeof choice === 'string' ? choice : choice.label;
      option.textContent = option.label;
      return option;
    }),
  );
  if (selected !== null && element instanceof HTMLSelectElement) element.value = selected;
}

export function selectTab(element: HTMLElement, on: boolean) {
  element.setAttribute('aria-selected', String(on));
  element.classList.toggle('tab-active', on);
}

export function selectMenuItem(element: HTMLElement, on: boolean) {
  element.classList.toggle('menu-active', on);
  if (on) element.setAttribute('aria-current', 'page');
  else element.removeAttribute('aria-current');
}

export function downloadJson(name: string, value: unknown) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}
