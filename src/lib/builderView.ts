// How you look at a survey in the builder, as opposed to the survey itself: which
// blocks are folded (per survey) and whether the outline is shown. It lives in this
// browser only, isn't part of undo, and never reaches respondents.

const foldKey = (surveyId: string) => `survey-studio.folded.${surveyId}`;
const OUTLINE_KEY = 'survey-studio.outline';

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null; // blocked (some privacy settings)
  }
}

/**
 * Ids of the folded blocks of a survey, or null when nothing is remembered yet (the
 * first time you open it in this browser): then every block starts folded.
 */
export function readFolded(surveyId: string): string[] | null {
  try {
    const raw = storage()?.getItem(foldKey(surveyId));
    if (raw == null) return null;
    const saved: unknown = JSON.parse(raw);
    return Array.isArray(saved) ? saved.filter((x): x is string => typeof x === 'string') : null;
  } catch {
    return null;
  }
}

/** Remembers the folded blocks; an empty list is kept too, so "all unfolded" stays that way. */
export function writeFolded(surveyId: string, blockIds: string[]) {
  try {
    storage()?.setItem(foldKey(surveyId), JSON.stringify(blockIds));
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

/** Forgets the view of a survey deleted for good. */
export function forgetSurveyView(surveyId: string) {
  try {
    storage()?.removeItem(foldKey(surveyId));
  } catch {
    /* nothing to forget */
  }
}
