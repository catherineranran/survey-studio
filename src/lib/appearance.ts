// How respondent pages look: accent colour, text size and text colour, plus the
// contrast checks that keep a chosen colour readable.

import type { SurveySettings } from './types';

/** The standard text colour of respondent pages (`--ink` on light paper). */
export const STANDARD_TEXT = '#1c2321';
const PAPER = '#ffffff';

export const TEXT_COLORS = [
  { name: 'Standard', value: '' },
  { name: 'Black', value: '#000000' },
  { name: 'Navy', value: '#17284a' },
  { name: 'Dark green', value: '#163a2e' },
  { name: 'Brown', value: '#3e2a1c' },
];

export const TEXT_SCALE = { min: 0.8, max: 1.6, step: 0.05 };

const HEX = /^#[0-9a-f]{6}$/i;

/** A #rrggbb colour, or null for anything else. */
export function validColor(c: unknown): string | null {
  return typeof c === 'string' && HEX.test(c.trim()) ? c.trim().toLowerCase() : null;
}

/** The survey's text size, kept within the range the builder offers. */
export function textScale(s: Pick<SurveySettings, 'textScale'> | undefined): number {
  const n = Number(s?.textScale);
  if (!Number.isFinite(n) || n <= 0) return 1;
  return Math.min(TEXT_SCALE.max, Math.max(TEXT_SCALE.min, Math.round(n * 100) / 100));
}

function luminance(hex: string): number {
  const v = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = v.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio of two #rrggbb colours (1 to 21). */
export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/** WCAG AA for normal text. */
export const READABLE = 4.5;

/** Contrast of the survey's text on the white page. */
export const textContrast = (s: Pick<SurveySettings, 'textColor'>) => contrast(validColor(s.textColor) ?? STANDARD_TEXT, PAPER);

/** Contrast of the white text on the survey's accent colour (buttons). */
export const accentContrast = (s: Pick<SurveySettings, 'accent'>) => contrast(validColor(s.accent) ?? '#136f55', PAPER);

/** CSS variables for a respondent page (or a sample of one). */
export function respondentStyle(s: Partial<SurveySettings> | undefined): Record<string, string> | undefined {
  if (!s) return undefined;
  const style: Record<string, string> = {};
  const accent = validColor(s.accent);
  if (accent) style['--accent'] = accent;
  const scale = textScale(s as SurveySettings);
  if (scale !== 1) style['--rs'] = String(scale);
  const ink = validColor(s.textColor);
  // Questions, options and descriptions take the colour; small print stays grey.
  if (ink) style['--ink'] = style['--ink-2'] = ink;
  return style;
}
