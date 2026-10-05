// The survey checker: catches problems before respondents (or your data) do.

import { allQuestions } from './engine';
import { VARIABLE_RE } from './ids';
import { TYPE_INFO } from './questionTypes';
import type { Logic, Question, Survey } from './types';

export interface Issue {
  level: 'error' | 'warning';
  message: string;
  questionId?: string;
  blockId?: string;
}

export function lintSurvey(s: Survey): Issue[] {
  const issues: Issue[] = [];
  const err = (message: string, where: Partial<Issue> = {}) => issues.push({ level: 'error', message, ...where });
  const warn = (message: string, where: Partial<Issue> = {}) => issues.push({ level: 'warning', message, ...where });

  const questions = allQuestions(s);
  const position = new Map(questions.map((q, i) => [q.id, i]));
  const blockOf = new Map(s.blocks.flatMap((b) => b.questions.map((q) => [q.id, b.id] as const)));
  const blockPos = new Map(s.blocks.map((b, i) => [b.id, i]));

  if (!questions.some((q) => TYPE_INFO[q.type].answerable)) err('Add at least one question respondents can answer.');

  // Variable names
  const names = new Map<string, string>();
  const claim = (name: string, owner: string, where: Partial<Issue>) => {
    const key = name.toLowerCase();
    if (names.has(key)) err(`The name “${name}” is used twice (${names.get(key)} and ${owner}). Export columns need unique names.`, where);
    else names.set(key, owner);
  };
  for (const q of questions) {
    if (!TYPE_INFO[q.type].answerable) continue;
    const where = { questionId: q.id };
    if (!q.variable) err('A question has no variable name.', where);
    else if (!VARIABLE_RE.test(q.variable)) err(`“${q.variable}” isn’t a valid variable name. Use letters, digits and underscores, starting with a letter.`, where);
    else claim(q.variable, `question ${q.variable}`, where);
  }
  for (const p of s.urlParams) {
    if (!VARIABLE_RE.test(p.name)) err(`URL parameter “${p.name}” isn’t a valid name.`);
    else claim(p.name, `URL parameter ${p.name}`, {});
  }
  for (const r of s.randomizers) {
    if (!VARIABLE_RE.test(r.variable)) err(`Randomizer name “${r.variable}” isn’t a valid name.`);
    else claim(r.variable, `randomizer ${r.variable}`, {});
  }

  // Questions
  for (const q of questions) {
    const where = { questionId: q.id };
    const label = q.variable || 'A text block';
    if (!q.title.trim() && q.type !== 'text_block') warn(`${label} has no question text.`, where);
    const needsChoices = ['single_choice', 'multi_choice', 'dropdown', 'rank', 'constant_sum'].includes(q.type);
    if (needsChoices && (q.choices?.length ?? 0) < 2) err(`${label} needs at least two options.`, where);
    if (q.choices?.some((c) => !c.label.trim())) warn(`${label} has an option without a label.`, where);
    if (q.choices && new Set(q.choices.map((c) => c.code)).size !== q.choices.length) warn(`${label} has options that share a code, so they can’t be told apart in exported data.`, where);
    if (q.type === 'consent' && q.choices?.length !== 2) err(`${label}: a consent question needs exactly two options (agree first, decline second).`, where);
    if (q.type === 'matrix') {
      if (!q.rows?.length) err(`${label} needs at least one statement.`, where);
      if ((q.columns?.length ?? 0) < 2) err(`${label} needs at least two scale points.`, where);
      if (q.rows && new Set(q.rows.map((r) => r.code)).size !== q.rows.length) err(`${label} has statements with the same code, so their export columns would collide.`, where);
    }
    if ((q.type === 'multi_choice' || q.type === 'rank' || q.type === 'constant_sum') && q.choices && new Set(q.choices.map((c) => c.code)).size !== q.choices.length)
      err(`${label} has options with the same code, so their export columns would collide.`, where);
    if ((q.type === 'rating_scale' || q.type === 'slider') && q.scale && q.scale.min >= q.scale.max) err(`${label}: the lowest value must be below the highest.`, where);
    if (q.type === 'slider' && q.scale && (q.scale.step ?? 1) <= 0) err(`${label}: the step must be above zero.`, where);
    if (q.type === 'rating_scale' && q.scale && q.scale.max - q.scale.min > 10) warn(`${label} has more than 11 points; consider a slider.`, where);
    const v = q.validation;
    if (q.type === 'short_text' && v?.format === 'regex') {
      if (!v.pattern) err(`${label} checks a pattern but none is set.`, where);
      else {
        try {
          new RegExp(v.pattern);
        } catch {
          err(`${label}: the pattern “${v.pattern}” isn’t a valid regular expression.`, where);
        }
      }
    }
    if (v?.min != null && v?.max != null && v.min > v.max) err(`${label}: the minimum is above the maximum.`, where);
    if (v?.minSelected && v?.maxSelected && v.minSelected > v.maxSelected) err(`${label}: the minimum number of selections is above the maximum.`, where);
    checkLogic(q.displayLogic, `${label} (display logic)`, where, (srcId) => {
      if ((position.get(srcId) ?? -1) > (position.get(q.id) ?? 0)) return 'later';
      if (srcId === q.id) return 'self';
      return null;
    });
  }

  // Blocks
  for (const b of s.blocks) {
    const where = { blockId: b.id };
    if (!b.questions.length) warn(`Block “${b.title}” is empty.`, where);
    const firstPos = b.questions.length ? (position.get(b.questions[0].id) ?? 0) : Number.MAX_SAFE_INTEGER;
    checkLogic(b.displayLogic, `Block “${b.title}” (display logic)`, where, (srcId) => ((position.get(srcId) ?? 0) >= firstPos ? 'later' : null));
    b.branches.forEach((br, i) => {
      const name = `Block “${b.title}”, skip rule ${i + 1}`;
      checkLogic(br.logic, name, where, (srcId) => (blockPos.get(blockOf.get(srcId) ?? '') ?? 0) > (blockPos.get(b.id) ?? 0) ? 'later' : null);
      if (br.target !== 'end') {
        if (!blockPos.has(br.target)) err(`${name} goes to a block that no longer exists.`, where);
        else if (blockPos.get(br.target)! <= blockPos.get(b.id)!) warn(`${name} jumps backwards; skip logic only jumps forward, so this rule is ignored.`, where);
      }
      if (br.endRedirect && !/^https?:\/\//i.test(br.endRedirect.trim())) warn(`${name}: the redirect should start with https://.`, where);
    });
  }

  // Randomizers
  const owned = new Map<string, string>();
  for (const r of s.randomizers) {
    const live = r.blockIds.filter((id) => blockPos.has(id));
    if (live.length < 2) warn(`Randomizer “${r.variable}” has fewer than two blocks, so nothing is randomized.`);
    for (const id of live) {
      if (owned.has(id)) err(`A block is in two randomizers (“${owned.get(id)}” and “${r.variable}”).`, { blockId: id });
      owned.set(id, r.variable);
    }
    if (r.present > live.length) warn(`Randomizer “${r.variable}” shows ${r.present} blocks but only has ${live.length}.`);
  }

  if (s.settings.redirectUrl && !/^https?:\/\//i.test(s.settings.redirectUrl.trim())) warn('The redirect link in Settings should start with https://.');

  return issues;

  function checkLogic(logic: Logic | null | undefined, name: string, where: Partial<Issue>, order: (srcId: string) => 'later' | 'self' | null) {
    for (const c of logic?.conditions ?? []) {
      if (c.source.startsWith('param:')) {
        const n = c.source.slice(6);
        const known = s.urlParams.some((p) => p.name === n) || s.randomizers.some((r) => r.variable === n);
        if (!known) err(`${name} uses “${n}”, which is no longer a URL parameter or randomizer.`, where);
        continue;
      }
      const src = questions.find((x) => x.id === c.source);
      if (!src) {
        err(`${name} refers to a question that was deleted.`, where);
        continue;
      }
      const o = order(src.id);
      if (o === 'self') err(`${name} refers to the question itself.`, where);
      if (o === 'later') warn(`${name} depends on ${src.variable || 'a question'}, which comes later. It can only work once that question has been answered.`, where);
      if (needsValue(c.operator) && (c.value === undefined || c.value === '')) err(`${name} has a condition without a value.`, where);
      if (src.type === 'matrix' && !c.rowId) err(`${name}: choose which statement of ${src.variable} the condition checks.`, where);
    }
  }
}

export function needsValue(op: string): boolean {
  return op !== 'answered' && op !== 'not_answered';
}

export function questionLabel(q: Question): string {
  const text = q.title.replace(/\{\{[^}]*\}\}/g, '…').replace(/[*_[\]]/g, '').replace(/\s+/g, ' ').trim();
  return text.length > 60 ? `${text.slice(0, 57)}…` : text || 'Untitled';
}
