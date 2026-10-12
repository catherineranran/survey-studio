// The survey as a flow: steps in sequence, where a step is either a block or a
// randomizer whose branches run in parallel (each respondent gets one branch).
//
// survey.blocks keeps every block in flow order, and a randomizer runs where its
// first block sits. All structural edits go through these functions, which keep
// that true. They mutate the survey they are given (a draft in the builder).

import { allVariables, uid } from './ids';
import type { Block, Condition, Randomizer, RandomizerArm, Survey } from './types';

export type FlowStep =
  | { kind: 'block'; block: Block }
  | { kind: 'randomizer'; randomizer: Randomizer; arms: { arm: RandomizerArm; blocks: Block[] }[] };

/** Where a block sits inside a randomizer, or null for the top-level sequence. */
export interface ArmPlace {
  randomizer: Randomizer;
  arm: RandomizerArm;
  index: number;
}

type Item = { type: 'block'; id: string } | { type: 'rand'; id: string };

export function placeOf(survey: Survey, blockId: string): ArmPlace | null {
  for (const randomizer of survey.randomizers)
    for (const arm of randomizer.arms ?? []) {
      const index = arm.blockIds.indexOf(blockId);
      if (index >= 0) return { randomizer, arm, index };
    }
  return null;
}

export function flowSteps(survey: Survey): FlowStep[] {
  const byId = new Map(survey.blocks.map((b) => [b.id, b]));
  const owner = new Map<string, Randomizer>();
  for (const r of survey.randomizers) for (const a of r.arms ?? []) for (const id of a.blockIds) if (byId.has(id) && !owner.has(id)) owner.set(id, r);
  const steps: FlowStep[] = [];
  const emitted = new Set<string>();
  for (const b of survey.blocks) {
    const r = owner.get(b.id);
    if (!r) steps.push({ kind: 'block', block: b });
    else if (!emitted.has(r.id)) {
      emitted.add(r.id);
      steps.push({
        kind: 'randomizer',
        randomizer: r,
        arms: r.arms.map((arm) => ({ arm, blocks: arm.blockIds.filter((id) => owner.get(id) === r).map((id) => byId.get(id)!) })),
      });
    }
  }
  return steps;
}

function toItems(survey: Survey): Item[] {
  return flowSteps(survey).map((s) => (s.kind === 'block' ? { type: 'block', id: s.block.id } : { type: 'rand', id: s.randomizer.id }));
}

/** Writes a sequence of items back into survey.blocks and drops randomizers left without blocks. */
function fromItems(survey: Survey, items: Item[]) {
  const byId = new Map(survey.blocks.map((b) => [b.id, b]));
  const order: Block[] = [];
  const used = new Set<string>();
  const add = (id: string) => {
    const b = byId.get(id);
    if (b && !used.has(id)) {
      used.add(id);
      order.push(b);
    }
  };
  for (const it of items) {
    if (it.type === 'block') add(it.id);
    else survey.randomizers.find((r) => r.id === it.id)?.arms.forEach((a) => a.blockIds.forEach(add));
  }
  for (const b of survey.blocks) if (!used.has(b.id)) order.push(b);
  survey.blocks = order;
  tidy(survey);
}

/**
 * Makes the structure consistent: branches only reference existing blocks, each
 * block sits in at most one branch, randomizers have at least one block, and
 * survey.blocks lists blocks in flow order (randomizer blocks together).
 */
export function tidy(survey: Survey) {
  const exists = new Set(survey.blocks.map((b) => b.id));
  const seen = new Set<string>();
  for (const r of survey.randomizers) {
    r.arms = (r.arms ?? []).filter((a) => {
      const had = a.blockIds.length;
      a.blockIds = a.blockIds.filter((id) => exists.has(id) && !seen.has(id) && !!seen.add(id));
      // A branch whose blocks are all gone goes too; one left empty on purpose (a control group) stays.
      return a.blockIds.length > 0 || had === 0;
    });
  }
  survey.randomizers = survey.randomizers.filter((r) => r.arms.some((a) => a.blockIds.length));
  const order = flowSteps(survey).flatMap((s) => (s.kind === 'block' ? [s.block] : s.arms.flatMap((a) => a.blocks)));
  if (order.length === survey.blocks.length) survey.blocks = order;
}

/**
 * Takes a block out of its branch. A branch that this leaves empty is removed too
 * (unless it's `keep`), so nobody gets assigned to a branch with nothing in it by
 * accident. Branches added empty on purpose stay until they get blocks.
 */
function detach(survey: Survey, blockId: string, keep?: RandomizerArm) {
  for (const r of survey.randomizers) {
    r.arms = r.arms.filter((a) => {
      const i = a.blockIds.indexOf(blockId);
      if (i < 0) return true;
      a.blockIds.splice(i, 1);
      return a.blockIds.length > 0 || a === keep;
    });
  }
}

/** Moves a block to the top-level sequence, before step `before` (steps.length = the end). */
export function moveToSequence(survey: Survey, blockId: string, before: number) {
  const items = toItems(survey);
  const anchor = items[before] ?? null;
  const fromIndex = items.findIndex((it) => it.type === 'block' && it.id === blockId);
  if (fromIndex >= 0) items.splice(fromIndex, 1);
  else detach(survey, blockId);
  const at = anchor ? items.indexOf(anchor) : items.length;
  items.splice(at < 0 ? items.length : at, 0, { type: 'block', id: blockId });
  fromItems(survey, items);
}

/** Moves a block into a randomizer branch, before position `before` in that branch. */
export function moveIntoArm(survey: Survey, blockId: string, randomizerId: string, armId: string, before: number) {
  const r = survey.randomizers.find((x) => x.id === randomizerId);
  const arm = r?.arms.find((a) => a.id === armId);
  if (!r || !arm) return;
  const items = toItems(survey);
  const current = placeOf(survey, blockId);
  let at = before;
  if (current?.arm === arm && current.index < before) at -= 1;
  const top = items.findIndex((it) => it.type === 'block' && it.id === blockId);
  if (top >= 0) items.splice(top, 1);
  detach(survey, blockId, arm);
  // The randomizer keeps its place even if this block was its only member so far.
  if (!items.some((it) => it.type === 'rand' && it.id === r.id)) items.splice(Math.max(0, top), 0, { type: 'rand', id: r.id });
  arm.blockIds.splice(Math.max(0, Math.min(at, arm.blockIds.length)), 0, blockId);
  fromItems(survey, items);
}

export function uniqueLabel(r: Randomizer, wanted: string): string {
  const base = (wanted || 'Branch').replace(/\|/g, '/').trim() || 'Branch';
  const taken = new Set(r.arms.map((a) => a.label.trim().toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base} ${i}`.toLowerCase())) return `${base} ${i}`;
}

/** A field name for a new randomizer that doesn't clash with anything else. */
export function freeRandomizerName(survey: Survey, base = 'condition'): string {
  const used = allVariables(survey);
  if (!used.has(base)) return base;
  for (let i = 2; ; i++) if (!used.has(`${base}${i}`)) return `${base}${i}`;
}

/**
 * Puts a block in parallel with another: dropping block A onto block B makes
 * them two branches of a randomizer (or adds A as a new branch of B's randomizer).
 */
export function makeParallel(survey: Survey, blockId: string, targetBlockId: string): Randomizer | null {
  if (blockId === targetBlockId) return null;
  const dragged = survey.blocks.find((b) => b.id === blockId);
  const target = survey.blocks.find((b) => b.id === targetBlockId);
  if (!dragged || !target) return null;
  const targetPlace = placeOf(survey, targetBlockId);
  if (targetPlace) {
    const r = targetPlace.randomizer;
    const arm: RandomizerArm = { id: uid('arm'), label: uniqueLabel(r, dragged.title), blockIds: [] };
    r.arms.push(arm);
    moveIntoArm(survey, blockId, r.id, arm.id, 0);
    return r;
  }
  const items = toItems(survey);
  const r: Randomizer = {
    id: uid('rz'),
    variable: freeRandomizerName(survey),
    arms: [],
    present: 1,
    balance: true,
  };
  r.arms.push({ id: uid('arm'), label: uniqueLabel(r, target.title), blockIds: [targetBlockId] });
  r.arms.push({ id: uid('arm'), label: uniqueLabel(r, dragged.title), blockIds: [blockId] });
  detach(survey, blockId);
  const filtered = items.filter((it) => !(it.type === 'block' && it.id === blockId));
  const at = filtered.findIndex((it) => it.type === 'block' && it.id === targetBlockId);
  filtered.splice(at, 1, { type: 'rand', id: r.id });
  survey.randomizers.push(r);
  fromItems(survey, filtered);
  return r;
}

/** Adds an empty branch (respondents who get it see nothing there, e.g. a control group). */
export function addArm(survey: Survey, randomizerId: string, label?: string): RandomizerArm | null {
  const r = survey.randomizers.find((x) => x.id === randomizerId);
  if (!r) return null;
  const arm: RandomizerArm = { id: uid('arm'), label: uniqueLabel(r, label?.trim() || `Branch ${r.arms.length + 1}`), blockIds: [] };
  r.arms.push(arm);
  return arm;
}

/** Drops a block into a new branch of its own (named after the block) at the end of a randomizer. */
export function moveIntoNewArm(survey: Survey, blockId: string, randomizerId: string): RandomizerArm | null {
  const block = survey.blocks.find((b) => b.id === blockId);
  const arm = block ? addArm(survey, randomizerId, block.title) : null;
  if (arm) moveIntoArm(survey, blockId, randomizerId, arm.id, 0);
  return arm;
}

/** Removes a branch; its blocks continue in sequence right after the randomizer. */
export function removeArm(survey: Survey, randomizerId: string, armId: string) {
  const r = survey.randomizers.find((x) => x.id === randomizerId);
  const arm = r?.arms.find((a) => a.id === armId);
  if (!r || !arm) return;
  const items = toItems(survey);
  const at = items.findIndex((it) => it.type === 'rand' && it.id === r.id);
  r.arms = r.arms.filter((a) => a !== arm);
  items.splice(at + 1, 0, ...arm.blockIds.map((id) => ({ type: 'block' as const, id })));
  if (!r.arms.some((a) => a.blockIds.length)) {
    items.splice(at, 1);
    survey.randomizers = survey.randomizers.filter((x) => x !== r);
  }
  fromItems(survey, items);
}

/** Dissolves a randomizer: all its blocks run in sequence, branch by branch. */
export function ungroup(survey: Survey, randomizerId: string) {
  const r = survey.randomizers.find((x) => x.id === randomizerId);
  if (!r) return;
  const items = toItems(survey);
  const at = items.findIndex((it) => it.type === 'rand' && it.id === r.id);
  const blocks = r.arms.flatMap((a) => a.blockIds).map((id) => ({ type: 'block' as const, id }));
  items.splice(at, 1, ...blocks);
  survey.randomizers = survey.randomizers.filter((x) => x !== r);
  fromItems(survey, items);
}

export function moveArm(survey: Survey, randomizerId: string, armId: string, dir: -1 | 1) {
  const r = survey.randomizers.find((x) => x.id === randomizerId);
  if (!r) return;
  const i = r.arms.findIndex((a) => a.id === armId);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= r.arms.length) return;
  [r.arms[i], r.arms[j]] = [r.arms[j], r.arms[i]];
  tidy(survey);
}

/** Moves a whole step (a block or a randomizer) up or down the sequence. */
export function moveStep(survey: Survey, stepIndex: number, dir: -1 | 1) {
  const items = toItems(survey);
  const j = stepIndex + dir;
  if (stepIndex < 0 || j < 0 || j >= items.length) return;
  [items[stepIndex], items[j]] = [items[j], items[stepIndex]];
  fromItems(survey, items);
}

/** Moves a whole step so it sits before step `before` (steps.length = the end). */
export function moveStepTo(survey: Survey, stepIndex: number, before: number) {
  const items = toItems(survey);
  if (stepIndex < 0 || stepIndex >= items.length) return;
  const [it] = items.splice(stepIndex, 1);
  const at = before > stepIndex ? before - 1 : before;
  items.splice(Math.max(0, Math.min(at, items.length)), 0, it);
  fromItems(survey, items);
}

/** Up/down for a block: past whole steps at the top level, or within its branch. */
export function canMoveBlock(survey: Survey, blockId: string, dir: -1 | 1): boolean {
  const place = placeOf(survey, blockId);
  if (place) {
    const j = place.index + dir;
    return j >= 0 && j < place.arm.blockIds.length;
  }
  const items = toItems(survey);
  const i = items.findIndex((it) => it.type === 'block' && it.id === blockId);
  return i >= 0 && i + dir >= 0 && i + dir < items.length;
}

export function moveBlock(survey: Survey, blockId: string, dir: -1 | 1) {
  const place = placeOf(survey, blockId);
  if (place) {
    const ids = place.arm.blockIds;
    const j = place.index + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[place.index], ids[j]] = [ids[j], ids[place.index]];
    tidy(survey);
    return;
  }
  const items = toItems(survey);
  moveStep(survey, items.findIndex((it) => it.type === 'block' && it.id === blockId), dir);
}

/** Adds a new block right after another one (in the same branch), or at the end. */
export function insertBlockAfter(survey: Survey, block: Block, afterBlockId: string | null) {
  survey.blocks.push(block);
  if (!afterBlockId) return tidy(survey);
  const place = placeOf(survey, afterBlockId);
  if (place) {
    place.arm.blockIds.splice(place.index + 1, 0, block.id);
    return tidy(survey);
  }
  const items = toItems(survey).filter((it) => !(it.type === 'block' && it.id === block.id));
  const at = items.findIndex((it) => it.type === 'block' && it.id === afterBlockId);
  items.splice(at < 0 ? items.length : at + 1, 0, { type: 'block', id: block.id });
  fromItems(survey, items);
}

export function removeBlock(survey: Survey, blockId: string) {
  detach(survey, blockId);
  survey.blocks = survey.blocks.filter((b) => b.id !== blockId);
  for (const b of survey.blocks) for (const br of b.branches) if (br.target === blockId) br.target = 'end';
  tidy(survey);
}

/* ------------------------------------------------------------------ names */

function eachCondition(survey: Survey, fn: (c: Condition) => void) {
  for (const b of survey.blocks) {
    b.displayLogic?.conditions.forEach(fn);
    for (const br of b.branches) br.logic.conditions.forEach(fn);
    for (const q of b.questions) q.displayLogic?.conditions.forEach(fn);
  }
}

/**
 * Conditions on a URL parameter or randomizer follow it when it's renamed. Only
 * while the old name is unambiguous and the new one is free, so typing a name
 * that briefly matches another field never moves that field's conditions.
 */
function retargetField(survey: Survey, from: string, to: string) {
  if (from === to) return;
  const names = [...survey.urlParams.map((p) => p.name), ...survey.randomizers.map((r) => r.variable)];
  if (names.filter((n) => n === from).length !== 1) return;
  if (names.some((n) => n !== from && n.toLowerCase() === to.toLowerCase())) return;
  eachCondition(survey, (c) => {
    if (c.source === `param:${from}`) c.source = `param:${to}`;
  });
}

export function renameRandomizer(survey: Survey, randomizerId: string, variable: string) {
  const r = survey.randomizers.find((x) => x.id === randomizerId);
  if (!r) return;
  retargetField(survey, r.variable, variable);
  r.variable = variable;
}

export function renameUrlParam(survey: Survey, paramId: string, name: string) {
  const p = survey.urlParams.find((x) => x.id === paramId);
  if (!p) return;
  retargetField(survey, p.name, name);
  p.name = name;
}

/** Renames a branch; conditions that check it ("condition is Vignette") follow along. */
export function renameArm(survey: Survey, randomizerId: string, armId: string, label: string) {
  const r = survey.randomizers.find((x) => x.id === randomizerId);
  const arm = r?.arms.find((a) => a.id === armId);
  if (!r || !arm) return;
  // "|" separates branches when a respondent gets several, so it can't be part of a name.
  const next = label.replace(/\|/g, '/');
  const others = r.arms.filter((a) => a !== arm).map((a) => a.label);
  if (arm.label !== next && !others.includes(arm.label) && !others.includes(next))
    eachCondition(survey, (c) => {
      if (c.source === `param:${r.variable}` && c.value === arm.label) c.value = next;
    });
  arm.label = next;
}

/* ------------------------------------------------------------- skip rules */

/**
 * Where a skip rule after `blockId` can go: later blocks of its own branch, then the
 * steps after it. A randomizer counts as one step (its first block stands for it):
 * respondents who jump there get the branch they were assigned, from its start.
 */
export function skipTargets(survey: Survey, blockId: string): { id: string; label: string }[] {
  const steps = flowSteps(survey);
  const place = placeOf(survey, blockId);
  const out: { id: string; label: string }[] = [];
  let from: number;
  if (place) {
    for (const id of place.arm.blockIds.slice(place.index + 1)) {
      const b = survey.blocks.find((x) => x.id === id);
      if (b) out.push({ id, label: `Block: ${b.title} (in this branch)` });
    }
    from = steps.findIndex((st) => st.kind === 'randomizer' && st.randomizer.id === place.randomizer.id) + 1;
  } else from = steps.findIndex((st) => st.kind === 'block' && st.block.id === blockId) + 1;
  for (const st of steps.slice(Math.max(0, from))) {
    if (st.kind === 'block') out.push({ id: st.block.id, label: `Block: ${st.block.title}` });
    else {
      const first = st.arms.find((a) => a.blocks.length)?.blocks[0];
      if (first) out.push({ id: first.id, label: `Randomizer ${st.randomizer.variable} (each person’s branch)` });
    }
  }
  return out;
}

/** How a skip target reads in summaries: a block, or a randomizer when the jump enters one. */
export function describeTarget(survey: Survey, fromBlockId: string, target: string): string {
  const to = placeOf(survey, target);
  if (to && to.randomizer.id !== placeOf(survey, fromBlockId)?.randomizer.id) return `randomizer ${to.randomizer.variable}`;
  const b = survey.blocks.find((x) => x.id === target);
  return b ? `“${b.title}”` : 'a missing block';
}
