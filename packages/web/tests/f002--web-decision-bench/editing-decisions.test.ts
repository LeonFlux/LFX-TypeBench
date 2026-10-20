import { describe, expect, it } from 'vitest';
import { sampleDraft } from '../../src/data/sample.ts';
import { checkDraft, type Draft, formatJson, newQuestion, switchFormat } from '../../src/services/draft.ts';

function draftWith(changes: Partial<Draft>): Draft {
  return { ...structuredClone(sampleDraft), ...changes };
}

function codes(draft: Draft) {
  return checkDraft(draft).errors.map((error) => error.code);
}

function questionsWith(index: number, changes: Partial<Draft['questions'][number]>) {
  return sampleDraft.questions.map((question, position) =>
    position === index ? { ...question, ...changes } : question,
  );
}

describe('Golden', () => {
  it('turns the sample draft into a valid core decision', () => {
    expect(checkDraft(sampleDraft).decision?.questions.map((question) => question.type)).toEqual([
      'choice',
      'yes-no',
      'score',
    ]);
  });

  it('sends a JSON draft as parsed JSON', () => {
    const draft = draftWith({ input: { format: 'json', value: '{"plan":"Business"}' } });

    expect(checkDraft(draft).decision?.input).toEqual({ kind: 'json', json: { plan: 'Business' } });
  });

  it('keeps only the fields of the chosen question type', () => {
    const decision = checkDraft(sampleDraft).decision;

    expect(decision?.questions[1]).toEqual({
      id: 'escalate',
      type: 'yes-no',
      prompt: sampleDraft.questions[1]?.prompt,
    });
  });

  it('wraps text into a JSON body and back', () => {
    const json = switchFormat(sampleDraft.input, 'json');

    expect(switchFormat(json, 'text')).toEqual(sampleDraft.input);
  });

  it('names a new question with the next free id', () => {
    expect(newQuestion('choice', ['q1', 'q2', 'q4']).id).toBe('q5');
  });
});

describe('Edge', () => {
  it('keeps a JSON object intact through a text round trip', () => {
    const input = {
      format: 'json' as const,
      value: JSON.stringify({ amount: 1200, notes: 'Paid late once.' }, null, 2),
    };

    expect(switchFormat(switchFormat(input, 'text'), 'json')).toEqual(input);
  });

  it('pretty-prints JSON typed in text mode when switching to JSON', () => {
    const input = { format: 'text' as const, value: '{"amount":1200}' };

    expect(switchFormat(input, 'json').value).toBe(JSON.stringify({ amount: 1200 }, null, 2));
  });

  it('tidies valid JSON and leaves invalid JSON as typed', () => {
    expect([formatJson('{"a":1}'), formatJson('{"a":')]).toEqual([JSON.stringify({ a: 1 }, null, 2), '{"a":']);
  });

  it.each([
    ['a missing name', draftWith({ name: ' ' }), 'name-required'],
    ['an id that is not a slug', draftWith({ id: 'Ticket Triage' }), 'id-invalid'],
    ['an empty input', draftWith({ input: { format: 'text', value: '' } }), 'input-required'],
    ['invalid JSON', draftWith({ input: { format: 'json', value: '{"a":' } }), 'input-json-invalid'],
    ['no questions', draftWith({ questions: [] }), 'no-questions'],
    ['a blank prompt', draftWith({ questions: questionsWith(0, { prompt: '' }) }), 'prompt-required'],
    [
      'a choice with one option',
      draftWith({ questions: questionsWith(0, { options: ['Billing'] }) }),
      'choice-min-options',
    ],
    [
      'duplicate options',
      draftWith({ questions: questionsWith(0, { options: ['Bug', 'Bug'] }) }),
      'choice-duplicate-options',
    ],
    ['a blank option', draftWith({ questions: questionsWith(0, { options: ['Bug', ' '] }) }), 'option-blank'],
    ['an inverted score range', draftWith({ questions: questionsWith(2, { min: 5, max: 1 }) }), 'score-range-invalid'],
    ['duplicate question ids', draftWith({ questions: questionsWith(1, { id: 'category' }) }), 'question-id-duplicate'],
  ])('reports %s by code', (_, draft, code) => {
    expect(codes(draft)).toContain(code);
  });

  it('blocks the run while any error remains', () => {
    expect(checkDraft(draftWith({ name: '' })).decision).toBeNull();
  });

  it('keeps unparseable JSON as typed when switching back to text', () => {
    const input = { format: 'json' as const, value: '{"broken": ' };

    expect(switchFormat(input, 'text').value).toBe(input.value);
  });
});

describe('Adversarial', () => {
  it('reports an oversized input instead of sending it', () => {
    expect(codes(draftWith({ input: { format: 'text', value: 'x'.repeat(200_000) } }))).toContain('input-too-large');
  });
});
