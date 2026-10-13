import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { makeParallel, moveIntoNewArm } from '../../lib/flow';
import { createQuestion } from '../../lib/questionTypes';
import { blankSurvey, newBlock } from '../../lib/templates';
import type { Block, Survey } from '../../lib/types';
import { OutlineView } from './Outline';

/** Intro → [Vignette | Video] → Questions, each block with one question named after it. */
function study(): { s: Survey; b: Record<string, Block> } {
  const s = blankSurvey('s');
  s.blocks = [];
  const b: Record<string, Block> = {};
  for (const name of ['Intro', 'Vignette', 'Video', 'Questions']) {
    const block = newBlock(s, name);
    block.questions.push({ ...createQuestion('single_choice', s), variable: `q_${name.toLowerCase()}`, title: `About ${name}` });
    s.blocks.push(block);
    b[name] = block;
  }
  makeParallel(s, b.Video.id, b.Vignette.id);
  return { s, b };
}

const render = (s: Survey, folded: string[] = [], current: string | null = null) =>
  renderToStaticMarkup(
    <OutlineView
      survey={s}
      folded={new Set(folded)}
      sel={null}
      current={current}
      onToggleFold={() => {}}
      onFoldAll={() => {}}
      onBlock={() => {}}
      onQuestion={() => {}}
      onHide={() => {}}
      hideLabel="Hide outline"
    />,
  );

describe('outline', () => {
  it('lists blocks in flow order, numbered, with their questions', () => {
    const { s } = study();
    const html = render(s);
    const order = ['Intro', 'Vignette', 'Video', 'Questions'].map((t) => html.indexOf(`>${t}<`));
    expect(order.every((i, k) => i > 0 && (k === 0 || i > order[k - 1]))).toBe(true);
    expect(html).toContain('q_intro');
    expect(html).toContain('About Questions');
    expect(html.match(/class="outline-num">\d+</g)?.map((m) => m.replace(/\D/g, ''))).toEqual(['1', '2', '3', '4']);
  });

  it('groups randomizer branches, naming a branch only when its blocks don’t already', () => {
    const { s, b } = study();
    const r = s.randomizers[0];
    const html = render(s);
    expect(html).toContain('outline-rand');
    expect(html).toContain(r.variable);
    expect(html).not.toContain('outline-arm-label'); // each branch is one block of the same name
    moveIntoNewArm(s, b.Questions.id, r.id); // a third branch, then rename it
    r.arms[2].label = 'Control';
    expect(render(s)).toContain('<div class="outline-arm-label">Control</div>');
  });

  it('shows an empty branch as such', () => {
    const { s } = study();
    s.randomizers[0].arms.push({ id: 'arm_empty', label: 'No video', blockIds: [] });
    const html = render(s);
    expect(html).toContain('No video');
    expect(html).toContain('Nothing shown');
  });

  it('hides the questions of folded blocks and counts them instead', () => {
    const { s, b } = study();
    const html = render(s, [b.Intro.id]);
    expect(html).not.toContain('q_intro');
    expect(html).toContain('q_questions');
    expect(html).toContain('aria-label="Unfold Intro"');
    expect(html).toContain('aria-label="Fold Questions"');
    expect(html).toMatch(/title="1 question">1</);
  });

  it('marks the block you’re at, and offers fold all / unfold all as they apply', () => {
    const { s, b } = study();
    expect(render(s, [], b.Video.id)).toMatch(/data-block="[^"]+" class="outline-item is-current"><div class="outline-row">[^]*?>Video</);
    const state = (html: string, label: string) => html.match(new RegExp(`<button[^>]*aria-label="${label}"[^>]*>`))?.[0].match(/aria-disabled="(\w+)"/)?.[1];
    const none = render(s);
    expect(state(none, 'Fold all blocks')).toBe('false');
    expect(state(none, 'Unfold all blocks')).toBe('true');
    const all = render(s, s.blocks.map((x) => x.id));
    expect(state(all, 'Fold all blocks')).toBe('true');
    expect(state(all, 'Unfold all blocks')).toBe('false');
  });
});
