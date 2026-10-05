import { describe, expect, it } from 'vitest';
import {
  evalLogic,
  finalizeAnswers,
  firstStep,
  makeCtx,
  makePlan,
  mulberry32,
  nextStep,
  pagesForBlock,
  pipe,
  pipeUrl,
  remainingPages,
  shuffle,
  toNumber,
  validateAnswer,
  type Position,
} from './engine';
import { createQuestion } from './questionTypes';
import { TEMPLATES, blankSurvey, newBlock } from './templates';
import type { Question, Survey } from './types';

const build = (id: string) => TEMPLATES.find((t) => t.id === id)!.build('s1');
const qByVar = (s: Survey, v: string) => s.blocks.flatMap((b) => b.questions).find((q) => q.variable === v)!;

describe('random', () => {
  it('is deterministic for a seed', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
  it('shuffle returns a permutation', () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8];
    const out = shuffle(items, mulberry32(7));
    expect([...out].sort()).toEqual(items);
    expect(items).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});

describe('makePlan', () => {
  it('assigns exactly one condition block and records it', () => {
    const s = build('experiment');
    const seen = new Set<string>();
    for (let seed = 1; seed < 40; seed++) {
      const plan = makePlan(s, seed);
      const titles = plan.blockOrder.map((id) => s.blocks.find((b) => b.id === id)!.title);
      expect(titles[0]).toBe('Consent');
      expect(titles.at(-1)).toBe('Outcome');
      expect(titles).toHaveLength(3);
      expect(['Gain frame', 'Loss frame']).toContain(titles[1]);
      expect(plan.assignments.condition).toBe(titles[1]);
      seen.add(titles[1]);
    }
    expect(seen.size).toBe(2);
  });

  it('balanced assignment gives the least-used condition', () => {
    const s = build('experiment');
    for (let seed = 1; seed < 20; seed++) {
      const plan = makePlan(s, seed, { condition: { 'Gain frame': 12, 'Loss frame': 9 } });
      expect(plan.assignments.condition).toBe('Loss frame');
    }
  });

  it('keeps text blocks fixed when shuffling questions', () => {
    const s = blankSurvey('s');
    const b = s.blocks[0];
    const text = createQuestion('text_block', s);
    b.questions = [text, createQuestion('short_text', s), createQuestion('number', s), createQuestion('date', s)];
    b.randomizeQuestions = true;
    for (let seed = 1; seed < 15; seed++) {
      const plan = makePlan(s, seed);
      expect(plan.questionOrder[b.id][0]).toBe(text.id);
      expect(new Set(plan.questionOrder[b.id])).toEqual(new Set(b.questions.map((q) => q.id)));
    }
  });

  it('anchors "other" and exclusive options at the end when shuffling', () => {
    const s = build('study');
    const devices = qByVar(s, 'devices');
    devices.randomizeChoices = true;
    const none = devices.choices!.find((c) => c.exclusive)!;
    for (let seed = 1; seed < 15; seed++) {
      expect(makePlan(s, seed).choiceOrder[devices.id].at(-1)).toBe(none.id);
    }
  });
});

describe('logic', () => {
  const s = build('study');
  const age = qByVar(s, 'age');
  const gender = qByVar(s, 'gender');
  const devices = qByVar(s, 'devices');
  const att = qByVar(s, 'att');

  it('handles choice, number, multi, matrix and parameter conditions', () => {
    const ctx = makeCtx(
      s,
      {
        [age.id]: '34',
        [gender.id]: gender.choices![1].id,
        [devices.id]: [devices.choices![0].id, devices.choices![1].id],
        [att.id]: { [att.rows![0].id]: att.columns![3].id },
      },
      { PROLIFIC_PID: 'abc' },
    );
    const L = (c: object) => evalLogic({ match: 'all', conditions: [{ id: 'x', ...c } as never] }, ctx);
    expect(L({ source: age.id, operator: 'gte', value: 18 })).toBe(true);
    expect(L({ source: age.id, operator: 'lt', value: 30 })).toBe(false);
    expect(L({ source: gender.id, operator: 'is', value: gender.choices![1].id })).toBe(true);
    expect(L({ source: gender.id, operator: 'is_not', value: gender.choices![1].id })).toBe(false);
    expect(L({ source: devices.id, operator: 'includes', value: devices.choices![1].id })).toBe(true);
    expect(L({ source: devices.id, operator: 'excludes', value: devices.choices![2].id })).toBe(true);
    // Matrix rows compare by the column's code (Agree = 4).
    expect(L({ source: att.id, rowId: att.rows![0].id, operator: 'gte', value: 4 })).toBe(true);
    expect(L({ source: att.id, rowId: att.rows![1].id, operator: 'answered' })).toBe(false);
    expect(L({ source: 'param:PROLIFIC_PID', operator: 'answered' })).toBe(true);
    expect(L({ source: 'param:STUDY_ID', operator: 'answered' })).toBe(false);
  });

  it('treats missing answers as not matching numeric comparisons', () => {
    const ctx = makeCtx(s, {});
    expect(evalLogic({ match: 'all', conditions: [{ id: 'x', source: age.id, operator: 'lt', value: 100 }] }, ctx)).toBe(false);
    expect(evalLogic({ match: 'any', conditions: [] }, ctx)).toBe(true);
  });

  it('parses decimal commas', () => {
    expect(toNumber('3,5')).toBe(3.5);
    expect(toNumber(' 12 ')).toBe(12);
    expect(toNumber('12abc')).toBeNull();
  });
});

describe('navigation', () => {
  it('ends with declined_consent when consent is declined', () => {
    const s = build('study');
    const plan = makePlan(s, 1);
    const consent = s.blocks[0].questions[0];
    const ctx = makeCtx(s, { [consent.id]: consent.choices![1].id });
    const first = firstStep(plan, ctx);
    expect(first.kind).toBe('page');
    const next = nextStep(plan, ctx, (first as { pos: Position }).pos);
    expect(next).toMatchObject({ kind: 'end', status: 'declined_consent' });
  });

  it('walks every block when consent is given', () => {
    const s = build('study');
    const plan = makePlan(s, 1);
    const consent = s.blocks[0].questions[0];
    const ctx = makeCtx(s, { [consent.id]: consent.choices![0].id });
    let step = firstStep(plan, ctx);
    const visited: string[] = [];
    while (step.kind === 'page') {
      visited.push(plan.blockOrder[step.pos.block]);
      step = nextStep(plan, ctx, step.pos);
    }
    expect(visited).toEqual(s.blocks.map((b) => b.id));
    expect(step).toMatchObject({ kind: 'end', status: 'complete' });
  });

  it('applies skip logic with an end tag', () => {
    const s = build('experiment');
    const plan = makePlan(s, 3);
    const attention = qByVar(s, 'attention');
    const outcomeIndex = plan.blockOrder.length - 1;
    const pass = makeCtx(s, { [attention.id]: attention.choices![2].id });
    const fail = makeCtx(s, { [attention.id]: attention.choices![0].id });
    expect(nextStep(plan, pass, { block: outcomeIndex, page: 0 })).toMatchObject({ kind: 'end', status: 'complete' });
    expect(nextStep(plan, fail, { block: outcomeIndex, page: 0 })).toMatchObject({ kind: 'end', status: 'failed_attention' });
  });

  it('jumps forward to a target block and skips pages with no visible questions', () => {
    const s = blankSurvey('s');
    const b1 = s.blocks[0];
    const b2 = newBlock(s, 'Skipped');
    const b3 = newBlock(s, 'Target');
    const hidden = createQuestion('short_text', s);
    b2.questions.push(createQuestion('short_text', s));
    b3.questions.push(createQuestion('short_text', s));
    s.blocks.push(b2, b3);
    const choice = b1.questions[0];
    b1.branches.push({ id: 'br', logic: { match: 'all', conditions: [{ id: 'c', source: choice.id, operator: 'is', value: choice.choices![0].id }] }, target: b3.id });
    // A page whose only question is hidden is skipped entirely.
    hidden.displayLogic = { match: 'all', conditions: [{ id: 'c2', source: choice.id, operator: 'is', value: 'nope' }] };
    b3.questions.unshift(hidden);
    b3.pageMode = 'each';
    const plan = makePlan(s, 1);
    const ctx = makeCtx(s, { [choice.id]: choice.choices![0].id });
    const step = nextStep(plan, ctx, { block: 0, page: 0 });
    expect(step).toEqual({ kind: 'page', pos: { block: 2, page: 1 } });
    expect(pagesForBlock(b3, plan)).toHaveLength(2);
    expect(remainingPages(plan, ctx, { block: 0, page: 0 })).toBe(1);
  });

  it('shows follow-up questions depending on an NPS score', () => {
    const s = build('feedback');
    const nps = qByVar(s, 'nps');
    const improve = qByVar(s, 'improve');
    const love = qByVar(s, 'love');
    const low = makeCtx(s, { [nps.id]: 3 });
    const high = makeCtx(s, { [nps.id]: 10 });
    expect(evalLogic(improve.displayLogic, low)).toBe(true);
    expect(evalLogic(love.displayLogic, low)).toBe(false);
    expect(evalLogic(improve.displayLogic, high)).toBe(false);
    expect(evalLogic(love.displayLogic, high)).toBe(true);
  });
});

describe('validation', () => {
  const s = blankSurvey('s');
  const make = (type: Question['type'], extra: Partial<Question> = {}) => ({ ...createQuestion(type, s), ...extra });

  it('checks required answers and formats', () => {
    const email = make('short_text', { required: true, validation: { format: 'email' } });
    expect(validateAnswer(email, '', undefined, 'en')).toMatch(/needs an answer/);
    expect(validateAnswer(email, 'nope', undefined, 'en')).toMatch(/email/);
    expect(validateAnswer(email, 'a@b.org', undefined, 'en')).toBeNull();
    expect(validateAnswer(email, '', undefined, 'de')).toMatch(/beantworten/);
  });

  it('checks numbers', () => {
    const n = make('number', { validation: { min: 18, max: 99, integer: true } });
    expect(validateAnswer(n, '', undefined, 'en')).toBeNull();
    expect(validateAnswer(n, 'abc', undefined, 'en')).toMatch(/number/);
    expect(validateAnswer(n, '20,5', undefined, 'en')).toMatch(/whole/);
    expect(validateAnswer(n, '17', undefined, 'en')).toMatch(/at least 18/);
    expect(validateAnswer(n, '40', undefined, 'en')).toBeNull();
  });

  it('checks selections and "other" text', () => {
    const m = make('multi_choice', { validation: { minSelected: 2 } });
    m.choices![2].other = true;
    expect(validateAnswer(m, [m.choices![0].id], undefined, 'en')).toMatch(/at least 2/);
    expect(validateAnswer(m, [m.choices![0].id, m.choices![2].id], '', 'en')).toMatch(/specify/);
    expect(validateAnswer(m, [m.choices![0].id, m.choices![2].id], 'Mine', 'en')).toBeNull();
  });

  it('checks matrices and constant sums', () => {
    const mx = make('matrix', { required: true });
    const partial = { [mx.rows![0].id]: mx.columns![0].id };
    expect(validateAnswer(mx, partial, undefined, 'en')).toMatch(/every row/);
    const cs = make('constant_sum', { required: true });
    const [a, b, c] = cs.choices!;
    expect(validateAnswer(cs, { [a.id]: 50, [b.id]: 30 }, undefined, 'en')).toMatch(/add up to 100/);
    expect(validateAnswer(cs, { [a.id]: 50, [b.id]: 30, [c.id]: '20' }, undefined, 'en')).toBeNull();
  });

  it('applies regex patterns', () => {
    const code = make('short_text', { validation: { format: 'regex', pattern: '^[A-Z]{2}\\d{3}$', message: 'Use two letters and three digits.' } });
    expect(validateAnswer(code, 'ab123', undefined, 'en')).toBe('Use two letters and three digits.');
    expect(validateAnswer(code, 'AB123', undefined, 'en')).toBeNull();
  });
});

describe('piping', () => {
  it('inserts answers, parameters and assignments', () => {
    const s = build('experiment');
    const support = qByVar(s, 'support');
    const ctx = makeCtx(s, { [support.id]: 6 }, { PROLIFIC_PID: 'p 1', condition: 'Loss frame' });
    expect(pipe('You said: {{support}} ({{condition}})', ctx)).toBe('You said: Support (Loss frame)');
    expect(pipe('{{unknown}}!', ctx)).toBe('!');
    expect(pipeUrl('https://x.org/?pid={{PROLIFIC_PID}}&r={{response_id}}', ctx, { response_id: 'r/1' })).toBe(
      'https://x.org/?pid=p%201&r=r%2F1',
    );
  });
});

describe('finalizeAnswers', () => {
  it('drops answers to questions that ended up hidden or unvisited', () => {
    const s = build('feedback');
    const nps = qByVar(s, 'nps');
    const improve = qByVar(s, 'improve');
    const love = qByVar(s, 'love');
    const plan = makePlan(s, 1);
    // The respondent first answered 3 and wrote an improvement, then went back and changed to 10.
    const ctx = makeCtx(s, { [nps.id]: 10, [improve.id]: 'faster', [love.id]: 'people' });
    const out = finalizeAnswers(plan, ctx, [{ block: 0, page: 0 }]);
    expect(out.answers[nps.id]).toBe(10);
    expect(out.answers[love.id]).toBe('people');
    expect(out.answers[improve.id]).toBeUndefined();
  });

  it('stores numbers as numbers and keeps "other" text only when selected', () => {
    const s = build('study');
    const age = qByVar(s, 'age');
    const gender = qByVar(s, 'gender');
    const other = gender.choices!.find((c) => c.other)!;
    const plan = makePlan(s, 1);
    const ctx = makeCtx(s, { [age.id]: '41', [gender.id]: other.id }, {}, { [gender.id]: '  agender ' });
    const out = finalizeAnswers(plan, ctx, [{ block: 1, page: 0 }]);
    expect(out.answers[age.id]).toBe(41);
    expect(out.otherText[gender.id]).toBe('agender');
  });
});
