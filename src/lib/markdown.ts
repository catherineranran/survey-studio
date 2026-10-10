// The tiny Markdown subset used in question text, options and labels (see components/RichText.tsx).

export const INLINE = /(!\[[^\]]*\]\([^)\s]+\)|\*\*[^*]+\*\*|\*[^*\s][^*]*\*|(?<![A-Za-z0-9])_[^_\s][^_]*_(?![A-Za-z0-9])|\[[^\]]+\]\([^)\s]+\))/g;

/** The same text with the Markdown marks removed, for places that can't show
 *  formatting: screen-reader labels, dropdown options, exports and results. */
export function plainText(text: string | undefined): string {
  if (!text) return '';
  return text.replace(INLINE, (part) => {
    const img = /^!\[([^\]]*)\]\(([^)\s]+)\)$/.exec(part);
    if (img) return img[1];
    const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(part);
    if (link) return link[1];
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) return part.slice(2, -2);
    if (part.length > 2 && ((part.startsWith('*') && part.endsWith('*')) || (part.startsWith('_') && part.endsWith('_')))) return part.slice(1, -1);
    return part;
  });
}
