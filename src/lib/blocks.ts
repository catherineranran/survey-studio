// What a block holds and asks of respondents, in the builder's words: contents,
// pages, and whether its questions must be answered (forced response) or not.

import { TYPE_INFO } from './questionTypes';
import type { Block, Question } from './types';

export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** What a folded block holds, e.g. "5 questions, 1 text". */
export function blockContents(block: Block): string {
  const questions = block.questions.filter((q) => TYPE_INFO[q.type].answerable).length;
  const texts = block.questions.filter((q) => q.type === 'text_block').length;
  const parts = [questions ? plural(questions, 'question', 'questions') : null, texts ? plural(texts, 'text', 'texts') : null].filter(Boolean);
  return parts.length ? parts.join(', ') : 'Empty';
}

/**
 * How many pages a block shown all together takes: page breaks split it (as the
 * survey does: a break at the start or end, or two in a row, add no empty page).
 * Null for blocks that show one question per page.
 */
export function blockPages(block: Block): number | null {
  if (block.pageMode === 'each') return null;
  let pages = 0;
  let open = false;
  for (const q of block.questions) {
    if (q.type === 'page_break') open = false;
    else if (!open) {
      pages++;
      open = true;
    }
  }
  return Math.max(1, pages);
}

/* ------------------------------------------------------------ responses */

/** Questions a block's forced / optional choice applies to (consent always needs an answer). */
const ruled = (block: Block) => block.questions.filter((q) => TYPE_INFO[q.type].answerable && q.type !== 'consent');

/**
 * The block's forced / optional choice while its questions still follow it. Null when
 * none was chosen, or once single questions were set differently (then each decides).
 */
export function blockResponses(block: Block): 'forced' | 'optional' | null {
  const choice = block.responses;
  if (choice !== 'forced' && choice !== 'optional') return null;
  return ruled(block).every((q) => q.required === (choice === 'forced')) ? choice : null;
}

/** Chooses forced response or optional for a whole block (null: each question decides). */
export function setBlockResponses(block: Block, choice: 'forced' | 'optional' | null) {
  if (!choice) {
    delete block.responses;
    return;
  }
  block.responses = choice;
  for (const q of ruled(block)) q.required = choice === 'forced';
}

/** A new question in a block follows the block's choice; without one it keeps its type's default. */
export function followBlock(q: Question, block: Block | undefined): Question {
  const choice = block ? blockResponses(block) : null;
  if (!choice || !TYPE_INFO[q.type].answerable || q.type === 'consent') return q;
  return { ...q, required: choice === 'forced' };
}
