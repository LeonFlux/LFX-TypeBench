import { segmentInput } from '@typed-decisions/core';
import { describe, expect, it } from 'vitest';
import { defaultDrafts } from '../../src/data/sample.ts';
import {
  addDecision,
  missingDefaults,
  removeDecision,
  restoreDefaults,
  selectDecision,
  summaryOf,
  type Workspace,
  workspaceOf,
} from '../../src/services/decisions.ts';
import { checkDraft } from '../../src/services/draft.ts';

function workspace(): Workspace {
  return workspaceOf(defaultDrafts());
}

function keys(state: Workspace) {
  return state.drafts.map((draft) => draft.key);
}

describe('Golden', () => {
  it('ships three valid default decisions', () => {
    expect(defaultDrafts().map((draft) => checkDraft(draft).errors)).toEqual([[], [], []]);
  });

  it('selects the first decision by default', () => {
    const state = workspace();

    expect(state.activeKey).toBe(state.drafts[0]?.key);
  });

  it('summarizes a decision by name, number of questions, and version', () => {
    const [first] = defaultDrafts();

    expect(first && summaryOf(first)).toEqual({
      name: first?.name,
      questions: first?.questions.length,
      version: first?.version,
    });
  });

  it('selects another decision', () => {
    const state = workspace();
    const second = state.drafts[1]?.key ?? '';

    expect(selectDecision(state, second).activeKey).toBe(second);
  });

  it('adds a blank decision with one question and selects it', () => {
    const state = addDecision(workspace());
    const added = state.drafts.at(-1);

    expect({ active: state.activeKey, questions: added?.questions.length }).toEqual({
      active: added?.key,
      questions: 1,
    });
  });

  it('gives a JSON default with sentences and numbers segments for both', () => {
    const loanDraft = defaultDrafts().find((draft) => draft.input.format === 'json');
    const loan = loanDraft ? checkDraft(loanDraft).decision : null;
    const ids = loan ? segmentInput(loan.input).map((segment) => segment.id) : [];

    expect({ sentences: ids.some((id) => id.startsWith('s')), keys: ids.some((id) => id.startsWith('key:')) }).toEqual({
      sentences: true,
      keys: true,
    });
  });
});

it('restores removed default decisions without touching the others', () => {
  const state = workspace();
  const [, second] = state.drafts;
  const trimmed = removeDecision(state, second?.key ?? '');

  const restored = restoreDefaults(trimmed, defaultDrafts());

  expect(restored.drafts.map((draft) => draft.id)).toEqual([...trimmed.drafts.map((draft) => draft.id), second?.id]);
});

it('keeps the selected decision when restoring defaults', () => {
  const trimmed = removeDecision(workspace(), workspace().drafts[1]?.key ?? '');

  expect(restoreDefaults(trimmed, defaultDrafts()).activeKey).toBe(trimmed.activeKey);
});

describe('Edge', () => {
  it('has nothing to restore while every default is present', () => {
    expect(missingDefaults(workspace(), defaultDrafts())).toEqual([]);
  });

  it('does not duplicate a default that is still listed', () => {
    const state = workspace();

    expect(restoreDefaults(state, defaultDrafts()).drafts).toHaveLength(state.drafts.length);
  });

  it('removes a decision', () => {
    const state = workspace();
    const second = state.drafts[1]?.key ?? '';

    expect(keys(removeDecision(state, second))).not.toContain(second);
  });

  it('selects the next decision when the selected one is removed', () => {
    const state = workspace();
    const [first, second] = keys(state);

    expect(removeDecision(state, first ?? '').activeKey).toBe(second);
  });

  it('replaces the last removed decision with a new blank one', () => {
    const single = workspaceOf(defaultDrafts().slice(0, 1));
    const removed = single.activeKey;

    const state = removeDecision(single, removed);

    expect({
      count: state.drafts.length,
      replaced: state.activeKey !== removed,
      input: state.drafts[0]?.input.value,
    }).toEqual({
      count: 1,
      replaced: true,
      input: '',
    });
  });

  it('gives every decision a distinct key', () => {
    const state = addDecision(addDecision(workspace()));

    expect(new Set(keys(state)).size).toBe(state.drafts.length);
  });

  it('ignores selecting a key that does not exist', () => {
    const state = workspace();

    expect(selectDecision(state, 'missing').activeKey).toBe(state.activeKey);
  });
});
