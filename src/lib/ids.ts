import type { Survey } from './types';

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** Short random id, e.g. `q_k3v9x0ab`. Unique enough within one survey. */
export function uid(prefix = ''): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return prefix ? `${prefix}_${out}` : out;
}

/** UUID v4 for records stored in a database. */
export function uuid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Variable names that work in SPSS, R, Stata and spreadsheets. */
export const VARIABLE_RE = /^[A-Za-z][A-Za-z0-9_]{0,31}$/;

export function allVariables(survey: Survey, exceptQuestionId?: string): Set<string> {
  const names = new Set<string>();
  for (const b of survey.blocks)
    for (const q of b.questions) if (q.id !== exceptQuestionId && q.variable) names.add(q.variable.toLowerCase());
  for (const p of survey.urlParams) names.add(p.name.toLowerCase());
  for (const r of survey.randomizers) names.add(r.variable.toLowerCase());
  return names;
}

/** Smallest unused Q-number: Q1, Q2, ... */
export function nextVariable(survey: Survey, base = 'Q'): string {
  const used = allVariables(survey);
  for (let i = 1; ; i++) {
    const name = `${base}${i}`;
    if (!used.has(name.toLowerCase())) return name;
  }
}

/** Turns free text into a valid variable name ("Prolific ID" -> "prolific_id"). */
export function toVariable(text: string, fallback = 'var'): string {
  let v = text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32);
  if (!v) v = fallback;
  if (!/^[A-Za-z]/.test(v)) v = `v_${v}`.slice(0, 32);
  return v;
}

export function variableError(survey: Survey, name: string, questionId?: string): string | null {
  if (!name) return 'Give this question a variable name.';
  if (!VARIABLE_RE.test(name))
    return 'Use letters, digits and underscores, starting with a letter (max 32 characters).';
  if (allVariables(survey, questionId).has(name.toLowerCase())) return `“${name}” is already used.`;
  return null;
}
