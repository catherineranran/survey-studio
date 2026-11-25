// Prolific. Participants arrive with ?PROLIFIC_PID=…&STUDY_ID=…&SESSION_ID=… (declared URL
// parameters, so they're stored with each response) and leave through Prolific's completion
// link, https://app.prolific.com/submissions/complete?cc=<code>, with one code per way the
// survey can end. Prolific acts on the code: approve and pay, hold for review, request a
// return, screen out. The codes are kept apart from the survey (Backend.getCompletionCodes),
// so nobody finds them in the published survey; a respondent's browser gets the link for
// its ending from the backend after its response is stored (Backend.completionLink).

import type { Survey } from './types';

export const PROLIFIC_PARAMS = ['PROLIFIC_PID', 'STUDY_ID', 'SESSION_ID'] as const;
export const PROLIFIC_COMPLETE_URL = 'https://app.prolific.com/submissions/complete?cc=';
/** What schema.sql accepts as a code, too. */
export const COMPLETION_CODE_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** Prolific completion codes by ending: 'complete', 'declined_consent' or a skip-logic end tag. */
export type CompletionCodes = Record<string, string>;

export const usesProlific = (s: Survey) => s.urlParams.some((p) => p.name === 'PROLIFIC_PID');

/** The study URL to paste into Prolific; Prolific fills in the {{%…%}} parts for each participant. */
export const prolificStudyUrl = (surveyLink: string) =>
  `${surveyLink}${surveyLink.includes('?') ? '&' : '?'}${PROLIFIC_PARAMS.map((p) => `${p}={{%${p}%}}`).join('&')}`;

export const completionUrl = (code: string) => PROLIFIC_COMPLETE_URL + code;

/**
 * A completion code as typed or pasted: the code itself, or Prolific's whole completion link.
 * '' for nothing, null for something that isn't a code.
 */
export function parseCompletionCode(input: string): string | null {
  const t = input.trim();
  if (!t) return '';
  const fromLink = /[?&]cc=([^&#\s]+)/i.exec(t);
  let code = t;
  if (fromLink) {
    try {
      code = decodeURIComponent(fromLink[1]);
    } catch {
      return null;
    }
  }
  return COMPLETION_CODE_RE.test(code) ? code : null;
}

export interface Ending {
  /** The response status this ending records, and the key of its code. */
  key: string;
  label: string;
  detail: string;
}

const plain = (s: string) => s.replace(/\*\*|\*|`/g, '').trim();
const named = (title: string) => `“${plain(title) || 'Untitled block'}”`;

/** The ways a survey can end, each of which can send people back with its own code. */
export function surveyEndings(s: Survey): Ending[] {
  const out: Ending[] = [{ key: 'complete', label: 'Finished the survey', detail: 'Everyone who reaches the end.' }];
  const declines: string[] = [];
  let declineLabel = '';
  const tags = new Map<string, string[]>();
  for (const b of s.blocks) {
    for (const q of b.questions) {
      if (q.type !== 'consent' || q.endOnDecline === false || (q.choices?.length ?? 0) < 2) continue;
      declines.push(named(b.title));
      declineLabel ||= plain(q.choices![1].label);
    }
    for (const br of b.branches) {
      const tag = br.endTag?.trim();
      if (br.target !== 'end' || !tag || tag === 'complete') continue;
      tags.set(tag, [...(tags.get(tag) ?? []), named(b.title)]);
    }
  }
  if (declines.length)
    out.push({
      key: 'declined_consent',
      label: 'Declined consent',
      detail: `Chose ${declineLabel ? `“${declineLabel}”` : 'not to consent'} in ${declines.join(', ')}. Their answers aren’t kept.`,
    });
  for (const [tag, blocks] of tags) out.push({ key: tag, label: `Ending “${tag}”`, detail: `Skip logic in ${blocks.join(', ')} ends the survey here.` });
  return out;
}

export interface VisibleCode {
  /** Where the link is, for messages. */
  where: string;
  /** The ending it belongs to. */
  ending: string;
  code: string;
  /** Takes the link out of the survey (a draft to change). */
  remove: (draft: Survey) => void;
}

const VISIBLE_RE = /prolific\.(?:com|co)\/submissions\/complete\?(?:[^#\s]*&)?cc=([^&#\s]+)/i;

/** Prolific completion links written into the survey itself, where anyone can read them. */
export function visibleCompletionCodes(s: Survey): VisibleCode[] {
  const out: VisibleCode[] = [];
  const m = VISIBLE_RE.exec(s.settings.redirectUrl ?? '');
  if (m)
    out.push({
      where: 'The redirect after finishing (Settings)',
      ending: 'complete',
      code: m[1],
      remove: (d) => void (d.settings.redirectUrl = ''),
    });
  for (const b of s.blocks)
    for (const br of b.branches) {
      const hit = br.target === 'end' && VISIBLE_RE.exec(br.endRedirect ?? '');
      if (!hit) continue;
      out.push({
        where: `The skip logic ending in ${named(b.title)}`,
        ending: br.endTag?.trim() || 'complete',
        code: hit[1],
        remove: (d) => {
          const x = d.blocks.find((y) => y.id === b.id)?.branches.find((y) => y.id === br.id);
          if (x) x.endRedirect = undefined;
        },
      });
    }
  return out;
}
