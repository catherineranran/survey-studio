import { describe, expect, it } from 'vitest';
import { buildColumns, codebookRows, csvCell, responsesToCSV, spssSyntax } from './export';
import { summarize } from './stats';
import { TEMPLATES } from './templates';
import type { Survey, SurveyResponse } from './types';

const survey = TEMPLATES.find((t) => t.id === 'study')!.build('s1');
const qv = (s: Survey, v: string) => s.blocks.flatMap((b) => b.questions).find((q) => q.variable === v)!;

function response(answers: Record<string, unknown>, extra: Partial<SurveyResponse> = {}): SurveyResponse {
  return {
    id: 'r1',
    surveyId: 's1',
    createdAt: '2026-10-05T10:00:00.000Z',
    answers: answers as SurveyResponse['answers'],
    otherText: {},
    embedded: {},
    meta: {
      status: 'complete',
      startedAt: '2026-10-05T09:55:00.000Z',
      submittedAt: '2026-10-05T10:00:00.000Z',
      durationSec: 300,
      pageTimes: {},
      blockOrder: [],
      seed: 1,
      language: 'en',
      userAgent: 'test',
      preview: false,
      surveyVersion: null,
    },
    ...extra,
  };
}

describe('columns', () => {
  it('creates dummies for checkboxes and one column per matrix row', () => {
    const names = buildColumns(survey, { values: 'codes', includePreview: false, includeTimings: false }).map((c) => c.name);
    expect(names).toContain('devices_1');
    expect(names).toContain('devices_0');
    expect(names).toContain('att_1');
    expect(names).toContain('att_4');
    expect(names).toContain('gender_other');
    expect(names).not.toContain('consent_other');
    expect(new Set(names.map((n) => n.toLowerCase())).size).toBe(names.length);
  });

  it('exports codes or labels', () => {
    const gender = qv(survey, 'gender');
    const devices = qv(survey, 'devices');
    const att = qv(survey, 'att');
    const r = response({
      [gender.id]: gender.choices![1].id,
      [devices.id]: [devices.choices![0].id],
      [att.id]: { [att.rows![0].id]: att.columns![4].id },
    });
    const codes = responsesToCSV(survey, [r], { values: 'codes', includePreview: false, includeTimings: false, dialect: 'standard' });
    const [header, row] = codes.replace('﻿', '').trim().split('\r\n');
    const cells = Object.fromEntries(header.split(',').map((h, i) => [h, row.split(',')[i]]));
    expect(cells.gender).toBe('2');
    expect(cells.devices_1).toBe('1');
    expect(cells.devices_2).toBe('0');
    expect(cells.att_1).toBe('5');
    expect(cells.att_2).toBe('');
    expect(cells.age).toBe('');
    const labels = responsesToCSV(survey, [r], { values: 'labels', includePreview: false, includeTimings: false, dialect: 'standard' });
    expect(labels).toContain('Man');
    expect(labels).toContain('Strongly agree');
  });

  it('leaves preview responses out unless asked', () => {
    const r = response({}, { meta: { ...response({}).meta, preview: true } });
    const out = responsesToCSV(survey, [r], { values: 'codes', includePreview: false, includeTimings: false, dialect: 'standard' });
    expect(out.trim().split('\r\n')).toHaveLength(1);
  });
});

describe('csv cells', () => {
  it('quotes and neutralises formulas', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('-12')).toBe('-12');
    expect(csvCell(3.5, 'excel_de')).toBe('3,5');
    expect(csvCell('a;b', 'excel_de')).toBe('"a;b"');
  });
});

describe('codebook and syntax', () => {
  it('lists value labels', () => {
    const rows = codebookRows(survey, { values: 'codes', includePreview: false, includeTimings: false });
    const gender = rows.find((r) => r[0] === 'gender')!;
    expect(gender[3]).toContain('1 = Woman');
    expect(gender[3]).toContain('99 = I prefer not to say');
  });
  it('writes SPSS labels', () => {
    const sps = spssSyntax(survey, { includePreview: false, includeTimings: false });
    expect(sps).toContain('VARIABLE LABELS');
    expect(sps).toContain("gender 1 'Woman'");
    expect(sps).toContain('VALUE LABELS');
    expect(sps.trim().endsWith('EXECUTE.')).toBe(true);
  });
});

describe('summaries', () => {
  it('counts choices and computes scale statistics', () => {
    const gender = qv(survey, 'gender');
    const rs = [response({ [gender.id]: gender.choices![0].id }), response({ [gender.id]: gender.choices![0].id }), response({ [gender.id]: gender.choices![1].id })];
    const sum = summarize(gender, rs);
    expect(sum.kind).toBe('choice');
    if (sum.kind === 'choice') {
      expect(sum.rows[0].n).toBe(2);
      expect(Math.round(sum.rows[0].pct)).toBe(67);
    }
    const hours = qv(survey, 'screen_hours');
    const hs = summarize(hours, [response({ [hours.id]: 2 }), response({ [hours.id]: 4 }), response({ [hours.id]: 9 })]);
    expect(hs.kind).toBe('numeric');
    if (hs.kind === 'numeric') {
      expect(hs.stats?.mean).toBe(5);
      expect(hs.stats?.median).toBe(4);
    }
  });
});

describe('video questions', () => {
  it('export seconds played, whether it ended, where people looked and problems', async () => {
    const { createQuestion } = await import('./questionTypes');
    const { blankSurvey } = await import('./templates');
    const s = blankSurvey('v1');
    const q = { ...createQuestion('video', s), variable: 'clip' };
    s.blocks[0].questions = [q];
    const cols = buildColumns(s, { values: 'codes', includePreview: false, includeTimings: false });
    const names = cols.map((c) => c.name);
    expect(names).toEqual(expect.arrayContaining(['clip_sec', 'clip_end', 'clip_look', 'clip_error']));
    const r = {
      id: 'r1',
      surveyId: 'v1',
      createdAt: '2026-10-12T10:00:00Z',
      answers: { [q.id]: { sec: 88.4, end: true, look: [[0, 0], [12.5, -3], null] } },
      otherText: {},
      embedded: {},
      meta: { status: 'complete' },
    } as unknown as Parameters<(typeof cols)[number]['get']>[0];
    const row = Object.fromEntries(cols.map((c) => [c.name, c.get(r)]));
    expect(row.clip_sec).toBe(88.4);
    expect(row.clip_end).toBe(1);
    expect(JSON.parse(String(row.clip_look))).toEqual([[0, 0], [12.5, -3], null]);
    expect(row.clip_error).toBeNull();
    const csv = responsesToCSV(s, [r], { values: 'labels', includePreview: false, includeTimings: false, dialect: 'standard' });
    expect(csv).toContain('Watched to the end');
  });
});

describe('page breaks', () => {
  it('add no columns, and time on every page of a block adds up', async () => {
    const { createQuestion } = await import('./questionTypes');
    const { blankSurvey } = await import('./templates');
    const s = blankSurvey('p1');
    const b = s.blocks[0];
    const brk = createQuestion('page_break', s);
    b.questions.push(brk, { ...createQuestion('short_text', s), variable: 'later' });
    const plain = buildColumns(s, { values: 'codes', includePreview: false, includeTimings: false }).map((c) => c.name);
    expect(plain).toEqual(expect.arrayContaining(['Q1', 'later']));
    expect(plain.some((n) => n === '' || n.startsWith('_'))).toBe(false);
    const cols = buildColumns(s, { values: 'codes', includePreview: false, includeTimings: true });
    const time = cols.find((c) => c.type === 'Timing')!;
    const r = response({}, {});
    r.meta = { ...r.meta!, pageTimes: { [b.id]: 12, [`${b.id}:${brk.id}`]: 8.5 }, path: [b.id, `${b.id}:${brk.id}`] };
    expect(time.get(r)).toBe(20.5);
    expect(summarize(brk, [r])).toEqual({ kind: 'none' });
  });
});
