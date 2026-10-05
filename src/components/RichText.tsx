import { Fragment, type ReactNode } from 'react';

// A deliberately tiny, safe Markdown subset for question text and messages:
// paragraphs (blank line), line breaks, **bold**, *italic* / _italic_ and
// [links](https://...). Output is React elements, never raw HTML, so piped
// answers from respondents can't inject markup.

const INLINE = /(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|_[^_\s][^_]*_|\[[^\]]+\]\([^)\s]+\))/g;

function safeHref(href: string): string | null {
  return /^(https?:|mailto:)/i.test(href) ? href : null;
}

function inline(text: string, keyBase: string): ReactNode[] {
  const parts = text.split(INLINE);
  return parts.map((part, i) => {
    const key = `${keyBase}-${i}`;
    if (!part) return null;
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) return <strong key={key}>{part.slice(2, -2)}</strong>;
    if ((part.startsWith('*') && part.endsWith('*')) || (part.startsWith('_') && part.endsWith('_'))) {
      if (part.length > 2) return <em key={key}>{part.slice(1, -1)}</em>;
    }
    const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(part);
    if (link) {
      const href = safeHref(link[2]);
      return href ? (
        <a key={key} href={href} target="_blank" rel="noopener noreferrer">
          {link[1]}
        </a>
      ) : (
        <Fragment key={key}>{link[1]}</Fragment>
      );
    }
    return <Fragment key={key}>{part}</Fragment>;
  });
}

export function RichText({ text, className, as = 'div', id }: { text: string | undefined; className?: string; as?: 'div' | 'span'; id?: string }) {
  if (!text) return null;
  if (as === 'span') {
    const lines = text.split('\n');
    return (
      <span className={className} id={id}>
        {lines.map((l, i) => (
          <Fragment key={i}>
            {i > 0 && <br />}
            {inline(l, `l${i}`)}
          </Fragment>
        ))}
      </span>
    );
  }
  const paras = text.trim().split(/\n\s*\n/);
  return (
    <div className={`rich ${className ?? ''}`} id={id}>
      {paras.map((p, i) => (
        <p key={i}>
          {p.split('\n').map((l, j) => (
            <Fragment key={j}>
              {j > 0 && <br />}
              {inline(l, `p${i}-${j}`)}
            </Fragment>
          ))}
        </p>
      ))}
    </div>
  );
}
