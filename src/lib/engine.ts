// The survey runtime: randomization, display logic, skip logic, validation,
// piping and answer clean-up. Pure functions, no UI, fully unit-tested.

import { t } from './i18n';
import type {
  AnswerValue,
  Block,
  Choice,
  Condition,
  Lang,
  Logic,
  Question,
  Survey,
} from './types';

/* ------------------------------------------------------------------ random */

/** Small, fast, seedable PRNG so every respondent's randomization is reproducible from their seed. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = a;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle<T>(items: readonly T[], rand: () => number): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function randomSeed(): number {
  const b = new Uint32Array(1);
  crypto.getRandomValues(b);
  return b[0];
}

/* ------------------------------------------------------------------- index */

export interface SurveyIndex {
  questions: Map<string, Question>;
  blocks: Map<string, Block>;
  questionBlock: Map<string, Block>;
  byVariable: Map<string, Question>;
}

export function indexSurvey(survey: Survey): SurveyIndex {
  const questions = new Map<string, Question>();
  const blocks = new Map<string, Block>();
  const questionBlock = new Map<string, Block>();
  const byVariable = new Map<string, Question>();
  for (const b of survey.blocks) {
    blocks.set(b.id, b);
    for (const q of b.questions) {
      questions.set(q.id, q);
      questionBlock.set(q.id, b);
      if (q.variable) {
        byVariable.set(q.variable, q);
        if (!byVariable.has(q.variable.toLowerCase())) byVariable.set(q.variable.toLowerCase(), q);
      }
    }
  }
  return { questions, blocks, questionBlock, byVariable };
}

/** All questions in survey order. */
export function allQuestions(survey: Survey): Question[] {
  return survey.blocks.flatMap((b) => b.questions);
}

/* -------------------------------------------------------------------- plan */

/** Everything that is randomized for one respondent, decided once at the start. */
export interface Plan {
  seed: number;
  blockOrder: string[];
  questionOrder: Record<string, string[]>;
  choiceOrder: Record<string, string[]>;
  rowOrder: Record<string, string[]>;
  /** Randomizer variable -> presented block title(s), joined with "|". */
  assignments: Record<string, string>;
}

/** Completed responses per randomizer value, used for balanced assignment. */
export type AssignmentCounts = Record<string, Record<string, number>>;

export function blockLabel(b: Block): string {
  return b.title.trim() || b.id;
}

export function makePlan(survey: Survey, seed: number, counts: AssignmentCounts = {}): Plan {
  const rand = mulberry32(seed);
  const assignments: Record<string, string> = {};
  const chosen = new Map<string, string[]>(); // randomizer id -> presented block ids, in order
  const owner = new Map<string, string>(); // block id -> randomizer id
  const blockById = new Map(survey.blocks.map((b) => [b.id, b]));

  for (const r of survey.randomizers) {
    const ids = r.blockIds.filter((id) => blockById.has(id) && !owner.has(id));
    if (!ids.length) continue;
    ids.forEach((id) => owner.set(id, r.id));
    const n = Math.max(1, Math.min(Math.floor(r.present) || 1, ids.length));
    let picked: string[];
    if (r.balance) {
      const usage = new Map<string, number>(ids.map((id) => [blockLabel(blockById.get(id)!), 0]));
      for (const [value, count] of Object.entries(counts[r.variable] ?? {})) {
        for (const label of value.split('|')) if (usage.has(label)) usage.set(label, usage.get(label)! + count);
      }
      // Least-used first; ties broken randomly.
      picked = shuffle(ids, rand)
        .sort((a, b) => usage.get(blockLabel(blockById.get(a)!))! - usage.get(blockLabel(blockById.get(b)!))!)
        .slice(0, n);
      picked = shuffle(picked, rand);
    } else {
      picked = shuffle(ids, rand).slice(0, n);
    }
    chosen.set(r.id, picked);
    assignments[r.variable] = picked.map((id) => blockLabel(blockById.get(id)!)).join('|');
  }

  const blockOrder: string[] = [];
  const emitted = new Set<string>();
  for (const b of survey.blocks) {
    const rid = owner.get(b.id);
    if (!rid) {
      blockOrder.push(b.id);
    } else if (!emitted.has(rid)) {
      emitted.add(rid);
      blockOrder.push(...(chosen.get(rid) ?? []));
    }
  }

  const questionOrder: Record<string, string[]> = {};
  const choiceOrder: Record<string, string[]> = {};
  const rowOrder: Record<string, string[]> = {};
  for (const b of survey.blocks) {
    const ids = b.questions.map((q) => q.id);
    if (b.randomizeQuestions) {
      // Text blocks keep their position; everything else is shuffled around them.
      const movable = b.questions.filter((q) => q.type !== 'text_block').map((q) => q.id);
      const shuffled = shuffle(movable, rand);
      let k = 0;
      questionOrder[b.id] = b.questions.map((q) => (q.type === 'text_block' ? q.id : shuffled[k++]));
    } else {
      questionOrder[b.id] = ids;
    }
    for (const q of b.questions) {
      if (q.choices?.length) {
        if (q.randomizeChoices && q.type !== 'consent') {
          // "Other" and exclusive options ("None of these") stay at the end.
          const anchored = q.choices.filter((c) => c.other || c.exclusive).map((c) => c.id);
          const free = q.choices.filter((c) => !c.other && !c.exclusive).map((c) => c.id);
          choiceOrder[q.id] = [...shuffle(free, rand), ...anchored];
        } else {
          choiceOrder[q.id] = q.choices.map((c) => c.id);
        }
      }
      if (q.type === 'matrix' && q.rows?.length) {
        rowOrder[q.id] = q.randomizeRows ? shuffle(q.rows.map((r) => r.id), rand) : q.rows.map((r) => r.id);
      }
    }
  }

  return { seed, blockOrder, questionOrder, choiceOrder, rowOrder, assignments };
}

/** Orders a list by the plan, appending anything the plan doesn't know about. */
export function ordered<T extends { id: string }>(items: T[] | undefined, order: string[] | undefined): T[] {
  if (!items) return [];
  if (!order) return items;
  const byId = new Map(items.map((i) => [i.id, i]));
  const out: T[] = [];
  for (const id of order) {
    const it = byId.get(id);
    if (it) {
      out.push(it);
      byId.delete(id);
    }
  }
  return [...out, ...byId.values()];
}

/* ----------------------------------------------------------------- answers */

export type Answers = Record<string, AnswerValue>;

export interface Ctx {
  index: SurveyIndex;
  answers: Answers;
  otherText: Record<string, string>;
  embedded: Record<string, string>;
}

export function makeCtx(survey: Survey, answers: Answers = {}, embedded: Record<string, string> = {}, otherText: Record<string, string> = {}): Ctx {
  return { index: indexSurvey(survey), answers, embedded, otherText };
}

export function isEmpty(v: unknown): boolean {
  if (v === undefined || v === null) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (typeof v === 'number') return !Number.isFinite(v);
  if (typeof v === 'boolean') return false;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'object') return Object.keys(v as object).length === 0;
  return true;
}

/** Parses numbers typed with a comma or a dot as decimal separator. */
export function toNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const s = v.trim().replace(/\s/g, '').replace(',', '.');
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function choiceCode(list: Choice[] | undefined, id: unknown): number | null {
  const c = list?.find((x) => x.id === id);
  return c ? c.code : null;
}

/** Numeric reading of an answer: choice codes for choice questions, the number itself otherwise. */
function numericValue(q: Question, v: unknown): number | null {
  if (q.type === 'single_choice' || q.type === 'dropdown' || q.type === 'consent') return choiceCode(q.choices, v);
  if (q.type === 'matrix') return choiceCode(q.columns, v);
  return toNumber(v);
}

/* ------------------------------------------------------------------- logic */

export function evalCondition(c: Condition, ctx: Ctx): boolean {
  if (c.source.startsWith('param:')) {
    const raw = ctx.embedded[c.source.slice(6)] ?? '';
    return compare(c, raw, raw.trim() !== '', toNumber(raw));
  }
  const q = ctx.index.questions.get(c.source);
  if (!q) return false;
  let v: unknown = ctx.answers[q.id];
  if (q.type === 'matrix' && c.rowId) v = (v as Record<string, string> | undefined)?.[c.rowId];
  return compare(c, v, !isEmpty(v), numericValue(q, v));
}

function compare(c: Condition, v: unknown, answered: boolean, num: number | null): boolean {
  const target = c.value;
  const tn = toNumber(target);
  const text = (x: unknown) => (x === undefined || x === null ? '' : String(x)).trim().toLowerCase();
  switch (c.operator) {
    case 'answered':
      return answered;
    case 'not_answered':
      return !answered;
    case 'is':
      return answered && String(v) === String(target);
    case 'is_not':
      return !(answered && String(v) === String(target));
    case 'includes':
      return Array.isArray(v) && v.includes(String(target));
    case 'excludes':
      return !(Array.isArray(v) && v.includes(String(target)));
    case 'eq':
      return num !== null && tn !== null && num === tn;
    case 'neq':
      return num !== null && tn !== null && num !== tn;
    case 'gt':
      return num !== null && tn !== null && num > tn;
    case 'gte':
      return num !== null && tn !== null && num >= tn;
    case 'lt':
      return num !== null && tn !== null && num < tn;
    case 'lte':
      return num !== null && tn !== null && num <= tn;
    case 'equals_text':
      return answered && text(v) === text(target);
    case 'contains':
      return answered && text(v).includes(text(target));
    case 'not_contains':
      return !(answered && text(v).includes(text(target)));
  }
  return false;
}

/** Empty or missing logic means "always". */
export function evalLogic(logic: Logic | null | undefined, ctx: Ctx): boolean {
  if (!logic || !logic.conditions.length) return true;
  return logic.match === 'any'
    ? logic.conditions.some((c) => evalCondition(c, ctx))
    : logic.conditions.every((c) => evalCondition(c, ctx));
}

export const isQuestionVisible = (q: Question, ctx: Ctx) => evalLogic(q.displayLogic, ctx);
export const isBlockVisible = (b: Block, ctx: Ctx) => evalLogic(b.displayLogic, ctx);

/* ------------------------------------------------------------------- pages */

export interface Page {
  key: string;
  blockId: string;
  questionIds: string[];
}

export function pagesForBlock(block: Block, plan: Plan): Page[] {
  const order = plan.questionOrder[block.id] ?? block.questions.map((q) => q.id);
  if (block.pageMode === 'each') return order.map((qid) => ({ key: `${block.id}:${qid}`, blockId: block.id, questionIds: [qid] }));
  return [{ key: block.id, blockId: block.id, questionIds: order }];
}

export function visibleQuestions(page: Page, ctx: Ctx): Question[] {
  const out: Question[] = [];
  for (const id of page.questionIds) {
    const q = ctx.index.questions.get(id);
    if (q && isQuestionVisible(q, ctx)) out.push(q);
  }
  return out;
}

export interface Position {
  block: number;
  page: number;
}

export type Step = { kind: 'page'; pos: Position } | { kind: 'end'; status: string; message?: string; redirect?: string };

export function pageAt(plan: Plan, ctx: Ctx, pos: Position): Page | null {
  const block = ctx.index.blocks.get(plan.blockOrder[pos.block]);
  if (!block) return null;
  return pagesForBlock(block, plan)[pos.page] ?? null;
}

function findFrom(plan: Plan, ctx: Ctx, startBlock: number): Step | null {
  for (let bi = startBlock; bi < plan.blockOrder.length; bi++) {
    const block = ctx.index.blocks.get(plan.blockOrder[bi]);
    if (!block || !isBlockVisible(block, ctx)) continue;
    const pages = pagesForBlock(block, plan);
    for (let pi = 0; pi < pages.length; pi++) {
      if (visibleQuestions(pages[pi], ctx).length) return { kind: 'page', pos: { block: bi, page: pi } };
    }
  }
  return null;
}

export function firstStep(plan: Plan, ctx: Ctx): Step {
  return findFrom(plan, ctx, 0) ?? { kind: 'end', status: 'complete' };
}

/** Where to go after the page at `pos`, given the answers so far. */
export function nextStep(plan: Plan, ctx: Ctx, pos: Position): Step {
  const block = ctx.index.blocks.get(plan.blockOrder[pos.block]);
  if (!block) return { kind: 'end', status: 'complete' };
  const pages = pagesForBlock(block, plan);
  const page = pages[pos.page];

  // A declined consent question ends the survey straight away.
  if (page) {
    for (const q of visibleQuestions(page, ctx)) {
      if (q.type === 'consent' && q.endOnDecline !== false && q.choices && q.choices.length > 1 && ctx.answers[q.id] === q.choices[1].id) {
        return { kind: 'end', status: 'declined_consent', message: q.declineMessage };
      }
    }
  }

  for (let pi = pos.page + 1; pi < pages.length; pi++) {
    if (visibleQuestions(pages[pi], ctx).length) return { kind: 'page', pos: { block: pos.block, page: pi } };
  }

  // Skip logic: the first matching branch wins. Jumps only go forward, so a survey can't loop.
  for (const br of block.branches) {
    if (!evalLogic(br.logic, ctx)) continue;
    if (br.target === 'end')
      return { kind: 'end', status: br.endTag?.trim() || 'complete', message: br.endMessage || undefined, redirect: br.endRedirect?.trim() || undefined };
    const idx = plan.blockOrder.indexOf(br.target);
    if (idx > pos.block) return findFrom(plan, ctx, idx) ?? { kind: 'end', status: 'complete' };
  }

  return findFrom(plan, ctx, pos.block + 1) ?? { kind: 'end', status: 'complete' };
}

/** Pages still ahead if the respondent kept going with their current answers. */
export function remainingPages(plan: Plan, ctx: Ctx, pos: Position): number {
  let n = 0;
  let step = nextStep(plan, ctx, pos);
  while (step.kind === 'page' && n < 1000) {
    n++;
    step = nextStep(plan, ctx, step.pos);
  }
  return n;
}

/* -------------------------------------------------------------- validation */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const URL_RE = /^https?:\/\/[^\s.]+\.\S+$/i;

export function validateAnswer(q: Question, value: unknown, other: string | undefined, lang: Lang): string | null {
  const v = q.validation ?? {};
  const custom = v.message?.trim();
  const req = q.required;
  switch (q.type) {
    case 'text_block':
      return null;
    case 'short_text':
    case 'long_text': {
      const s = typeof value === 'string' ? value.trim() : '';
      if (!s) return req ? t(lang, 'errRequired') : null;
      if (v.minLength && s.length < v.minLength) return custom || t(lang, 'errMinLength', { n: v.minLength });
      if (v.maxLength && s.length > v.maxLength) return custom || t(lang, 'errMaxLength', { n: v.maxLength });
      if (q.type === 'short_text') {
        if (v.format === 'email' && !EMAIL_RE.test(s)) return custom || t(lang, 'errEmail');
        if (v.format === 'url' && !URL_RE.test(s)) return custom || t(lang, 'errUrl');
        if (v.format === 'number' && toNumber(s) === null) return custom || t(lang, 'errNumber');
        if (v.format === 'regex' && v.pattern) {
          try {
            if (!new RegExp(v.pattern).test(s)) return custom || t(lang, 'errPattern');
          } catch {
            /* an invalid pattern is ignored; the builder flags it */
          }
        }
      }
      return null;
    }
    case 'number': {
      if (isEmpty(value)) return req ? t(lang, 'errRequired') : null;
      const n = toNumber(value);
      if (n === null) return custom || t(lang, 'errNumber');
      if (v.integer && !Number.isInteger(n)) return custom || t(lang, 'errInteger');
      if (v.min !== null && v.min !== undefined && n < v.min) return custom || t(lang, 'errMin', { n: v.min });
      if (v.max !== null && v.max !== undefined && n > v.max) return custom || t(lang, 'errMax', { n: v.max });
      return null;
    }
    case 'date':
    case 'rating_scale':
    case 'nps':
    case 'slider':
      return isEmpty(value) && req ? t(lang, 'errRequired') : null;
    case 'single_choice':
    case 'dropdown':
    case 'consent': {
      if (isEmpty(value)) return req ? t(lang, 'errRequired') : null;
      const c = q.choices?.find((x) => x.id === value);
      if (c?.other && !other?.trim()) return t(lang, 'errOther');
      return null;
    }
    case 'multi_choice': {
      const arr = Array.isArray(value) ? value : [];
      if (!arr.length) return req ? t(lang, 'errRequired') : null;
      if (v.minSelected && arr.length < v.minSelected) return custom || t(lang, 'errMinSelected', { n: v.minSelected });
      if (v.maxSelected && arr.length > v.maxSelected) return custom || t(lang, 'errMaxSelected', { n: v.maxSelected });
      const otherChoice = q.choices?.find((c) => c.other && arr.includes(c.id));
      if (otherChoice && !other?.trim()) return t(lang, 'errOther');
      return null;
    }
    case 'matrix': {
      const rec = (value ?? {}) as Record<string, string>;
      const answered = (q.rows ?? []).filter((r) => rec[r.id]).length;
      if (req && answered < (q.rows?.length ?? 0)) return t(lang, answered ? 'errMatrix' : 'errRequired');
      return null;
    }
    case 'rank':
      return isEmpty(value) && req ? t(lang, 'errRank') : null;
    case 'constant_sum': {
      const rec = (value ?? {}) as Record<string, number | string>;
      const entries = Object.values(rec).filter((x) => !isEmpty(x));
      if (!entries.length) return req ? t(lang, 'errRequired') : null;
      const nums = entries.map(toNumber);
      if (nums.some((n) => n === null)) return t(lang, 'errNumber');
      if (nums.some((n) => (n as number) < 0)) return t(lang, 'errMin', { n: 0 });
      const total = v.total ?? 100;
      const sum = nums.reduce((a: number, b) => a + (b as number), 0);
      if (Math.abs(sum - total) > 1e-9) return custom || t(lang, 'errTotal', { total, sum: Math.round(sum * 100) / 100 });
      return null;
    }
  }
  return null;
}

/* ------------------------------------------------------------------ piping */

/** Human-readable version of an answer, used for piping and response views. */
export function answerText(q: Question, value: unknown, other?: string): string {
  if (isEmpty(value)) return '';
  const label = (list: Choice[] | undefined, id: unknown) => {
    const c = list?.find((x) => x.id === id);
    if (!c) return '';
    return c.other && other?.trim() ? other.trim() : c.label;
  };
  switch (q.type) {
    case 'single_choice':
    case 'dropdown':
    case 'consent':
      return label(q.choices, value);
    case 'multi_choice':
    case 'rank':
      return (value as string[]).map((id) => label(q.choices, id)).filter(Boolean).join(', ');
    case 'matrix': {
      const rec = value as Record<string, string>;
      return (q.rows ?? [])
        .filter((r) => rec[r.id])
        .map((r) => `${r.label}: ${q.columns?.find((c) => c.id === rec[r.id])?.label ?? ''}`)
        .join('; ');
    }
    case 'constant_sum': {
      const rec = value as Record<string, number>;
      return (q.choices ?? [])
        .filter((c) => !isEmpty(rec[c.id]))
        .map((c) => `${c.label}: ${rec[c.id]}`)
        .join('; ');
    }
    case 'rating_scale': {
      const idx = Number(value) - (q.scale?.min ?? 0);
      const pl = q.scale?.pointLabels?.[idx];
      return pl ? pl : String(value);
    }
    default:
      return String(value);
  }
}

const PIPE_RE = /\{\{\s*([A-Za-z][A-Za-z0-9_]*)\s*\}\}/g;

/** Replaces {{variable}} with an earlier answer, a URL parameter or a randomizer assignment. */
export function pipe(text: string | undefined, ctx: Ctx, extra: Record<string, string> = {}): string {
  if (!text) return '';
  if (!text.includes('{{')) return text;
  return text.replace(PIPE_RE, (_m, name: string) => {
    if (name in extra) return extra[name];
    const q = ctx.index.byVariable.get(name) ?? ctx.index.byVariable.get(name.toLowerCase());
    if (q) return answerText(q, ctx.answers[q.id], ctx.otherText[q.id]);
    if (name in ctx.embedded) return ctx.embedded[name];
    const key = Object.keys(ctx.embedded).find((k) => k.toLowerCase() === name.toLowerCase());
    return key ? ctx.embedded[key] : '';
  });
}

/** Like pipe(), but URL-encodes the inserted values (for redirect links). */
export function pipeUrl(url: string, ctx: Ctx, extra: Record<string, string> = {}): string {
  const enc: Record<string, string> = {};
  for (const [k, v] of Object.entries(extra)) enc[k] = encodeURIComponent(v);
  const encodedCtx: Ctx = {
    ...ctx,
    embedded: Object.fromEntries(Object.entries(ctx.embedded).map(([k, v]) => [k, encodeURIComponent(v)])),
  };
  return url.replace(PIPE_RE, (m) => {
    const name = m.replace(/[{}\s]/g, '');
    if (name in enc) return enc[name];
    const q = ctx.index.byVariable.get(name) ?? ctx.index.byVariable.get(name.toLowerCase());
    if (q) return encodeURIComponent(answerText(q, ctx.answers[q.id], ctx.otherText[q.id]));
    return pipe(m, encodedCtx);
  });
}

/* ---------------------------------------------------------------- clean-up */

/**
 * Keeps only answers to questions the respondent actually saw on the final path,
 * so changing an earlier answer (and taking another branch) leaves no stale data.
 */
export function finalizeAnswers(
  plan: Plan,
  ctx: Ctx,
  history: Position[],
): { answers: Answers; otherText: Record<string, string> } {
  const shown = new Set<string>();
  for (const pos of history) {
    const page = pageAt(plan, ctx, pos);
    if (!page) continue;
    const block = ctx.index.blocks.get(page.blockId);
    if (!block || !isBlockVisible(block, ctx)) continue;
    for (const q of visibleQuestions(page, ctx)) if (q.type !== 'text_block') shown.add(q.id);
  }
  const answers: Answers = {};
  const otherText: Record<string, string> = {};
  for (const id of shown) {
    const q = ctx.index.questions.get(id)!;
    let v = ctx.answers[id];
    if (isEmpty(v)) continue;
    if (q.type === 'number') {
      const n = toNumber(v);
      if (n === null) continue;
      v = n;
    }
    if (typeof v === 'string') v = v.trim();
    if (q.type === 'constant_sum') {
      const rec: Record<string, number> = {};
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
        const n = toNumber(x);
        if (n !== null) rec[k] = n;
      }
      v = rec;
    }
    answers[id] = v;
    const selected = Array.isArray(v) ? v : [v];
    if (q.choices?.some((c) => c.other && selected.includes(c.id)) && ctx.otherText[id]?.trim()) {
      otherText[id] = ctx.otherText[id].trim();
    }
  }
  return { answers, otherText };
}
