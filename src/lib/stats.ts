// Per-question summaries for the results page.

import { isEmpty, toNumber } from './engine';
import { scalePoints } from './questionTypes';
import type { Question, SurveyResponse } from './types';

export interface CountRow {
  id: string;
  label: string;
  code: number | string;
  n: number;
  pct: number;
}

export interface NumericStats {
  n: number;
  mean: number;
  median: number;
  sd: number;
  min: number;
  max: number;
}

export type Summary =
  | { kind: 'choice'; answered: number; rows: CountRow[]; others: string[]; multi: boolean }
  | { kind: 'scale'; answered: number; rows: CountRow[]; stats: NumericStats | null; nps?: { score: number; promoters: number; passives: number; detractors: number } }
  | { kind: 'numeric'; answered: number; stats: NumericStats | null; bins: CountRow[] }
  | { kind: 'matrix'; answered: number; columns: { id: string; label: string; code: number }[]; rows: { id: string; label: string; counts: number[]; n: number; mean: number | null }[] }
  | { kind: 'rank'; answered: number; items: { id: string; label: string; meanRank: number; firstPlace: number }[] }
  | { kind: 'sum'; answered: number; items: { id: string; label: string; mean: number }[] }
  | { kind: 'text'; answered: number; values: { id: string; text: string; at: string }[] }
  | { kind: 'none' };

export function numericStats(values: number[]): NumericStats | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const mean = sorted.reduce((a, b) => a + b, 0) / n;
  const median = n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
  const sd = n > 1 ? Math.sqrt(sorted.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) : 0;
  return { n, mean, median, sd, min: sorted[0], max: sorted[n - 1] };
}

const pct = (n: number, total: number) => (total ? (n / total) * 100 : 0);

function histogram(values: number[]): CountRow[] {
  if (!values.length) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const distinct = new Set(values);
  // Few distinct whole numbers: one bar per value. Otherwise, up to 10 equal-width bins.
  if (distinct.size <= 12 && values.every(Number.isInteger)) {
    return [...distinct]
      .sort((a, b) => a - b)
      .map((v) => {
        const n = values.filter((x) => x === v).length;
        return { id: String(v), label: String(v), code: v, n, pct: pct(n, values.length) };
      });
  }
  const bins = Math.min(10, distinct.size);
  const width = (max - min) / bins || 1;
  const rows: CountRow[] = [];
  for (let i = 0; i < bins; i++) {
    const lo = min + i * width;
    const hi = i === bins - 1 ? max : lo + width;
    const n = values.filter((x) => (i === bins - 1 ? x >= lo && x <= hi : x >= lo && x < hi)).length;
    const fmt = (x: number) => (Math.abs(x) >= 100 ? Math.round(x) : Math.round(x * 10) / 10);
    rows.push({ id: String(i), label: `${fmt(lo)} to ${fmt(hi)}`, code: i, n, pct: pct(n, values.length) });
  }
  return rows;
}

export function summarize(q: Question, responses: SurveyResponse[]): Summary {
  const answers = responses.map((r) => ({ r, v: r.answers[q.id] })).filter((x) => !isEmpty(x.v));
  const answered = answers.length;
  switch (q.type) {
    case 'text_block':
      return { kind: 'none' };
    case 'single_choice':
    case 'dropdown':
    case 'consent':
    case 'multi_choice': {
      const multi = q.type === 'multi_choice';
      const rows = (q.choices ?? []).map((c) => {
        const n = answers.filter(({ v }) => (multi ? Array.isArray(v) && v.includes(c.id) : v === c.id)).length;
        return { id: c.id, label: c.label, code: c.code, n, pct: pct(n, answered) };
      });
      const others = responses.map((r) => r.otherText?.[q.id]).filter((s): s is string => !!s);
      return { kind: 'choice', answered, rows, others, multi };
    }
    case 'rating_scale':
    case 'nps': {
      const values = answers.map(({ v }) => toNumber(v)).filter((n): n is number => n !== null);
      const pts = q.type === 'nps' ? Array.from({ length: 11 }, (_, i) => ({ value: i, label: '' })) : scalePoints(q);
      const rows = pts.map((p) => {
        const n = values.filter((x) => x === p.value).length;
        return { id: String(p.value), label: p.label ? `${p.value} · ${p.label}` : String(p.value), code: p.value, n, pct: pct(n, values.length) };
      });
      const out: Summary = { kind: 'scale', answered, rows, stats: numericStats(values) };
      if (q.type === 'nps' && values.length) {
        const promoters = values.filter((x) => x >= 9).length;
        const detractors = values.filter((x) => x <= 6).length;
        const passives = values.length - promoters - detractors;
        out.nps = { score: Math.round(pct(promoters, values.length) - pct(detractors, values.length)), promoters, passives, detractors };
      }
      return out;
    }
    case 'slider':
    case 'number': {
      const values = answers.map(({ v }) => toNumber(v)).filter((n): n is number => n !== null);
      return { kind: 'numeric', answered, stats: numericStats(values), bins: histogram(values) };
    }
    case 'matrix': {
      const columns = (q.columns ?? []).map((c) => ({ id: c.id, label: c.label, code: c.code }));
      const rows = (q.rows ?? []).map((row) => {
        const picked = answers.map(({ v }) => (v && typeof v === 'object' ? (v as Record<string, string>)[row.id] : undefined)).filter(Boolean);
        const counts = columns.map((c) => picked.filter((p) => p === c.id).length);
        const codes = picked.map((p) => columns.find((c) => c.id === p)?.code).filter((x): x is number => typeof x === 'number');
        return { id: row.id, label: row.label, counts, n: picked.length, mean: codes.length ? codes.reduce((a, b) => a + b, 0) / codes.length : null };
      });
      return { kind: 'matrix', answered, columns, rows };
    }
    case 'rank': {
      const items = (q.choices ?? []).map((c) => {
        const positions = answers.map(({ v }) => (Array.isArray(v) ? v.indexOf(c.id) : -1)).filter((i) => i >= 0);
        const meanRank = positions.length ? positions.reduce((a, b) => a + b + 1, 0) / positions.length : 0;
        return { id: c.id, label: c.label, meanRank, firstPlace: positions.filter((i) => i === 0).length };
      });
      items.sort((a, b) => a.meanRank - b.meanRank);
      return { kind: 'rank', answered, items };
    }
    case 'constant_sum': {
      const items = (q.choices ?? []).map((c) => {
        const vals = answers.map(({ v }) => (v && typeof v === 'object' ? (toNumber((v as Record<string, number>)[c.id]) ?? 0) : 0));
        return { id: c.id, label: c.label, mean: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0 };
      });
      return { kind: 'sum', answered, items };
    }
    case 'short_text':
    case 'long_text':
    case 'date':
      return {
        kind: 'text',
        answered,
        values: answers
          .map(({ r, v }) => ({ id: r.id, text: String(v), at: r.meta?.submittedAt || r.createdAt }))
          .sort((a, b) => (a.at < b.at ? 1 : -1)),
      };
  }
}

export function median(values: number[]): number | null {
  const s = numericStats(values);
  return s ? s.median : null;
}
