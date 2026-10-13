// A block in words, as the Flow tab and the flowchart image show it: what it holds,
// how it's paged and answered, and the logic around it.

import { blockPages, blockResponses } from '../lib/blocks';
import { describeTarget } from '../lib/flow';
import { TYPE_INFO } from '../lib/questionTypes';
import type { Block, Survey } from '../lib/types';
import { describeLogic } from './builder/LogicEditor';

export const blockTitle = (b: Block) => b.title.trim() || 'Untitled block';

export function describeBlock(survey: Survey, b: Block): { meta: string[]; rules: string[] } {
  const n = b.questions.filter((q) => TYPE_INFO[q.type].answerable).length;
  const texts = b.questions.filter((q) => q.type === 'text_block').length;
  const meta = [n ? `${n} question${n === 1 ? '' : 's'}` : texts ? 'text only' : 'empty'];
  const pages = blockPages(b);
  if (b.pageMode === 'each') meta.push('one per page');
  else if (pages && pages > 1) meta.push(`${pages} pages`);
  if (b.randomizeQuestions) meta.push('shuffled');
  const responses = blockResponses(b);
  if (responses) meta.push(responses === 'forced' ? 'forced response' : 'optional');

  const rules: string[] = [];
  if (b.displayLogic?.conditions.length) rules.push(`Shown only if ${describeLogic(b.displayLogic, survey)}`);
  // Questions with display logic, e.g. skipped for one branch of a randomizer.
  const shownIf = new Map<string, number>();
  for (const q of b.questions) {
    if (!q.displayLogic?.conditions.length) continue;
    const text = describeLogic(q.displayLogic, survey);
    shownIf.set(text, (shownIf.get(text) ?? 0) + 1);
  }
  const withLogic = [...shownIf.values()].reduce((a, x) => a + x, 0);
  if (shownIf.size === 1) rules.push(`${withLogic === 1 ? '1 question' : `${withLogic} questions`} shown only if ${[...shownIf.keys()][0]}`);
  else if (withLogic) rules.push(`${withLogic} questions have display logic`);
  if (b.questions.some((q) => q.type === 'consent' && q.endOnDecline !== false)) rules.push('Ends the survey if consent is declined');
  for (const br of b.branches) {
    const to = br.target === 'end' ? `end the survey (${br.endTag || 'complete'})` : `skip to ${describeTarget(survey, b.id, br.target)}`;
    rules.push(`If ${describeLogic(br.logic, survey)}, ${to}`);
  }
  return { meta, rules };
}
