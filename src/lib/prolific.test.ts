import { describe, expect, it } from 'vitest';
import { lintSurvey } from './lint';
import { parseCompletionCode, prolificStudyUrl, surveyEndings, usesProlific, visibleCompletionCodes } from './prolific';
import { createQuestion } from './questionTypes';
import { blankSurvey, newBlock } from './templates';
import type { Survey } from './types';

/** Consent → Questions (screens people out) → Debrief (asks again about data use). */
function study(): Survey {
  const s = blankSurvey('s', 'Study');
  s.blocks = [];
  for (const title of ['Consent', 'Questions', 'Debrief']) s.blocks.push(newBlock(s, title));
  const [consent, questions, debrief] = s.blocks;
  consent.questions.push({ ...createQuestion('consent', s), variable: 'consent' });
  questions.questions.push({ ...createQuestion('single_choice', s), variable: 'q1' });
  questions.branches.push({ id: 'br1', logic: { match: 'all', conditions: [] }, target: 'end', endTag: 'screened_out' });
  questions.branches.push({ id: 'br2', logic: { match: 'all', conditions: [] }, target: 'end' });
  debrief.questions.push({ ...createQuestion('consent', s), variable: 'data_use' });
  s.urlParams = [{ id: 'p1', name: 'PROLIFIC_PID', required: false }];
  return s;
}

describe('Prolific', () => {
  it('reads codes as typed or as Prolific’s whole completion link', () => {
    expect(parseCompletionCode(' C1A2B3C4 ')).toBe('C1A2B3C4');
    expect(parseCompletionCode('https://app.prolific.com/submissions/complete?cc=C1A2B3C4')).toBe('C1A2B3C4');
    expect(parseCompletionCode('https://app.prolific.co/submissions/complete?foo=1&cc=NOCONSENT#x')).toBe('NOCONSENT');
    expect(parseCompletionCode('')).toBe('');
    expect(parseCompletionCode('two words')).toBeNull();
    expect(parseCompletionCode('https://app.prolific.com/studies')).toBeNull();
  });

  it('makes the study link Prolific fills in', () => {
    expect(prolificStudyUrl('https://x.test/survey-studio/?s=abc')).toBe(
      'https://x.test/survey-studio/?s=abc&PROLIFIC_PID={{%PROLIFIC_PID%}}&STUDY_ID={{%STUDY_ID%}}&SESSION_ID={{%SESSION_ID%}}',
    );
    expect(usesProlific(study())).toBe(true);
    expect(usesProlific(blankSurvey('t'))).toBe(false);
  });

  it('lists each way a survey can end, once', () => {
    const endings = surveyEndings(study());
    expect(endings.map((e) => e.key)).toEqual(['complete', 'declined_consent', 'screened_out']);
    expect(endings[1].detail).toContain('“Consent”, “Debrief”');
    expect(endings[2].detail).toContain('“Questions”');
    expect(surveyEndings(blankSurvey('t')).map((e) => e.key)).toEqual(['complete']);
  });

  it('finds completion codes written into the survey, warns about them, and takes them out', () => {
    const s = study();
    s.settings.redirectUrl = 'https://app.prolific.com/submissions/complete?cc=C1A2B3C4';
    s.blocks[1].branches[0].endRedirect = 'https://app.prolific.com/submissions/complete?cc=SCREENED';
    const found = visibleCompletionCodes(s);
    expect(found.map((v) => [v.ending, v.code])).toEqual([
      ['complete', 'C1A2B3C4'],
      ['screened_out', 'SCREENED'],
    ]);
    expect(lintSurvey(s).filter((i) => /Prolific completion code/.test(i.message))).toHaveLength(2);
    for (const v of found) v.remove(s);
    expect(s.settings.redirectUrl).toBe('');
    expect(s.blocks[1].branches[0].endRedirect).toBeUndefined();
    expect(visibleCompletionCodes(s)).toEqual([]);
    expect(lintSurvey(s).some((i) => /Prolific completion code/.test(i.message))).toBe(false);
  });
});
