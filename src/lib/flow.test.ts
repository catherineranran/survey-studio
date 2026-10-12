import { describe, expect, it } from 'vitest';
import { effectiveCtx, evalLogic, makeCtx, makePlan, nextStep, stepAtBlock } from './engine';
import {
  addArm,
  canMoveBlock,
  flowSteps,
  insertBlockAfter,
  makeParallel,
  moveBlock,
  moveIntoArm,
  moveIntoNewArm,
  moveStep,
  moveStepTo,
  moveToSequence,
  removeArm,
  removeBlock,
  renameArm,
  renameRandomizer,
  renameUrlParam,
  ungroup,
} from './flow';
import { lintSurvey } from './lint';
import { createQuestion } from './questionTypes';
import { blankSurvey, newBlock, normalizeSurvey } from './templates';
import type { Block, Survey } from './types';

/** A survey with blocks named A, B, C, … each holding one short-text question. */
function survey(...names: string[]): { s: Survey; b: Record<string, Block> } {
  const s = blankSurvey('s');
  s.blocks = [];
  const b: Record<string, Block> = {};
  for (const n of names) {
    const blk = newBlock(s, n);
    blk.questions.push({ ...createQuestion('short_text', s), variable: `q_${n.replace(/\W+/g, '_')}` });
    s.blocks.push(blk);
    b[n] = blk;
  }
  return { s, b };
}

const titles = (s: Survey) => s.blocks.map((x) => x.title).join(' ');
const shape = (s: Survey) =>
  flowSteps(s)
    .map((st) => (st.kind === 'block' ? st.block.title : `[${st.arms.map((a) => a.blocks.map((x) => x.title).join('+') || '∅').join(' | ')}]`))
    .join(' → ');

describe('flow structure', () => {
  it('dropping a block onto another makes them parallel branches', () => {
    const { s, b } = survey('Intro', 'AI', 'Vignette', 'Video', 'Questions');
    const r = makeParallel(s, b.Vignette.id, b.AI.id)!;
    expect(r.arms.map((a) => a.label)).toEqual(['AI', 'Vignette']);
    expect(shape(s)).toBe('Intro → [AI | Vignette] → Video → Questions');
    makeParallel(s, b.Video.id, b.AI.id);
    expect(shape(s)).toBe('Intro → [AI | Vignette | Video] → Questions');
    expect(s.randomizers).toHaveLength(1);
    expect(r.variable).toBe('condition');
  });

  it('a branch can hold several blocks in sequence', () => {
    const { s, b } = survey('Intro', 'AI', 'Check', 'Vignette', 'Questions');
    const r = makeParallel(s, b.Vignette.id, b.AI.id)!;
    moveIntoArm(s, b.Check.id, r.id, r.arms[0].id, 1);
    expect(shape(s)).toBe('Intro → [AI+Check | Vignette] → Questions');
    expect(titles(s)).toBe('Intro AI Check Vignette Questions');
    // The respondent who gets the first branch sees both of its blocks, then the shared questions.
    const plan = makePlan(s, 1, {}, { [r.id]: [r.arms[0].id] });
    expect(plan.blockOrder.map((id) => s.blocks.find((x) => x.id === id)!.title)).toEqual(['Intro', 'AI', 'Check', 'Questions']);
    expect(plan.assignments.condition).toBe('AI');
  });

  it('moves blocks back into the sequence, removes branches and ungroups', () => {
    const { s, b } = survey('Intro', 'AI', 'Vignette', 'Video', 'Questions');
    const r = makeParallel(s, b.Vignette.id, b.AI.id)!;
    makeParallel(s, b.Video.id, b.AI.id);
    moveToSequence(s, b.Video.id, 2); // before "Questions"
    expect(shape(s)).toBe('Intro → [AI | Vignette] → Video → Questions');
    expect(r.arms).toHaveLength(2); // the emptied "Video" branch went with its block
    removeArm(s, r.id, r.arms[1].id);
    expect(shape(s)).toBe('Intro → [AI] → Vignette → Video → Questions');
    ungroup(s, r.id);
    expect(shape(s)).toBe('Intro → AI → Vignette → Video → Questions');
    expect(s.randomizers).toHaveLength(0);
  });

  it('a randomizer disappears when its last block leaves', () => {
    const { s, b } = survey('Intro', 'AI', 'Vignette', 'Questions');
    makeParallel(s, b.Vignette.id, b.AI.id);
    moveToSequence(s, b.AI.id, 0);
    moveToSequence(s, b.Vignette.id, 1);
    expect(s.randomizers).toHaveLength(0);
    expect(shape(s)).toBe('AI → Vignette → Intro → Questions');
  });

  it('moves whole steps, and blocks within their branch', () => {
    const { s, b } = survey('Intro', 'AI', 'Check', 'Vignette', 'Questions');
    const r = makeParallel(s, b.Vignette.id, b.AI.id)!;
    moveIntoArm(s, b.Check.id, r.id, r.arms[0].id, 1);
    moveStep(s, 1, 1); // the randomizer moves below "Questions"
    expect(shape(s)).toBe('Intro → Questions → [AI+Check | Vignette]');
    expect(canMoveBlock(s, b.Check.id, -1)).toBe(true);
    expect(canMoveBlock(s, b.Vignette.id, 1)).toBe(false);
    moveBlock(s, b.Check.id, -1);
    expect(shape(s)).toBe('Intro → Questions → [Check+AI | Vignette]');
    moveBlock(s, b.Intro.id, 1);
    expect(shape(s)).toBe('Questions → Intro → [Check+AI | Vignette]');
  });

  it('adds new blocks in the right branch and cleans up when blocks are deleted', () => {
    const { s, b } = survey('Intro', 'AI', 'Vignette', 'Questions');
    const r = makeParallel(s, b.Vignette.id, b.AI.id)!;
    const extra = newBlock(s, 'Extra');
    insertBlockAfter(s, extra, b.AI.id);
    expect(shape(s)).toBe('Intro → [AI+Extra | Vignette] → Questions');
    const empty = addArm(s, r.id)!;
    expect(empty.label).toBe('Branch 3');
    b.Intro.branches.push({ id: 'br', logic: { match: 'all', conditions: [] }, target: b.Vignette.id });
    removeBlock(s, b.Vignette.id);
    expect(shape(s)).toBe('Intro → [AI+Extra | ∅] → Questions');
    expect(b.Intro.branches[0].target).toBe('end');
  });
});

describe('dragging in the flow', () => {
  it('moves a randomizer as a whole and gives a dropped block its own branch', () => {
    const { s, b } = survey('Intro', 'AI', 'Vignette', 'Questions', 'Video');
    const r = makeParallel(s, b.Vignette.id, b.AI.id)!;
    moveStepTo(s, 1, 3); // the randomizer goes below "Questions"
    expect(shape(s)).toBe('Intro → Questions → [AI | Vignette] → Video');
    moveStepTo(s, 2, 0);
    expect(shape(s)).toBe('[AI | Vignette] → Intro → Questions → Video');
    const arm = moveIntoNewArm(s, b.Video.id, r.id)!;
    expect(arm.label).toBe('Video');
    expect(shape(s)).toBe('[AI | Vignette | Video] → Intro → Questions');
  });
});

describe('renaming', () => {
  it('conditions follow a renamed randomizer and branch', () => {
    const { s, b } = survey('Intro', 'AI', 'Vignette', 'Questions');
    const r = makeParallel(s, b.Vignette.id, b.AI.id)!;
    const q = b.Questions.questions[0];
    q.displayLogic = { match: 'all', conditions: [{ id: 'c', source: 'param:condition', operator: 'is_not', value: 'Vignette' }] };
    const cond = () => q.displayLogic!.conditions[0];
    renameRandomizer(s, r.id, 'arm');
    expect(cond().source).toBe('param:arm');
    renameArm(s, r.id, r.arms[1].id, 'Text vignette');
    expect(cond().value).toBe('Text vignette');
    expect(lintSurvey(s).filter((i) => i.level === 'error')).toEqual([]);
    // Typing a name another branch already has doesn't drag that branch's conditions along.
    renameArm(s, r.id, r.arms[1].id, 'AI');
    expect(cond().value).toBe('Text vignette');
    expect(lintSurvey(s).some((i) => /no longer exists/.test(i.message))).toBe(true);
    renameArm(s, r.id, r.arms[1].id, 'A|B');
    expect(r.arms[1].label).toBe('A/B');
  });

  it('conditions follow a renamed URL parameter, unless the new name belongs to another field', () => {
    const { s, b } = survey('Intro', 'Questions');
    s.urlParams.push({ id: 'p1', name: 'pid', required: false }, { id: 'p2', name: 'src', required: false });
    const q = b.Questions.questions[0];
    q.displayLogic = { match: 'all', conditions: [{ id: 'c', source: 'param:pid', operator: 'answered' }] };
    renameUrlParam(s, 'p1', 'PROLIFIC_PID');
    expect(q.displayLogic.conditions[0].source).toBe('param:PROLIFIC_PID');
    renameUrlParam(s, 'p1', 'src');
    expect(q.displayLogic.conditions[0].source).toBe('param:PROLIFIC_PID');
  });
});

describe('older survey files', () => {
  it('ignores blocks an old randomizer listed that no longer exist, or that another randomizer has', () => {
    const { s, b } = survey('Intro', 'Gain', 'Loss', 'Outcome');
    const old = JSON.parse(JSON.stringify(s));
    old.randomizers = [
      { id: 'rz1', variable: 'condition', blockIds: [b.Gain.id, 'b_deleted', b.Loss.id], present: 1, balance: true },
      { id: 'rz2', variable: 'other', blockIds: [b.Loss.id, 'b_gone'], present: 1, balance: true },
    ];
    delete old.blocks[3].title;
    const n = normalizeSurvey(old, 's');
    expect(n.randomizers.map((r) => [r.variable, r.arms.map((a) => a.label)])).toEqual([['condition', ['Gain', 'Loss']]]);
    expect(n.blocks[3].title).toBe('Block');
    for (let seed = 1; seed < 50; seed++) expect(['Gain', 'Loss']).toContain(makePlan(n, seed).assignments.condition);
  });

  it('keeps a branch left empty on purpose', () => {
    const { s, b } = survey('Intro', 'AI', 'Text');
    const r = makeParallel(s, b.Text.id, b.AI.id)!;
    addArm(s, r.id, 'Control');
    const n = normalizeSurvey(JSON.parse(JSON.stringify(s)), 's');
    expect(n.randomizers[0].arms.map((a) => a.label)).toEqual(['AI', 'Text', 'Control']);
  });

  it('turns single-block randomizers into labelled branches and groups their blocks', () => {
    const { s, b } = survey('Intro', 'Gain', 'Middle', 'Loss', 'Outcome');
    const old = JSON.parse(JSON.stringify(s));
    old.randomizers = [{ id: 'rz1', variable: 'condition', blockIds: [b.Gain.id, b.Loss.id], present: 1, balance: true }];
    const n = normalizeSurvey(old, 's');
    expect(n.randomizers[0].arms.map((a) => [a.label, a.blockIds.length])).toEqual([
      ['Gain', 1],
      ['Loss', 1],
    ]);
    expect(n.randomizers[0].blockIds).toBeUndefined();
    // Both condition blocks now sit together, where the randomizer runs.
    expect(shape(n)).toBe('Intro → [Gain | Loss] → Middle → Outcome');
    // Recorded values are unchanged, so existing data and balancing carry on.
    const plan = makePlan(n, 3, { condition: { Gain: 5, Loss: 2 } });
    expect(plan.assignments.condition).toBe('Loss');
  });
});

describe('branches at run time', () => {
  function threeConditions() {
    const { s, b } = survey('Consent', 'AI video', 'Vignette', 'Real video', 'Questions', 'Demographics');
    const r = makeParallel(s, b.Vignette.id, b['AI video'].id)!;
    makeParallel(s, b['Real video'].id, b['AI video'].id);
    return { s, b, r };
  }

  it('gives each branch about equally often and records its name', () => {
    const { s, r } = threeConditions();
    const seen: Record<string, number> = {};
    for (let seed = 1; seed <= 300; seed++) {
      const plan = makePlan(s, seed);
      seen[plan.assignments[r.variable]] = (seen[plan.assignments[r.variable]] ?? 0) + 1;
      expect(plan.blockOrder).toHaveLength(4);
    }
    expect(Object.keys(seen).sort()).toEqual(['AI video', 'Real video', 'Vignette']);
    for (const n of Object.values(seen)) expect(n).toBeGreaterThan(60);
  });

  it('skips items for one branch with display logic on the condition', () => {
    const { s, b, r } = threeConditions();
    const q = b.Questions.questions[0];
    q.displayLogic = { match: 'all', conditions: [{ id: 'c', source: `param:${r.variable}`, operator: 'is_not', value: 'Vignette' }] };
    const vignette = makeCtx(s, {}, { [r.variable]: 'Vignette' });
    const video = makeCtx(s, {}, { [r.variable]: 'AI video' });
    expect(evalLogic(q.displayLogic, vignette)).toBe(false);
    expect(evalLogic(q.displayLogic, video)).toBe(true);
    expect(lintSurvey(s).filter((i) => i.level === 'error')).toEqual([]);
    // Renaming the branch breaks the condition, and the checker says so.
    r.arms[1].label = 'Text vignette';
    expect(lintSurvey(s).some((i) => /branch of “condition” that no longer exists/.test(i.message))).toBe(true);
  });

  it('handles branches given together (present > 1) in logic', () => {
    const { s, r } = threeConditions();
    r.present = 2;
    const ctx = makeCtx(s, {}, { [r.variable]: 'AI video|Vignette' });
    const cond = (operator: 'includes' | 'excludes', value: string) => evalLogic({ match: 'all', conditions: [{ id: 'c', source: `param:${r.variable}`, operator, value }] }, ctx);
    expect(cond('includes', 'Vignette')).toBe(true);
    expect(cond('excludes', 'Real video')).toBe(true);
    expect(cond('includes', 'Real video')).toBe(false);
  });

  it('a skip rule into a randomizer goes to the branch the respondent got', () => {
    const { s, b, r } = threeConditions();
    const consent = b.Consent;
    consent.branches.push({ id: 'br', logic: { match: 'all', conditions: [] }, target: b['AI video'].id });
    const plan = makePlan(s, 1, {}, { [r.id]: [r.arms[1].id] }); // Vignette
    const step = nextStep(plan, makeCtx(s), { block: 0, page: 0 });
    expect(step).toEqual({ kind: 'page', pos: { block: 1, page: 0 } });
    expect(plan.blockOrder[1]).toBe(b.Vignette.id);
  });
});

describe('skip rules and randomizers', () => {
  it('a jump into a randomizer goes to its start for everyone, including an empty branch', () => {
    const { s, b } = survey('Consent', 'Screen', 'Extra', 'Video', 'Text', 'Questions');
    const r = makeParallel(s, b.Text.id, b.Video.id)!;
    const control = addArm(s, r.id, 'Control')!;
    b.Consent.branches.push({ id: 'br', logic: { match: 'all', conditions: [] }, target: b.Video.id });
    const path = (armId: string, present = 1) => {
      r.present = present;
      const plan = makePlan(s, 3, {}, { [r.id]: [armId] });
      const ctx = makeCtx(s, {}, plan.assignments);
      const seen: string[] = [];
      for (let st = nextStep(plan, ctx, { block: 0, page: 0 }); st.kind === 'page'; st = nextStep(plan, ctx, st.pos)) seen.push(s.blocks.find((x) => x.id === plan.blockOrder[st.pos.block])!.title);
      return seen.join(' ');
    };
    expect(path(r.arms[0].id)).toBe('Video Questions');
    expect(path(r.arms[1].id)).toBe('Text Questions');
    expect(path(control.id)).toBe('Questions');
    // Given two branches, the jump still lands on the first one shown.
    expect(path(r.arms[1].id, 2)).toMatch(/^Text (Video )?Questions$/);
  });

  it('jumps within a branch still work, and odd targets are flagged', () => {
    const { s, b } = survey('Intro', 'AI', 'Check', 'Extra', 'Text', 'Questions');
    const r = makeParallel(s, b.Text.id, b.AI.id)!;
    moveIntoArm(s, b.Check.id, r.id, r.arms[0].id, 1);
    moveIntoArm(s, b.Extra.id, r.id, r.arms[0].id, 2);
    b.AI.branches.push({ id: 'br', logic: { match: 'all', conditions: [] }, target: b.Extra.id });
    const plan = makePlan(s, 1, {}, { [r.id]: [r.arms[0].id] });
    const ctx = makeCtx(s, {}, plan.assignments);
    const step = nextStep(plan, ctx, { block: 1, page: 0 }); // from "AI"
    expect(step.kind === 'page' && plan.blockOrder[step.pos.block]).toBe(b.Extra.id);
    expect(lintSurvey(s).filter((i) => /skip rule/.test(i.message))).toEqual([]);
    b.Intro.branches.push({ id: 'br2', logic: { match: 'all', conditions: [] }, target: b.Check.id });
    expect(lintSurvey(s).some((i) => /inside randomizer “condition”/.test(i.message))).toBe(true);
    b.Text.branches.push({ id: 'br3', logic: { match: 'all', conditions: [] }, target: b.Questions.id });
    b.AI.branches[0].target = b.Text.id;
    expect(lintSurvey(s).some((i) => /jumps backwards|another branch/.test(i.message))).toBe(true);
  });

  it('“is” on a randomizer means “got this branch”, also when people get several', () => {
    const { s, b } = survey('Intro', 'AI', 'Text', 'Video', 'Questions');
    const r = makeParallel(s, b.Text.id, b.AI.id)!;
    makeParallel(s, b.Video.id, b.AI.id);
    r.present = 2;
    const is = (operator: 'is' | 'is_not', value: string, got: string) =>
      evalLogic({ match: 'all', conditions: [{ id: 'c', source: 'param:condition', operator, value }] }, makeCtx(s, {}, { condition: got }));
    expect(is('is', 'Video', 'Text|Video')).toBe(true);
    expect(is('is', 'AI', 'Text|Video')).toBe(false);
    expect(is('is_not', 'Text', 'Text|Video')).toBe(false);
    expect(is('is_not', 'AI', 'Text|Video')).toBe(true);
    expect(is('is', 'Video', 'Video')).toBe(true);
  });
});

describe('preview helpers', () => {
  it('starts at any block, shows it even when its display logic says no', () => {
    const { s, b } = survey('Intro', 'Middle', 'End');
    b.Middle.displayLogic = { match: 'all', conditions: [{ id: 'c', source: b.Intro.questions[0].id, operator: 'answered' }] };
    const plan = makePlan(s, 1);
    const ctx = { ...makeCtx(s), forceVisible: [b.Middle.id] };
    const step = stepAtBlock(plan, ctx, b.Middle.id);
    expect(step).toEqual({ kind: 'page', pos: { block: 1, page: 0 } });
    // Answers given there count for logic and storage.
    const answered = { ...ctx, answers: { [b.Middle.questions[0].id]: 'hello' } };
    expect(effectiveCtx(plan, answered, [{ block: 1, page: 0 }]).answers[b.Middle.questions[0].id]).toBe('hello');
    expect(nextStep(plan, answered, { block: 1, page: 0 })).toEqual({ kind: 'page', pos: { block: 2, page: 0 } });
  });
});
