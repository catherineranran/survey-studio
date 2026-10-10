import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RichText } from './RichText';

const html = (t: string) => renderToStaticMarkup(<RichText text={t} />);

describe('RichText', () => {
  it('formats the supported subset', () => {
    expect(html('**bold** and *it* and _it2_')).toBe('<div class="rich "><p><strong>bold</strong> and <em>it</em> and <em>it2</em></p></div>');
    expect(html('[site](https://example.org)')).toContain('<a href="https://example.org" target="_blank" rel="noopener noreferrer">site</a>');
    expect(html('![A cat](https://example.org/cat.png)')).toContain('<img class="rich-img" src="https://example.org/cat.png" alt="A cat" loading="lazy"/>');
  });
  it('leaves identifiers and unsafe links alone', () => {
    expect(html('PROLIFIC_PID and snake_case_name')).toContain('PROLIFIC_PID and snake_case_name');
    expect(html('[x](javascript:alert(1))')).not.toContain('href');
    expect(html('<script>alert(1)</script>')).toContain('&lt;script&gt;');
  });
  it('keeps paragraphs and line breaks', () => {
    expect(html('a\nb\n\nc')).toBe('<div class="rich "><p>a<br/>b</p><p>c</p></div>');
  });
});

describe('RichText in labels', () => {
  it('renders bold inside an inline label', () => {
    expect(renderToStaticMarkup(<RichText as="span" className="choice-label" text="**angry**" />)).toBe('<span class="choice-label"><strong>angry</strong></span>');
  });
});
