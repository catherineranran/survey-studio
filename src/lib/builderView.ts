// How you look at a survey in the builder, as opposed to the survey itself: which
// blocks are folded (per survey) and whether the outline is shown. It lives in this
// browser only, isn't part of undo, and never reaches respondents.

import { TYPE_INFO } from './questionTypes';
import type { Block } from './types';

const foldKey = (surveyId: string) => `survey-studio.folded.${surveyId}`;
const OUTLINE_KEY = 'survey-studio.outline';

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null; // blocked (some privacy settings)
  }
}

/** Ids of the folded blocks of a survey. */
export function readFolded(surveyId: string): string[] {
  try {
    const saved: unknown = JSON.parse(storage()?.getItem(foldKey(surveyId)) ?? '[]');
    return Array.isArray(saved) ? saved.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function writeFolded(surveyId: string, blockIds: string[]) {
  try {
    if (blockIds.length) storage()?.setItem(foldKey(surveyId), JSON.stringify(blockIds));
    else storage()?.removeItem(foldKey(surveyId));
  } catch {
    /* not remembered */
  }
}

/** Whether the outline is shown next to the blocks (on screens wide enough for it). */
export function readOutlineShown(): boolean {
  try {
    return storage()?.getItem(OUTLINE_KEY) !== 'hidden';
  } catch {
    return true;
  }
}

export function writeOutlineShown(shown: boolean) {
  try {
    if (shown) storage()?.removeItem(OUTLINE_KEY);
    else storage()?.setItem(OUTLINE_KEY, 'hidden');
  } catch {
    /* not remembered */
  }
}

/** Forgets the view of a deleted survey. */
export function forgetSurveyView(surveyId: string) {
  writeFolded(surveyId, []);
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** What a folded block holds, e.g. "5 questions, 1 text". */
export function blockContents(block: Block): string {
  const questions = block.questions.filter((q) => TYPE_INFO[q.type].answerable).length;
  const texts = block.questions.length - questions;
  const parts = [questions ? plural(questions, 'question', 'questions') : null, texts ? plural(texts, 'text', 'texts') : null].filter(Boolean);
  return parts.length ? parts.join(', ') : 'Empty';
}
