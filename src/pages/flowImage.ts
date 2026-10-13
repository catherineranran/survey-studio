// The survey flow as a picture: a flowchart drawn on a canvas from the survey itself
// (not a screenshot of the Flow tab), saved as a PNG. `layoutFlow` places everything
// and is pure (tests give it a fake text measure); `drawFlow` paints the result.

import { allQuestions } from '../lib/engine';
import { flowSteps } from '../lib/flow';
import { TYPE_INFO } from '../lib/questionTypes';
import type { Block, Survey } from '../lib/types';
import { blockTitle, describeBlock } from './flowText';

export type Measure = (text: string, font: string) => number;

const SANS = '"Atkinson Hyperlegible Next Variable", "Atkinson Hyperlegible Next", system-ui, -apple-system, "Segoe UI", sans-serif';
const MONO = '"Atkinson Hyperlegible Mono Variable", ui-monospace, Menlo, monospace';

export const FONTS = {
  title: `700 22px ${SANS}`,
  subtitle: `400 13px ${SANS}`,
  block: `700 15px ${SANS}`,
  meta: `400 13px ${SANS}`,
  rule: `400 12.5px ${SANS}`,
  num: `600 11px ${MONO}`,
  pill: `700 13px ${SANS}`,
  note: `400 12.5px ${SANS}`,
  arm: `700 12.5px ${SANS}`,
  rand: `700 14px ${SANS}`,
};

const LINE = { title: 28, subtitle: 18, block: 20, meta: 18, rule: 17, note: 17, arm: 17, rand: 19 };

/** The app's light palette: structure in drop-out-ink green, logic in amber. */
const C = { paper: '#ffffff', ink: '#1c2321', ink2: '#47524e', ink3: '#66726d', line: '#c9d2ce', form: '#136f55', tint: '#e2f0ea', logic: '#845000', sunk: '#f5f7f6' };

const PAD = 40;
const BLOCK_W = 440;
const ARM_W = 264;
const ARM_GAP = 24;
const GAP = 34;
const BOX_PAD = 14;
const BUBBLE = 22;

export type Item =
  | { kind: 'text'; x: number; y: number; text: string; font: string; color: string; align?: 'left' | 'center' }
  | { kind: 'box'; x: number; y: number; w: number; h: number; fill: string; stroke: string; dashed?: boolean; radius: number }
  | { kind: 'line'; points: [number, number][]; color: string; arrow?: boolean }
  | { kind: 'bubble'; x: number; y: number; text: string }
  | { kind: 'shuffle'; x: number; y: number }
  | { kind: 'mark'; x: number; y: number };

export interface FlowLayout {
  width: number;
  height: number;
  items: Item[];
  /** Where each block's box is, by block id (for tests). */
  boxes: Record<string, { x: number; y: number; w: number; h: number }>;
}

/** Breaks text into lines no wider than `max` (a word longer than a line is broken too). */
export function wrap(text: string, font: string, max: number, measure: Measure): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (measure(next, font) <= max) {
      line = next;
      continue;
    }
    if (line) lines.push(line);
    let rest = word;
    while (rest.length > 1 && measure(rest, font) > max) {
      let cut = rest.length - 1;
      while (cut > 1 && measure(rest.slice(0, cut), font) > max) cut--;
      lines.push(rest.slice(0, cut));
      rest = rest.slice(cut);
    }
    line = rest;
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

interface Sized {
  h: number;
  draw: (x: number, y: number) => Item[];
}

export function layoutFlow(survey: Survey, measure: Measure, date = new Date()): FlowLayout {
  const steps = flowSteps(survey);
  const numbers = new Map(survey.blocks.map((b, i) => [b.id, i + 1]));
  const boxes: FlowLayout['boxes'] = {};

  /** A block as a card: number bubble, title, what it holds, its logic in amber. */
  const blockBox = (b: Block, w: number): Sized => {
    const { meta, rules } = describeBlock(survey, b);
    const textX = BOX_PAD + BUBBLE + 10;
    const inner = w - textX - BOX_PAD;
    const title = wrap(blockTitle(b), FONTS.block, inner, measure);
    const metaLines = wrap(meta.join(' · '), FONTS.meta, inner, measure);
    const ruleLines = rules.map((r) => wrap(r, FONTS.rule, inner - 14, measure));
    const rulesH = ruleLines.length ? 6 + ruleLines.reduce((n, l) => n + l.length, 0) * LINE.rule : 0;
    const h = BOX_PAD + title.length * LINE.block + 2 + metaLines.length * LINE.meta + rulesH + BOX_PAD - 2;
    return {
      h,
      draw: (x, y) => {
        boxes[b.id] = { x, y, w, h };
        const out: Item[] = [
          { kind: 'box', x, y, w, h, fill: C.paper, stroke: C.line, radius: 10 },
          { kind: 'bubble', x: x + BOX_PAD + BUBBLE / 2, y: y + BOX_PAD + LINE.block / 2, text: String(numbers.get(b.id) ?? '') },
        ];
        let ty = y + BOX_PAD;
        for (const l of title) {
          out.push({ kind: 'text', x: x + textX, y: ty + LINE.block / 2, text: l, font: FONTS.block, color: C.ink });
          ty += LINE.block;
        }
        ty += 2;
        for (const l of metaLines) {
          out.push({ kind: 'text', x: x + textX, y: ty + LINE.meta / 2, text: l, font: FONTS.meta, color: C.ink2 });
          ty += LINE.meta;
        }
        if (ruleLines.length) ty += 6;
        for (const lines of ruleLines) {
          lines.forEach((l, i) => {
            if (i === 0) out.push({ kind: 'mark', x: x + textX + 4, y: ty + LINE.rule / 2 });
            out.push({ kind: 'text', x: x + textX + 14, y: ty + LINE.rule / 2, text: l, font: FONTS.rule, color: C.logic });
            ty += LINE.rule;
          });
        }
        return out;
      },
    };
  };

  const emptyArm = (w: number): Sized => ({
    h: 44,
    draw: (x, y) => [
      { kind: 'box', x, y, w, h: 44, fill: C.sunk, stroke: C.line, dashed: true, radius: 10 },
      { kind: 'text', x: x + w / 2, y: y + 22, text: 'Nothing shown', font: FONTS.meta, color: C.ink3, align: 'center' },
    ],
  });

  /** Start and End: a capsule with notes beneath. */
  const terminal = (label: string, notes: string[], maxW: number): Sized => {
    const pillW = measure(label, FONTS.pill) + 40;
    const noteLines = notes.flatMap((n) => wrap(n, FONTS.note, maxW, measure));
    const h = 30 + (noteLines.length ? 6 + noteLines.length * LINE.note : 0);
    return {
      h,
      draw: (x, y) => {
        const cx = x;
        const out: Item[] = [
          { kind: 'box', x: cx - pillW / 2, y, w: pillW, h: 30, fill: C.form, stroke: C.form, radius: 15 },
          { kind: 'text', x: cx, y: y + 15, text: label, font: FONTS.pill, color: '#ffffff', align: 'center' },
        ];
        noteLines.forEach((l, i) => out.push({ kind: 'text', x: cx, y: y + 36 + i * LINE.note + LINE.note / 2, text: l, font: FONTS.note, color: C.ink3, align: 'center' }));
        return out;
      },
    };
  };

  // Width: the main column, or the widest randomizer (its branches side by side).
  const armsWidth = (n: number) => n * ARM_W + Math.max(0, n - 1) * ARM_GAP;
  const contentW = Math.max(BLOCK_W, 560, ...steps.map((s) => (s.kind === 'randomizer' ? armsWidth(Math.max(1, s.arms.length)) : 0)));
  const width = contentW + PAD * 2;
  const cx = width / 2;
  const items: Item[] = [];

  // Heading: the survey's title, then what's in it.
  let y = PAD;
  for (const l of wrap(survey.title || 'Untitled survey', FONTS.title, contentW, measure)) {
    items.push({ kind: 'text', x: PAD, y: y + LINE.title / 2, text: l, font: FONTS.title, color: C.ink });
    y += LINE.title;
  }
  const answerable = allQuestions(survey).filter((q) => TYPE_INFO[q.type].answerable).length;
  const when = date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  const sub = `Survey flow · ${survey.blocks.length} block${survey.blocks.length === 1 ? '' : 's'} · ${answerable} question${answerable === 1 ? '' : 's'} · ${when}`;
  for (const l of wrap(sub, FONTS.subtitle, contentW, measure)) {
    items.push({ kind: 'text', x: PAD, y: y + 4 + LINE.subtitle / 2, text: l, font: FONTS.subtitle, color: C.ink3 });
    y += LINE.subtitle;
  }
  y += 30;

  const s = survey.settings;
  const startNotes = [
    s.welcomeEnabled ? 'Welcome page' : '',
    survey.urlParams.length ? `Reads ${survey.urlParams.map((p) => p.name).join(', ')} from the link` : '',
  ].filter(Boolean);
  const start = terminal('Start', startNotes, contentW);
  items.push(...start.draw(cx, y));
  y += start.h;
  let bottom = y + (startNotes.length ? 4 : 0); // below the notes, so the line doesn't cross them

  const connect = (from: number, to: number) => items.push({ kind: 'line', points: [[cx, from], [cx, to]], color: C.form, arrow: true });

  for (const step of steps) {
    y += GAP;
    connect(bottom, y);
    if (step.kind === 'block') {
      const box = blockBox(step.block, BLOCK_W);
      items.push(...box.draw(cx - BLOCK_W / 2, y));
      y += box.h;
      bottom = y;
      continue;
    }

    // Randomizer: a header, branches side by side, joining again below.
    const r = step.randomizer;
    const n = step.arms.length;
    const present = Math.max(1, Math.min(Math.floor(r.present) || 1, Math.max(1, n)));
    const headW = Math.min(contentW, 520);
    const subText = `Each respondent gets ${present} of ${n} branch${n === 1 ? '' : 'es'}${present > 1 ? ', in random order' : ''}${r.balance ? ' · balanced' : ''}`;
    const headTitle = wrap(`Randomizer · saved as ${r.variable}`, FONTS.rand, headW - 64, measure);
    const headSub = wrap(subText, FONTS.meta, headW - 64, measure);
    const headH = 12 + headTitle.length * LINE.rand + headSub.length * LINE.meta + 12;
    const hx = cx - headW / 2;
    items.push({ kind: 'box', x: hx, y, w: headW, h: headH, fill: C.tint, stroke: C.form, radius: 12 });
    items.push({ kind: 'shuffle', x: hx + 26, y: y + headH / 2 });
    let ty = y + 12;
    for (const l of headTitle) {
      items.push({ kind: 'text', x: hx + 48, y: ty + LINE.rand / 2, text: l, font: FONTS.rand, color: C.ink });
      ty += LINE.rand;
    }
    for (const l of headSub) {
      items.push({ kind: 'text', x: hx + 48, y: ty + LINE.meta / 2, text: l, font: FONTS.meta, color: C.ink2 });
      ty += LINE.meta;
    }
    y += headH;

    const total = armsWidth(Math.max(1, n));
    const left = cx - total / 2;
    const centers = step.arms.map((_, i) => left + i * (ARM_W + ARM_GAP) + ARM_W / 2);
    const busY = y + 18;
    items.push({ kind: 'line', points: [[cx, y], [cx, busY]], color: C.form });
    if (centers.length > 1) items.push({ kind: 'line', points: [[centers[0], busY], [centers[centers.length - 1], busY]], color: C.form });

    const armTop = busY + 22;
    const ends: number[] = [];
    step.arms.forEach(({ arm, blocks }, i) => {
      const ax = left + i * (ARM_W + ARM_GAP);
      const acx = centers[i];
      let ay = armTop;
      // The branch's name, unless its one block already says it.
      const named = !(blocks.length === 1 && blocks[0].title.trim() === arm.label.trim());
      if (named) {
        const label = wrap(arm.label || 'Unnamed branch', FONTS.arm, ARM_W, measure);
        items.push({ kind: 'line', points: [[acx, busY], [acx, ay - 2]], color: C.form });
        label.forEach((l, k) => items.push({ kind: 'text', x: acx, y: ay + k * LINE.arm + LINE.arm / 2, text: l, font: FONTS.arm, color: C.form, align: 'center' }));
        ay += label.length * LINE.arm + 14;
        items.push({ kind: 'line', points: [[acx, ay - 12], [acx, ay]], color: C.form, arrow: true });
      } else {
        items.push({ kind: 'line', points: [[acx, busY], [acx, ay]], color: C.form, arrow: true });
      }
      const cards = blocks.length ? blocks.map((b) => blockBox(b, ARM_W)) : [emptyArm(ARM_W)];
      cards.forEach((card, k) => {
        if (k > 0) {
          items.push({ kind: 'line', points: [[acx, ay], [acx, ay + 24]], color: C.form, arrow: true });
          ay += 24;
        }
        items.push(...card.draw(ax, ay));
        ay += card.h;
      });
      ends.push(ay);
    });
    const joinY = Math.max(...ends, armTop) + 18;
    step.arms.forEach((_, i) => items.push({ kind: 'line', points: [[centers[i], ends[i]], [centers[i], joinY]], color: C.form }));
    if (centers.length > 1) items.push({ kind: 'line', points: [[centers[0], joinY], [centers[centers.length - 1], joinY]], color: C.form });
    y = joinY;
    bottom = joinY;
  }

  y += GAP;
  connect(bottom, y);
  const end = terminal('End', [`Thank-you page${s.redirectUrl ? ', then redirect' : ''}`], contentW);
  items.push(...end.draw(cx, y));
  y += end.h + PAD;

  return { width: Math.ceil(width), height: Math.ceil(y), items, boxes };
}

/* ----------------------------------------------------------------- drawing */

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function drawFlow(ctx: CanvasRenderingContext2D, layout: FlowLayout) {
  ctx.fillStyle = C.paper;
  ctx.fillRect(0, 0, layout.width, layout.height);
  ctx.textBaseline = 'middle';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const it of layout.items) {
    switch (it.kind) {
      case 'box':
        roundRect(ctx, it.x + 0.5, it.y + 0.5, it.w - 1, it.h - 1, it.radius);
        ctx.fillStyle = it.fill;
        ctx.fill();
        ctx.setLineDash(it.dashed ? [5, 4] : []);
        ctx.lineWidth = 1.25;
        ctx.strokeStyle = it.stroke;
        ctx.stroke();
        ctx.setLineDash([]);
        break;
      case 'line': {
        ctx.beginPath();
        it.points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = it.color;
        const [x1, y1] = it.points[it.points.length - 2];
        const [x2, y2] = it.points[it.points.length - 1];
        const len = Math.hypot(x2 - x1, y2 - y1);
        if (it.arrow && len > 8) {
          // Stop the line where the arrowhead starts, then draw the head.
          const ux = (x2 - x1) / len;
          const uy = (y2 - y1) / len;
          ctx.beginPath();
          it.points.slice(0, -1).forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
          ctx.lineTo(x2 - ux * 6, y2 - uy * 6);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(x2, y2);
          ctx.lineTo(x2 - ux * 7 - uy * 4.5, y2 - uy * 7 + ux * 4.5);
          ctx.lineTo(x2 - ux * 7 + uy * 4.5, y2 - uy * 7 - ux * 4.5);
          ctx.closePath();
          ctx.fillStyle = it.color;
          ctx.fill();
        } else ctx.stroke();
        break;
      }
      case 'bubble':
        ctx.beginPath();
        ctx.arc(it.x, it.y, BUBBLE / 2 - 0.75, 0, Math.PI * 2);
        ctx.fillStyle = C.paper;
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = C.form;
        ctx.stroke();
        ctx.font = FONTS.num;
        ctx.fillStyle = C.form;
        ctx.textAlign = 'center';
        ctx.fillText(it.text, it.x, it.y + 0.5);
        break;
      case 'mark':
        // A small amber diamond in front of each logic note.
        ctx.beginPath();
        ctx.moveTo(it.x, it.y - 4);
        ctx.lineTo(it.x + 4, it.y);
        ctx.lineTo(it.x, it.y + 4);
        ctx.lineTo(it.x - 4, it.y);
        ctx.closePath();
        ctx.fillStyle = C.logic;
        ctx.fill();
        break;
      case 'shuffle': {
        // Two crossing arrows, like the app's shuffle icon.
        const { x, y } = it;
        ctx.lineWidth = 1.75;
        ctx.strokeStyle = C.form;
        ctx.beginPath();
        ctx.moveTo(x - 9, y - 6);
        ctx.bezierCurveTo(x - 2, y - 6, x + 2, y + 6, x + 8, y + 6);
        ctx.moveTo(x - 9, y + 6);
        ctx.bezierCurveTo(x - 2, y + 6, x + 2, y - 6, x + 8, y - 6);
        ctx.stroke();
        for (const dy of [-6, 6]) {
          ctx.beginPath();
          ctx.moveTo(x + 10, y + dy);
          ctx.lineTo(x + 6, y + dy - 3.5);
          ctx.lineTo(x + 6, y + dy + 3.5);
          ctx.closePath();
          ctx.fillStyle = C.form;
          ctx.fill();
        }
        break;
      }
      case 'text':
        ctx.font = it.font;
        ctx.fillStyle = it.color;
        ctx.textAlign = it.align ?? 'left';
        ctx.fillText(it.text, it.x, it.y);
        break;
    }
  }
}

/** The flowchart as a PNG file, at twice the size for sharp printing (less for very long surveys). */
export async function flowchartPng(survey: Survey): Promise<Blob> {
  // The app's fonts are self-hosted; make sure they've arrived before measuring with them.
  await Promise.all([FONTS.title, FONTS.block, FONTS.meta, FONTS.num].map((f) => document.fonts?.load(f))).catch(() => {});
  const probe = document.createElement('canvas').getContext('2d');
  if (!probe) throw new Error('This browser can’t draw images.');
  const measure: Measure = (text, font) => {
    probe.font = font;
    return probe.measureText(text).width;
  };
  const layout = layoutFlow(survey, measure);
  // Phones and Safari limit canvas size; stay well inside it.
  const scale = Math.min(2, 16000 / Math.max(layout.width, layout.height), Math.sqrt(16_000_000 / (layout.width * layout.height)));
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(layout.width * scale);
  canvas.height = Math.ceil(layout.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser can’t draw images.');
  ctx.scale(scale, scale);
  drawFlow(ctx, layout);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => {
      // Phones keep a small budget for canvases; hand this one back straight away.
      canvas.width = canvas.height = 0;
      if (b) resolve(b);
      else reject(new Error('The image couldn’t be made.'));
    }, 'image/png'),
  );
}
