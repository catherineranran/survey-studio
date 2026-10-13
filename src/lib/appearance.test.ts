import { describe, expect, it } from 'vitest';
import { READABLE, STANDARD_TEXT, accentContrast, contrast, respondentStyle, textContrast, textScale, validColor } from './appearance';
import { ACCENTS, defaultSettings } from './templates';

describe('appearance', () => {
  it('measures contrast the WCAG way', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrast('#ffffff', '#ffffff')).toBe(1);
    expect(contrast('#777777', '#ffffff')).toBeCloseTo(4.48, 2);
    expect(contrast(STANDARD_TEXT, '#ffffff')).toBeGreaterThan(15);
  });

  it('the built-in colours are readable', () => {
    const s = defaultSettings();
    expect(textContrast(s)).toBeGreaterThan(READABLE);
    for (const a of ACCENTS) expect(accentContrast({ accent: a.value })).toBeGreaterThan(READABLE);
    expect(textContrast({ textColor: '#aaaaaa' })).toBeLessThan(READABLE);
  });

  it('keeps the text size in range', () => {
    expect(textScale(undefined)).toBe(1);
    expect(textScale({ textScale: 1.15 })).toBe(1.15);
    expect(textScale({ textScale: 9 })).toBe(1.6);
    expect(textScale({ textScale: 0.2 })).toBe(0.8);
    expect(textScale({ textScale: Number.NaN })).toBe(1);
  });

  it('turns settings into page variables, ignoring anything that isn’t a colour', () => {
    expect(respondentStyle(defaultSettings())).toEqual({ '--accent': '#136f55' });
    expect(respondentStyle({ ...defaultSettings(), textScale: 1.3, textColor: '#17284A' })).toEqual({
      '--accent': '#136f55',
      '--rs': '1.3',
      '--ink': '#17284a',
      '--ink-2': '#17284a',
    });
    expect(respondentStyle({ accent: 'red; background: url(x)', textColor: 'javascript:1' })).toEqual({});
    expect(validColor(' #ABCDEF ')).toBe('#abcdef');
    // Whatever a survey file holds, nothing breaks.
    expect(validColor(1)).toBeNull();
    expect(respondentStyle({ accent: ['#000000'], textColor: 1, textScale: '1.2' } as never)).toEqual({ '--rs': '1.2' });
    expect(respondentStyle(undefined)).toBeUndefined();
  });
});

describe('the survey checker', () => {
  it('warns about colours that are hard to read, and only then', async () => {
    const { lintSurvey } = await import('./lint');
    const { blankSurvey } = await import('./templates');
    const s = blankSurvey('a1');
    const colourWarnings = () => lintSurvey(s).filter((i) => /hard to read/.test(i.message));
    expect(colourWarnings()).toEqual([]);
    s.settings.textColor = '#b0b0b0';
    s.settings.accent = '#ffd400';
    expect(colourWarnings().map((i) => i.level)).toEqual(['warning', 'warning']);
  });
});
