import { type Capability, InputSchema, plannedCalls, segmentInput } from '@typed-decisions/core';
import { $, $$, button, fill, flag, input, options, tpl, variant } from '../dom.ts';
import { int, runDuration } from '../format.ts';
import { costLabel, estimateRun } from '../services/costs.ts';
import {
  checkDraft,
  type Draft,
  type DraftQuestion,
  formatJson,
  MAX_SCORE_STEPS,
  newQuestion,
  type QuestionType,
  rawDecision,
  switchFormat,
} from '../services/draft.ts';
import {
  addModel,
  isFree,
  isFreeListing,
  type ModelEntry,
  probabilitySource,
  removeModel,
  resolveModels,
} from '../services/registry.ts';
import { writeApiKey } from '../services/session.ts';
import type { Ctx, RenderOptions } from '../state.ts';
import { canCall, canRun, enabledModels, entryCapabilities, usesServerKey } from './models.ts';
import { availability, type Level, paint, setLevel } from './palette.ts';

const view = () => $('[data-view="define"]');
const SAMPLE_PRESETS = [5, 10, 20, 40];
const JSON_INPUT_CLASSES = ['font-mono', 'text-sm', 'bg-neutral', 'text-neutral-content'];
const MIN_INPUT_ROWS = 5;
const MAX_INPUT_ROWS = 20;

function fitRows(textarea: HTMLTextAreaElement) {
  const lines = textarea.value.split('\n').length;
  textarea.rows = Math.min(MAX_INPUT_ROWS, Math.max(MIN_INPUT_ROWS, lines));
}
const KEY_PLACEHOLDER = 'sk-or-...';

function keySource(ctx: Ctx): string {
  if (usesServerKey(ctx.state)) return 'server';
  return ctx.state.server?.features.openRouter ? 'override' : 'browser';
}
const MIN_SAMPLES = 1;
const MAX_SAMPLES = 100;
const TOKENS_PER_MILLION = 1_000_000;

function questionIndex(element: Element): number {
  return Number((element.closest('[data-q]') as HTMLElement | null)?.dataset.q);
}

function editQuestion(question: DraftQuestion, field: string, value: string) {
  if (field === 'min' || field === 'max') question[field] = Number.parseInt(value, 10);
  if (field === 'id') question.id = value.trim();
  if (field === 'prompt') question.prompt = value;
}

function mountDecision(ctx: Ctx, root: HTMLElement) {
  const draft = () => ctx.state.draft;
  input('#d-name', root).addEventListener('input', (event) =>
    ctx.update(() => {
      draft().name = (event.target as HTMLInputElement).value;
    }),
  );
  input('#d-id', root).addEventListener('input', (event) =>
    ctx.update(() => {
      draft().id = (event.target as HTMLInputElement).value.trim();
    }),
  );
  input('#d-version', root).addEventListener('input', (event) =>
    ctx.update(() => {
      draft().version = Math.max(1, Number.parseInt((event.target as HTMLInputElement).value, 10) || 1);
    }),
  );
  const textarea = $('#d-input', root) as HTMLTextAreaElement;
  textarea.addEventListener('input', () =>
    ctx.update(() => {
      draft().input.value = textarea.value;
      fitRows(textarea);
    }),
  );
  textarea.addEventListener('blur', () => {
    if (draft().input.format !== 'json') return;
    ctx.update(
      () => {
        draft().input.value = formatJson(textarea.value);
      },
      { structure: true },
    );
  });
  for (const radio of $$('input[name="input-format"]', root)) {
    radio.addEventListener('change', () =>
      ctx.update(
        () => {
          draft().input = switchFormat(draft().input, (radio as HTMLInputElement).value as Draft['input']['format']);
        },
        { structure: true },
      ),
    );
  }
  for (const add of $$('[data-add-question]', root)) {
    add.addEventListener('click', () =>
      ctx.update(
        () => {
          const ids = draft().questions.map((question) => question.id);
          draft().questions.push(newQuestion(add.dataset.addQuestion as QuestionType, ids));
        },
        { structure: true },
      ),
    );
  }
}

function mountQuestions(ctx: Ctx, root: HTMLElement) {
  const questions = () => ctx.state.draft.questions;
  const list = $('#q-list', root);
  list.addEventListener('input', (event) => {
    const target = event.target as HTMLInputElement;
    const field = target.dataset.field;
    const question = questions()[questionIndex(target)];
    if (!field || !question) return;
    ctx.update(() => editQuestion(question, field, target.value));
  });
  list.addEventListener('change', (event) => {
    const target = event.target as HTMLInputElement;
    const question = questions()[questionIndex(target)];
    if (!target.hasAttribute('data-type-radio') || !question) return;
    ctx.update(
      () => {
        question.type = target.value as QuestionType;
      },
      { structure: true },
    );
  });
  list.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const removeQuestion = target.closest('[data-remove]');
    const removeOption = target.closest('[data-remove-option]');
    if (removeQuestion)
      ctx.update(() => void questions().splice(questionIndex(removeQuestion), 1), { structure: true });
    if (removeOption) {
      const optionIndex = Number((removeOption.closest('[data-o]') as HTMLElement).dataset.o);
      ctx.update(() => void questions()[questionIndex(removeOption)]?.options.splice(optionIndex, 1), {
        structure: true,
      });
    }
  });
  list.addEventListener('submit', (event) => {
    event.preventDefault();
    const form = event.target as HTMLFormElement;
    const field = form.querySelector('input') as HTMLInputElement;
    const value = field.value.trim();
    const index = questionIndex(form);
    if (!value) return;
    ctx.update(() => void questions()[index]?.options.push(value), { structure: true });
    input(`[data-q="${index}"] [data-add-option] input`, root).focus();
  });
}

function mountModels(ctx: Ctx, root: HTMLElement) {
  const { state } = ctx;
  input('#k-key', root).addEventListener('input', (event) =>
    ctx.update(() => {
      state.apiKey = (event.target as HTMLInputElement).value.trim();
      writeApiKey(state.apiKey);
    }),
  );
  button('#k-clear', root).addEventListener('click', () =>
    ctx.update(
      () => {
        state.apiKey = '';
        writeApiKey('');
      },
      { structure: true },
    ),
  );
  $('#model-groups', root).addEventListener('change', (event) => {
    const target = event.target as HTMLInputElement;
    if (!target.hasAttribute('data-enable')) return;
    ctx.update(
      () => {
        if (target.checked) state.enabled.add(target.value);
        else state.enabled.delete(target.value);
      },
      { structure: true },
    );
  });
  $('#model-groups', root).addEventListener('click', (event) => {
    const remove = (event.target as HTMLElement).closest('[data-remove-model]') as HTMLElement | null;
    if (!remove?.dataset.modelId) return;
    const id = remove.dataset.modelId;
    ctx.update(
      () => {
        state.modelIds = removeModel(state.modelIds, id);
        state.entries = resolveModels(state.modelIds, state.catalog);
        state.enabled.delete(id);
      },
      { structure: true },
    );
  });
  button('#m-add-remote', root).addEventListener('click', () =>
    ctx.update(
      () => {
        state.addOpen = !state.addOpen;
      },
      { structure: true },
    ),
  );
  input('#m-free-only', root).addEventListener('change', (event) =>
    ctx.update(
      () => {
        state.freeOnly = (event.target as HTMLInputElement).checked;
      },
      { structure: true },
    ),
  );
  $('#m-add', root).addEventListener('submit', (event) => {
    event.preventDefault();
    const field = input('#m-add input', root);
    const outcome = addModel(state.modelIds, field.value.trim(), state.catalog);
    ctx.update(
      () => {
        state.addError = 'error' in outcome ? outcome.error : null;
        if ('ids' in outcome) {
          state.modelIds = outcome.ids;
          state.entries = resolveModels(outcome.ids, state.catalog);
          state.enabled.add(field.value.trim());
          field.value = '';
        }
      },
      { structure: true },
    );
  });
}

function mountSettings(ctx: Ctx, root: HTMLElement) {
  const settings = ctx.state.settings;
  for (const radio of $$('input[name="samples"]', root)) {
    radio.addEventListener('change', () =>
      ctx.update(() => {
        settings.samples = Number((radio as HTMLInputElement).value);
        input('#s-samples', root).value = '';
      }),
    );
  }
  input('#s-samples', root).addEventListener('input', (event) => {
    const samples = Number.parseInt((event.target as HTMLInputElement).value, 10);
    if (!Number.isInteger(samples) || samples < MIN_SAMPLES || samples > MAX_SAMPLES) return;
    ctx.update(() => {
      settings.samples = samples;
    });
  });
  input('#s-rpm', root).addEventListener('input', (event) => {
    const limit = Number.parseInt((event.target as HTMLInputElement).value, 10);
    ctx.update(() => {
      ctx.state.requestsPerMinute = Number.isInteger(limit) && limit >= 0 ? limit : 0;
    });
  });
  input('#s-seed', root).addEventListener('input', (event) =>
    ctx.update(() => {
      settings.seed = Number.parseInt((event.target as HTMLInputElement).value, 10) || 0;
    }),
  );
  input('#s-reasoning', root).addEventListener('change', (event) =>
    ctx.update(() => {
      settings.reasoning = (event.target as HTMLInputElement).checked;
    }),
  );
  button('#run-btn', root).addEventListener('click', () => void ctx.actions.run());
  button('#run-cancel', root).addEventListener('click', () => ctx.state.running?.controller.abort());
}

export function mount(ctx: Ctx) {
  const root = view();
  mountDecision(ctx, root);
  mountQuestions(ctx, root);
  mountModels(ctx, root);
  mountSettings(ctx, root);
}

function renderInputs(root: HTMLElement, ctx: Ctx) {
  const { draft, settings, apiKey } = ctx.state;
  input('#d-name', root).value = draft.name;
  input('#d-id', root).value = draft.id;
  input('#d-version', root).value = String(draft.version);
  const textarea = $('#d-input', root) as HTMLTextAreaElement;
  textarea.value = draft.input.value;
  const json = draft.input.format === 'json';
  for (const name of JSON_INPUT_CLASSES) textarea.classList.toggle(name, json);
  fitRows(textarea);
  input('#k-key', root).value = apiKey;
  for (const radio of $$('input[name="input-format"]', root) as HTMLInputElement[]) {
    radio.checked = radio.value === draft.input.format;
  }
  for (const radio of $$('input[name="samples"]', root) as HTMLInputElement[]) {
    radio.checked = Number(radio.value) === settings.samples;
  }
  input('#s-samples', root).value = SAMPLE_PRESETS.includes(settings.samples) ? '' : String(settings.samples);
  input('#s-rpm', root).value = String(ctx.state.requestsPerMinute);
  input('#s-seed', root).value = String(settings.seed);
  input('#s-reasoning', root).checked = settings.reasoning;
}

function renderQuestion(question: DraftQuestion, index: number): HTMLElement {
  const element = tpl('tpl-question');
  element.dataset.q = String(index);
  fill(element, { n: index + 1 });
  input('[data-field="id"]', element).value = question.id;
  input('[data-field="prompt"]', element).value = question.prompt;
  for (const radio of $$('[data-type-radio]', element) as HTMLInputElement[]) {
    radio.name = `qtype-${index}`;
    radio.checked = radio.value === question.type;
  }
  for (const area of $$('[data-type-area]', element)) area.hidden = area.dataset.typeArea !== question.type;
  variant(element, 'scored', question.type);
  $('[data-options]', element).replaceChildren(
    ...question.options.map((option, optionIndex) => {
      const item = tpl('tpl-option');
      item.dataset.o = String(optionIndex);
      fill(item, { label: option });
      return item;
    }),
  );
  input('[data-field="min"]', element).value = String(question.min);
  input('[data-field="max"]', element).value = String(question.max);
  return element;
}

function pricingLabel(entry: ModelEntry): string {
  if (!entry.pricing) return 'variable';
  if (isFree(entry)) return 'free';
  const perMillion = (perToken: number) => `$${(perToken * TOKENS_PER_MILLION).toFixed(2)}`;
  return `${perMillion(entry.pricing.inputPerToken)} / ${perMillion(entry.pricing.outputPerToken)}`;
}

function contextLabel(tokens: number | null): string {
  if (tokens === null) return '—';
  return tokens >= TOKENS_PER_MILLION ? `${tokens / TOKENS_PER_MILLION}M` : `${Math.round(tokens / 1000)}K`;
}

function reasoningVariant(entry: ModelEntry, capabilities: readonly Capability[]): string {
  if (!entry.profile.reasoning || !capabilities.includes('reasoning')) return 'none';
  return entry.profile.reasoning.mandatory ? 'always' : 'optional';
}

function renderModel(ctx: Ctx, entry: ModelEntry): HTMLElement {
  const element = tpl('tpl-model');
  const on = ctx.state.enabled.has(entry.id);
  flag(element, 'off', !on);
  const checkbox = input('[data-enable]', element);
  checkbox.value = entry.id;
  checkbox.checked = on;
  button('[data-remove-model]', element).dataset.modelId = entry.id;
  fill(element, {
    label: entry.label,
    version: entry.version,
    'model-id': entry.id,
    pricing: pricingLabel(entry),
    context: contextLabel(entry.contextLength),
    effort: entry.profile.reasoning?.effort ?? '',
  });

  const capabilities = entryCapabilities(ctx.state, entry);
  const source = probabilitySource({ ...entry, capabilities });
  const reasoning = reasoningVariant(entry, capabilities);
  const attribution = capabilities.includes('attribution');
  variant(element, 'probabilities', source);
  variant(element, 'reasoning', reasoning);
  variant(element, 'seed', entry.profile.seed);
  variant(element, 'temperature', entry.profile.temperature);
  variant(element, 'attribution', attribution);
  const levels: Record<string, Level> = {
    probabilities: source === 'logprobs' ? 'direct' : 'estimated',
    reasoning: availability(reasoning !== 'none'),
    seed: availability(entry.profile.seed),
    temperature: availability(entry.profile.temperature),
    context: availability(entry.contextLength !== null),
    price: availability(entry.pricing !== null),
    attribution: availability(attribution),
  };
  for (const [capability, level] of Object.entries(levels)) {
    setLevel($(`[data-capline="${capability}"]`, element), level);
  }
  paint(element, ctx.colorOf(entry.id));
  return element;
}

function renderModels(root: HTMLElement, ctx: Ctx) {
  $('#model-groups', root).replaceChildren(...ctx.state.entries.map((entry) => renderModel(ctx, entry)));
  variant(root, 'catalog-state', ctx.state.catalogStatus);
  $('#m-add', root).hidden = !ctx.state.addOpen;
  button('#m-add-remote', root).setAttribute('aria-expanded', String(ctx.state.addOpen));

  const catalog = (ctx.state.catalog ?? []).filter((entry) => !ctx.state.freeOnly || isFreeListing(entry));
  options(
    $('#m-catalog', root) as HTMLDataListElement,
    catalog.map((entry) => ({ value: entry.id, label: entry.name })),
  );
  fill(root, { 'catalog-count': int(catalog.length) });
  input('#m-free-only', root).checked = ctx.state.freeOnly;
  const addError = $('[data-add-error]', root);
  addError.hidden = !ctx.state.addError;
  if (ctx.state.addError) variant(addError, 'add-error', ctx.state.addError);
}

function renderValidation(root: HTMLElement, errors: ReturnType<typeof checkDraft>['errors']) {
  $('#validation', root).hidden = errors.length === 0;
  $('#validation-list', root).replaceChildren(
    ...errors.map((error) => {
      const item = tpl('tpl-error');
      variant(item, 'err', error.code);
      fill(item, { path: error.path, 'max-steps': MAX_SCORE_STEPS });
      return item;
    }),
  );
}

function renderDerived(root: HTMLElement, ctx: Ctx) {
  const { state } = ctx;
  const { decision, errors } = checkDraft(state.draft);
  fill(root, { 'q-count': state.draft.questions.length });
  renderValidation(root, errors);

  const parsedInput = InputSchema.safeParse(rawDecision(state.draft).input);
  const segments = parsedInput.success ? segmentInput(parsedInput.data) : [];
  $('#segments', root).replaceChildren(
    ...segments.map((segment) => {
      const item = tpl('tpl-segment');
      fill(item, { id: segment.id, text: segment.text });
      return item;
    }),
  );
  $('#schema-json', root).textContent = JSON.stringify(decision ?? state.draft, null, 2);

  const entries = state.entries.filter((entry) => state.enabled.has(entry.id));
  const cost = decision ? estimateRun(decision, entries, state.settings) : null;
  const calls = decision ? plannedCalls(decision, enabledModels(ctx), state.settings.samples) : 0;
  fill(root, {
    'planned-time': runDuration(calls, state.requestsPerMinute),
    'planned-calls': decision ? int(calls) : '—',
    'planned-models': entries.length,
    'planned-cost': cost ? costLabel(cost) : '—',
  });
  $('[data-needs-key]', root).hidden = canCall(state);
  variant(root, 'key-source', keySource(ctx));
  input('#k-key', root).placeholder = state.server?.keyHint ?? KEY_PLACEHOLDER;
  button('#run-btn', root).disabled = !canRun(ctx);
  for (const radio of $$('input[name="samples"]', root) as HTMLInputElement[]) {
    radio.checked = Number(radio.value) === state.settings.samples;
  }
  renderProgress(ctx);
}

export function render(ctx: Ctx, options: RenderOptions = {}) {
  const root = view();
  if (options.structure || !root.dataset.mounted) {
    root.dataset.mounted = '1';
    renderInputs(root, ctx);
    $('#q-list', root).replaceChildren(...ctx.state.draft.questions.map(renderQuestion));
    renderModels(root, ctx);
  }
  renderDerived(root, ctx);
}

export function renderProgress(ctx: Ctx) {
  const box = $('#run-progress', view());
  const running = ctx.state.running;
  box.hidden = !running;
  if (!running) return;
  ($('progress', box) as HTMLProgressElement).value = running.total ? running.done / running.total : 0;
  fill(box, { 'run-done': running.done, 'run-total': running.total });
}
