import { describe, expect, it } from 'vitest';
import { setBlockResponses } from '../lib/blocks';
import { makeParallel } from '../lib/flow';
import { createQuestion } from '../lib/questionTypes';
import { blankSurvey, newBlock } from '../lib/templates';
import type { Block, Survey } from '../lib/types';
import { layoutFlow, wrap, type Item, type Measure } from './flowImage';

// A stand-in for the browser's text measurement: every character is half the font size wide.
const measure: Measure = (text, font) => text.length * Number(/([\d.]+)px/.exec(font)![1]) * 0.5;

function study(): { s: Survey; b: Record<string, Block> } {
  const s = blankSurvey('s');
  s.title = 'Experiencing a social scenario';
  s.blocks = [];
  const b: Record<string, Block> = {};
  for (const name of ['Intro', 'Vignette', 'Video', 'Questions']) {
    const block = newBlock(s, name);
    block.questions.push({ ...createQuestion('single_choice', s), variable: `q_${name.toLowerCase()}` });
    s.blocks.push(block);
    b[name] = block;
  }
  makeParallel(s, b.Video.id, b.Vignette.id);
  return { s, b };
}

const texts = (items: Item[]) => items.filter((i): i is Extract<Item, { kind: 'text' }> => i.kind === 'text').map((i) => i.text);

describe('flowchart image', () => {
  it('wraps text to the width it has, breaking words that are too long', () => {
    const lines = wrap('Respondents must answer every question in this block', '400 10px x', 100, measure);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.every((l) => measure(l, '400 10px x') <= 100)).toBe(true);
    expect(lines.join(' ')).toBe('Respondents must answer every question in this block');
    expect(wrap('trait_general_self_efficacy_scale_total', '400 10px x', 60, measure).every((l) => l.length <= 12)).toBe(true);
    expect(wrap('', '400 10px x', 60, measure)).toEqual(['']);
  });

  it('draws the steps top to bottom, with randomizer branches side by side', () => {
    const { s, b } = study();
    const f = layoutFlow(s, measure, new Date(2026, 9, 13));
    const [intro, vignette, video, questions] = [b.Intro, b.Vignette, b.Video, b.Questions].map((x) => f.boxes[x.id]);
    expect(vignette.y).toBe(video.y);
    expect(vignette.x + vignette.w).toBeLessThan(video.x);
    expect(intro.y + intro.h).toBeLessThan(vignette.y);
    expect(questions.y).toBeGreaterThan(Math.max(vignette.y + vignette.h, video.y + video.h));
    // Everything fits on the canvas.
    for (const box of Object.values(f.boxes)) {
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.w).toBeLessThanOrEqual(f.width);
      expect(box.y + box.h).toBeLessThanOrEqual(f.height);
    }
    const t = texts(f.items);
    expect(t[0]).toBe('Experiencing a social scenario');
    expect(t).toContain('Start');
    expect(t[t.length - 2]).toBe('End');
    expect(t.some((x) => x.startsWith('Survey flow · 4 blocks · 4 questions · 13 October 2026'))).toBe(true);
    expect(t.some((x) => x.includes('Randomizer · saved as condition'))).toBe(true);
    expect(t.some((x) => x.includes('Each respondent gets 1 of 2 branches'))).toBe(true);
  });

  it('shows empty branches, page counts, forced responses and logic notes', () => {
    const { s, b } = study();
    s.randomizers[0].arms.push({ id: 'none', label: 'Control', blockIds: [] });
    b.Questions.questions.push(createQuestion('page_break', s), createQuestion('short_text', s));
    setBlockResponses(b.Questions, 'forced');
    b.Intro.branches.push({ id: 'br', logic: { match: 'all', conditions: [{ id: 'c', source: b.Intro.questions[0].id, operator: 'answered' }] }, target: 'end', endTag: 'screened_out' });
    const f = layoutFlow(s, measure);
    const t = texts(f.items);
    expect(t).toContain('Nothing shown');
    expect(t).toContain('Control');
    expect(t.some((x) => /2 pages/.test(x) && /forced response/.test(x))).toBe(true);
    expect(t.some((x) => x.includes('end the survey (screened_out)'))).toBe(true);
    // Three branches need more room than two.
    expect(f.width).toBeGreaterThan(layoutFlow(study().s, measure).width);
  });
});
