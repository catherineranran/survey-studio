import { describe, expect, it } from 'vitest';
import { lintSurvey } from './lint';
import { createQuestion } from './questionTypes';
import { blankSurvey } from './templates';

describe('survey checker and page breaks', () => {
  const consentWarning = (s: ReturnType<typeof blankSurvey>) => lintSurvey(s).some((i) => /consent on the same page/.test(i.message));

  it('accepts consent on its own page, split off by a page break', () => {
    const s = blankSurvey('l1');
    const b = s.blocks[0];
    b.questions.unshift(createQuestion('consent', s));
    expect(consentWarning(s)).toBe(true);
    b.questions.splice(1, 0, createQuestion('page_break', s));
    expect(consentWarning(s)).toBe(false);
    // Shuffling could still bring a question onto consent's page.
    b.randomizeQuestions = true;
    expect(consentWarning(s)).toBe(true);
  });

  it('calls a block holding only page breaks empty', () => {
    const s = blankSurvey('l2');
    s.blocks.push({ ...s.blocks[0], id: 'b2', title: 'Only breaks', questions: [createQuestion('page_break', s)] });
    expect(lintSurvey(s).some((i) => i.message === 'Block “Only breaks” is empty.')).toBe(true);
  });
});
