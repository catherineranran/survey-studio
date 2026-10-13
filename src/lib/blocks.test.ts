import { describe, expect, it } from 'vitest';
import { blockContents, blockPages, blockResponses, followBlock, setBlockResponses } from './blocks';
import { createQuestion } from './questionTypes';
import { blankSurvey, newBlock, normalizeSurvey } from './templates';
import type { QuestionType } from './types';

function block(...types: QuestionType[]) {
  const s = blankSurvey('s');
  const b = newBlock(s, 'Measures');
  for (const t of types) b.questions.push(createQuestion(t, s));
  return { s, b };
}

describe('block contents', () => {
  it('counts questions and texts, not page breaks', () => {
    expect(blockContents(block().b)).toBe('Empty');
    expect(blockContents(block('text_block').b)).toBe('1 text');
    expect(blockContents(block('text_block', 'single_choice').b)).toBe('1 question, 1 text');
    expect(blockContents(block('text_block', 'matrix', 'page_break', 'video', 'single_choice').b)).toBe('3 questions, 1 text');
  });

  it('counts pages the way the survey shows them', () => {
    expect(blockPages(block('single_choice', 'single_choice').b)).toBe(1);
    expect(blockPages(block('single_choice', 'page_break', 'single_choice').b)).toBe(2);
    // Breaks at the edges or in a row add no empty pages.
    expect(blockPages(block('page_break', 'single_choice', 'page_break', 'page_break', 'text_block', 'page_break').b)).toBe(2);
    expect(blockPages(block().b)).toBe(1);
    const each = block('single_choice', 'page_break', 'single_choice').b;
    each.pageMode = 'each';
    expect(blockPages(each)).toBeNull();
  });
});

describe('forced response or optional', () => {
  it('is only what the block was set to, never guessed from its questions', () => {
    const { b } = block('consent', 'text_block', 'single_choice', 'video');
    // A fresh block: the video is required by default, the choice question isn't. Nothing was chosen.
    expect(blockResponses(b)).toBeNull();
    expect(blockResponses(block('video').b)).toBeNull();
  });

  it('sets every question at once, leaving consent required', () => {
    const { b } = block('consent', 'single_choice', 'video', 'text_block');
    setBlockResponses(b, 'forced');
    expect(blockResponses(b)).toBe('forced');
    expect(b.questions.map((q) => q.required)).toEqual([true, true, true, false]);
    setBlockResponses(b, 'optional');
    expect(blockResponses(b)).toBe('optional');
    expect(b.questions.map((q) => q.required)).toEqual([true, false, false, false]);
    setBlockResponses(b, null);
    expect(b.responses).toBeUndefined();
    expect(b.questions.map((q) => q.required)).toEqual([true, false, false, false]);
  });

  it('lets single questions differ, and then each question decides', () => {
    const { b } = block('single_choice', 'matrix');
    setBlockResponses(b, 'forced');
    b.questions[1].required = false;
    expect(blockResponses(b)).toBeNull();
  });

  it('new questions follow a chosen block, and keep their own default otherwise', () => {
    const { s, b } = block('single_choice', 'matrix');
    expect(followBlock(createQuestion('video', s), b).required).toBe(true);
    expect(followBlock(createQuestion('short_text', s), b).required).toBe(false);
    setBlockResponses(b, 'forced');
    expect(followBlock(createQuestion('short_text', s), b).required).toBe(true);
    setBlockResponses(b, 'optional');
    expect(followBlock(createQuestion('video', s), b).required).toBe(false);
    expect(followBlock(createQuestion('consent', s), b).required).toBe(true);
    expect(followBlock(createQuestion('page_break', s), b).required).toBe(false);
  });

  it('survives saving and loading, and ignores anything else in a file', () => {
    const { s, b } = block('single_choice');
    s.blocks = [b];
    setBlockResponses(b, 'forced');
    expect(normalizeSurvey(JSON.parse(JSON.stringify(s)), 's').blocks[0].responses).toBe('forced');
    const odd = JSON.parse(JSON.stringify(s));
    odd.blocks[0].responses = 'sometimes';
    expect(normalizeSurvey(odd, 's').blocks[0].responses).toBeUndefined();
  });
});
