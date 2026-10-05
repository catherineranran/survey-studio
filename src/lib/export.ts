// Turns responses into analysis-ready files: wide CSV (labels or numeric codes),
// a codebook, SPSS label syntax and raw JSON.

import { allQuestions, isEmpty, toNumber } from './engine';
import { toVariable } from './ids';
import { TYPE_INFO } from './questionTypes';
import type { Choice, Question, Survey, SurveyResponse } from './types';

export type ValueMode = 'labels' | 'codes';
export type CsvDialect = 'standard' | 'excel_de';

export interface ExportOptions {
  values: ValueMode;
  includePreview: boolean;
  includeTimings: boolean;
  dialect: CsvDialect;
}

export const DEFAULT_EXPORT: ExportOptions = { values: 'codes', includePreview: false, includeTimings: false, dialect: 'standard' };

type Cell = string | number | null;

export interface Column {
  name: string;
  label: string;
  type: string;
  values?: { code: number; label: string }[];
  notes?: string;
  get: (r: SurveyResponse) => Cell;
}

function choiceValues(list?: Choice[]) {
  return (list ?? []).map((c) => ({ code: c.code, label: c.label }));
}

/** Column suffix for a code: -99 becomes m99, so the column name stays valid. */
function suffix(code: number): string {
  return String(code).replace('-', 'm').replace('.', '_');
}

function plainTitle(q: Question): string {
  return q.title.replace(/\s+/g, ' ').trim();
}

export function questionColumns(q: Question, mode: ValueMode): Column[] {
  const v = q.variable;
  const title = plainTitle(q);
  const type = TYPE_INFO[q.type].label;
  const a = (r: SurveyResponse) => r.answers[q.id];
  const pick = (list: Choice[] | undefined, id: unknown): Cell => {
    const c = list?.find((x) => x.id === id);
    if (!c) return null;
    return mode === 'codes' ? c.code : c.label;
  };
  const otherCol: Column[] = q.choices?.some((c) => c.other)
    ? [{ name: `${v}_other`, label: `${title} (other, specified)`, type: 'Text', get: (r) => r.otherText?.[q.id] ?? null }]
    : [];

  switch (q.type) {
    case 'text_block':
      return [];
    case 'single_choice':
    case 'dropdown':
    case 'consent':
      return [{ name: v, label: title, type, values: choiceValues(q.choices), get: (r) => pick(q.choices, a(r)) }, ...otherCol];
    case 'multi_choice': {
      if (mode === 'labels') {
        return [
          {
            name: v,
            label: title,
            type,
            notes: 'Selected options, separated by "; "',
            get: (r) => {
              const arr = a(r);
              if (!Array.isArray(arr) || !arr.length) return null;
              return arr.map((id) => q.choices?.find((c) => c.id === id)?.label ?? '').filter(Boolean).join('; ');
            },
          },
          ...otherCol,
        ];
      }
      return [
        ...(q.choices ?? []).map<Column>((c) => ({
          name: `${v}_${suffix(c.code)}`,
          label: `${title}: ${c.label}`,
          type,
          values: [
            { code: 1, label: 'Selected' },
            { code: 0, label: 'Not selected' },
          ],
          notes: 'Empty when the question was not shown',
          get: (r) => {
            const arr = a(r);
            if (!Array.isArray(arr)) return null;
            return arr.includes(c.id) ? 1 : 0;
          },
        })),
        ...otherCol,
      ];
    }
    case 'matrix':
      return (q.rows ?? []).map<Column>((row) => ({
        name: `${v}_${suffix(row.code)}`,
        label: `${title}: ${row.label}`,
        type,
        values: choiceValues(q.columns),
        get: (r) => pick(q.columns, (a(r) as Record<string, string> | undefined)?.[row.id]),
      }));
    case 'rank':
      return (q.choices ?? []).map<Column>((c) => ({
        name: `${v}_${suffix(c.code)}`,
        label: `${title}: ${c.label}`,
        type,
        notes: 'Rank position, 1 = top',
        get: (r) => {
          const arr = a(r);
          if (!Array.isArray(arr)) return null;
          const i = arr.indexOf(c.id);
          return i < 0 ? null : i + 1;
        },
      }));
    case 'constant_sum':
      return (q.choices ?? []).map<Column>((c) => ({
        name: `${v}_${suffix(c.code)}`,
        label: `${title}: ${c.label}`,
        type,
        notes: `Points allocated (target total ${q.validation?.total ?? 100})`,
        get: (r) => {
          const rec = a(r) as Record<string, number> | undefined;
          if (!rec) return null;
          return toNumber(rec[c.id]) ?? 0;
        },
      }));
    case 'rating_scale': {
      const s = q.scale ?? { min: 1, max: 5 };
      const values = [];
      for (let x = s.min, i = 0; x <= s.max; x++, i++) {
        const label = s.pointLabels?.[i] || (x === s.min ? s.minLabel : x === s.max ? s.maxLabel : '') || '';
        values.push({ code: x, label });
      }
      return [
        {
          name: v,
          label: title,
          type,
          values: values.filter((x) => x.label),
          get: (r) => {
            const n = toNumber(a(r));
            if (n === null) return null;
            if (mode === 'labels') return s.pointLabels?.[n - s.min] || n;
            return n;
          },
        },
      ];
    }
    case 'nps':
    case 'slider':
    case 'number':
      return [{ name: v, label: title, type, get: (r) => toNumber(a(r)) }];
    case 'short_text':
    case 'long_text':
    case 'date':
      return [{ name: v, label: title, type, get: (r) => (isEmpty(a(r)) ? null : String(a(r))) }];
  }
}

export const SYSTEM_COLUMNS = ['response_id', 'submitted_at', 'started_at', 'duration_sec', 'status', 'preview'];

export function buildColumns(survey: Survey, opts: Pick<ExportOptions, 'values' | 'includePreview' | 'includeTimings'>, dedupe = true): Column[] {
  const cols: Column[] = [
    { name: 'response_id', label: 'Response ID', type: 'System', get: (r) => r.id },
    { name: 'submitted_at', label: 'Submitted at (UTC, server time)', type: 'System', get: (r) => r.createdAt || r.meta?.submittedAt || null },
    { name: 'started_at', label: 'Started at (UTC)', type: 'System', get: (r) => r.meta?.startedAt ?? null },
    { name: 'duration_sec', label: 'Time from start to submit, in seconds', type: 'System', get: (r) => r.meta?.durationSec ?? null },
    {
      name: 'status',
      label: 'How the survey ended',
      type: 'System',
      notes: '"complete", "declined_consent", or the end tag of a skip-logic rule',
      get: (r) => r.meta?.status ?? 'complete',
    },
  ];
  if (opts.includePreview) cols.push({ name: 'preview', label: 'Test response from preview', type: 'System', values: [{ code: 1, label: 'Preview' }, { code: 0, label: 'Live' }], get: (r) => (r.meta?.preview ? 1 : 0) });
  for (const p of survey.urlParams) cols.push({ name: p.name, label: `URL parameter ${p.name}`, type: 'URL parameter', get: (r) => r.embedded?.[p.name] ?? null });
  for (const z of survey.randomizers)
    cols.push({ name: z.variable, label: 'Randomizer: block(s) shown', type: 'Randomizer', notes: 'Block titles, separated by "|"', get: (r) => r.embedded?.[z.variable] ?? null });
  for (const q of allQuestions(survey)) cols.push(...questionColumns(q, opts.values));
  if (opts.includeTimings) {
    for (const b of survey.blocks) {
      cols.push({
        name: `time_${toVariable(b.title, 'block')}`,
        label: `Seconds spent in block “${b.title}”`,
        type: 'Timing',
        get: (r) => {
          const pt = r.meta?.pageTimes ?? {};
          const onPath = r.meta?.path ? new Set(r.meta.path) : null;
          let total = 0;
          let seen = false;
          for (const [k, s] of Object.entries(pt)) {
            if (onPath && !onPath.has(k)) continue; // time on pages the respondent backed out of
            if (k === b.id || k.startsWith(`${b.id}:`)) {
              total += s;
              seen = true;
            }
          }
          return seen ? Math.round(total * 10) / 10 : null;
        },
      });
    }
  }
  if (!dedupe) return cols;
  // Column names must be unique for analysis software (the survey checker reports clashes).
  const taken = new Set<string>();
  for (const c of cols) {
    let name = c.name;
    for (let k = 2; taken.has(name.toLowerCase()); k++) name = `${c.name}_${k}`;
    taken.add(name.toLowerCase());
    c.name = name;
  }
  return cols;
}

export function filterResponses(responses: SurveyResponse[], includePreview: boolean): SurveyResponse[] {
  return includePreview ? responses : responses.filter((r) => !r.meta?.preview);
}

/** One CSV cell. Guards against spreadsheet formula injection in free-text answers. */
export function csvCell(v: Cell, dialect: CsvDialect = 'standard'): string {
  if (v === null || v === undefined) return '';
  let s: string;
  if (typeof v === 'number') {
    s = String(v);
    if (dialect === 'excel_de') s = s.replace('.', ',');
  } else {
    s = typeof v === 'string' ? v : JSON.stringify(v);
    if (/^[=+\-@\t\r]/.test(s) && toNumber(s) === null) s = `'${s}`;
  }
  const sep = dialect === 'excel_de' ? ';' : ',';
  if (s.includes(sep) || /["\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCSV(rows: Cell[][], dialect: CsvDialect = 'standard'): string {
  const sep = dialect === 'excel_de' ? ';' : ',';
  // The BOM makes Excel read UTF-8 (umlauts, accents) correctly.
  return '﻿' + rows.map((r) => r.map((c) => csvCell(c, dialect)).join(sep)).join('\r\n') + '\r\n';
}

export function responsesTable(survey: Survey, responses: SurveyResponse[], opts: ExportOptions): { columns: Column[]; rows: Cell[][] } {
  const columns = buildColumns(survey, opts);
  const rows = filterResponses(responses, opts.includePreview).map((r) => columns.map((c) => c.get(r)));
  return { columns, rows };
}

export function responsesToCSV(survey: Survey, responses: SurveyResponse[], opts: ExportOptions): string {
  const { columns, rows } = responsesTable(survey, responses, opts);
  return toCSV([columns.map((c) => c.name), ...rows], opts.dialect);
}

/* ---------------------------------------------------------------- codebook */

export function codebookRows(survey: Survey, opts: Pick<ExportOptions, 'values' | 'includePreview' | 'includeTimings'>): string[][] {
  const cols = buildColumns(survey, opts);
  return [
    ['variable', 'label', 'type', 'values', 'notes'],
    ...cols.map((c) => [c.name, c.label, c.type, (c.values ?? []).map((x) => `${x.code} = ${x.label}`).join('; '), c.notes ?? '']),
  ];
}

export function codebookCSV(survey: Survey, opts: ExportOptions): string {
  return toCSV(codebookRows(survey, opts), opts.dialect);
}

export function codebookMarkdown(survey: Survey, opts: Pick<ExportOptions, 'values' | 'includePreview' | 'includeTimings'>): string {
  const rows = codebookRows(survey, opts);
  const esc = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
  const lines = [
    `# Codebook: ${survey.title}`,
    '',
    `Generated by Survey Studio on ${new Date().toISOString().slice(0, 10)}. Values are exported as ${opts.values === 'codes' ? 'numeric codes' : 'labels'}.`,
    '',
    `| ${rows[0].join(' | ')} |`,
    `| ${rows[0].map(() => '---').join(' | ')} |`,
    ...rows.slice(1).map((r) => `| ${r.map(esc).join(' | ')} |`),
    '',
  ];
  return lines.join('\n');
}

/** SPSS syntax that applies variable and value labels after importing the CSV with numeric codes. */
export function spssSyntax(survey: Survey, opts: Pick<ExportOptions, 'includePreview' | 'includeTimings'>): string {
  const cols = buildColumns(survey, { ...opts, values: 'codes' });
  const q = (s: string) => `'${s.replace(/\s+/g, ' ').slice(0, 240).replace(/'/g, "''")}'`;
  const out = [`* SPSS labels for "${survey.title.replace(/"/g, "'")}", generated by Survey Studio.`, '* Import the CSV exported with numeric codes first, then run this syntax.', ''];
  out.push('VARIABLE LABELS');
  out.push('  ' + cols.map((c) => `${c.name} ${q(c.label)}`).join('\n  /') + '.');
  const withValues = cols.filter((c) => c.values?.length);
  if (withValues.length) {
    out.push('', 'VALUE LABELS');
    out.push('  ' + withValues.map((c) => `${c.name} ${c.values!.map((v) => `${v.code} ${q(v.label)}`).join(' ')}`).join('\n  /') + '.');
  }
  out.push('EXECUTE.', '');
  return out.join('\n');
}

export function responsesJSON(survey: Survey, responses: SurveyResponse[], includePreview: boolean): string {
  return JSON.stringify({ survey, responses: filterResponses(responses, includePreview), exportedAt: new Date().toISOString() }, null, 2);
}

export function fileSlug(title: string): string {
  return (
    title
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 50) || 'survey'
  );
}
