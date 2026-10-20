import { describe, expect, it } from 'vitest';
import { defaultDrafts, goldSets } from '../../src/data/sample.ts';
import type { Draft } from '../../src/services/draft.ts';
import type { Ctx } from '../../src/state.ts';
import { labeledQuestions } from '../../src/views/calibrate-view.ts';

const [ticket, loan, moderation] = defaultDrafts() as [Draft, Draft, Draft];
const questionsOf = (draft: Draft) => labeledQuestions({ state: { draft }, gold: goldSets() } as unknown as Ctx);
const ids = (draft: Draft) => questionsOf(draft).map((question) => question.id);

describe('Golden', () => {
  it('offers every question of each default decision for calibration', () => {
    expect(ids(ticket)).toEqual(['category', 'escalate', 'urgency']);
    expect(ids(loan)).toEqual(['risk', 'approve', 'repayment']);
    expect(ids(moderation)).toEqual(['sentiment', 'sarcastic', 'manipulation', 'usefulness']);
  });
});

describe('Edge', () => {
  it('offers nothing for a decision without known answers', () => {
    expect(ids({ ...ticket, id: 'my-decision' })).toEqual([]);
  });
});

describe('Adversarial', () => {
  it('drops a question whose known answers no longer fit its options', () => {
    const edited: Draft = {
      ...ticket,
      questions: ticket.questions.map((question) =>
        question.id === 'category' ? { ...question, options: ['Sales', 'Other'] } : question,
      ),
    };

    expect(ids(edited)).toEqual(['escalate', 'urgency']);
  });
});
