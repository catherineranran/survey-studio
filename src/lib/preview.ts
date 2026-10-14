// The preview runs in its own window. The builder hands it the working copy through
// localStorage (same origin), which also lets the preview notice later edits.

import { normalizeSurvey } from './templates';
import type { Survey } from './types';

const draftKey = (id: string) => `survey-studio.preview.${id}`;
const OPTIONS_KEY = 'survey-studio.preview-options';

export interface PreviewPrefs {
  skipRequired: boolean;
  device: 'desktop' | 'phone';
}

export function isPreviewDraftKey(key: string | null, id: string): boolean {
  return key === draftKey(id);
}

export function writePreviewDraft(id: string, survey: Survey) {
  try {
    window.localStorage.setItem(draftKey(id), JSON.stringify(survey));
  } catch {
    /* storage full or blocked: the preview falls back to the last saved draft */
  }
}

export function parsePreviewDraft(raw: string | null, id: string): Survey | null {
  if (!raw) return null;
  try {
    return normalizeSurvey(JSON.parse(raw), id);
  } catch {
    return null;
  }
}

export function readPreviewDraft(id: string): Survey | null {
  try {
    return parsePreviewDraft(window.localStorage.getItem(draftKey(id)), id);
  } catch {
    return null;
  }
}

export function readPreviewPrefs(): PreviewPrefs {
  const prefs: PreviewPrefs = { skipRequired: true, device: 'desktop' };
  try {
    const saved = JSON.parse(window.localStorage.getItem(OPTIONS_KEY) ?? '{}') as Partial<PreviewPrefs>;
    if (typeof saved.skipRequired === 'boolean') prefs.skipRequired = saved.skipRequired;
    if (saved.device === 'phone' || saved.device === 'desktop') prefs.device = saved.device;
  } catch {
    /* defaults */
  }
  return prefs;
}

export function writePreviewPrefs(prefs: PreviewPrefs) {
  try {
    window.localStorage.setItem(OPTIONS_KEY, JSON.stringify(prefs));
  } catch {
    /* not remembered */
  }
}

/**
 * Hash route of the preview window, optionally starting at a block. Opened from a
 * collaborator link, it goes through the link (#/shared/<token>/preview), which needs no account.
 */
export function previewHash(id: string, fromBlockId?: string, nonce?: string, shareToken?: string): string {
  const q = new URLSearchParams();
  if (fromBlockId) q.set('from', fromBlockId);
  if (nonce) q.set('t', nonce);
  const qs = q.toString();
  const base = shareToken ? `#/shared/${encodeURIComponent(shareToken)}` : `#/s/${encodeURIComponent(id)}`;
  return `${base}/preview${qs ? `?${qs}` : ''}`;
}

export function previewWindowName(id: string): string {
  return `survey-studio-preview-${id.replace(/\W/g, '_')}`;
}

/** Query parameters of the hash route (#/s/x/preview?from=…). */
export function hashQuery(): URLSearchParams {
  const h = window.location.hash;
  const i = h.indexOf('?');
  return new URLSearchParams(i >= 0 ? h.slice(i + 1) : '');
}
