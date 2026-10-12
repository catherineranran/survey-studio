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

/** What an image mark ![description](https://…) shows. */
export type Media =
  | { kind: 'image'; src: string }
  | { kind: 'video'; src: string }
  | { kind: 'player'; src: string; provider: 'YouTube' | 'Vimeo' | 'Google Drive' };

/** "90", "90s", "1m30s" -> seconds. */
function seconds(t: string | null): number {
  if (!t) return 0;
  if (/^\d+$/.test(t)) return Number(t);
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(t);
  return m ? Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0) : 0;
}

/**
 * Images, video files (.mp4, .webm, .mov …) and videos on YouTube, Vimeo or Google Drive
 * all use the image mark. Only https links are shown. YouTube plays from its no-cookie
 * domain and Vimeo with "do not track"; a video file on your own server avoids third parties.
 */
export function mediaFor(url: string): Media | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:') return null;
  const host = u.hostname.toLowerCase().replace(/^(www\.|m\.)/, '');

  let yt: string | null = null;
  if (host === 'youtu.be') yt = u.pathname.split('/')[1] ?? null;
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    if (u.pathname === '/watch') yt = u.searchParams.get('v');
    else yt = /^\/(?:embed|shorts|live)\/([^/]+)/.exec(u.pathname)?.[1] ?? null;
  }
  if (yt && /^[\w-]{6,20}$/.test(yt)) {
    const start = seconds(u.searchParams.get('t') ?? u.searchParams.get('start'));
    return { kind: 'player', provider: 'YouTube', src: `https://www.youtube-nocookie.com/embed/${yt}?rel=0${start ? `&start=${start}` : ''}` };
  }

  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    const m = /^\/(?:video\/)?(\d+)(?:\/([0-9a-f]+))?/.exec(u.pathname);
    if (m) {
      const h = m[2] ?? u.searchParams.get('h');
      return { kind: 'player', provider: 'Vimeo', src: `https://player.vimeo.com/video/${m[1]}?dnt=1${h && /^[0-9a-f]+$/.test(h) ? `&h=${h}` : ''}` };
    }
  }

  if (host === 'drive.google.com') {
    const id = /^\/file\/d\/([\w-]+)/.exec(u.pathname)?.[1] ?? (u.pathname === '/open' ? u.searchParams.get('id') : null);
    if (id && /^[\w-]+$/.test(id)) return { kind: 'player', provider: 'Google Drive', src: `https://drive.google.com/file/d/${id}/preview` };
  }

  if (/\.(mp4|m4v|webm|ogv|mov)$/i.test(u.pathname)) return { kind: 'video', src: u.href };
  return { kind: 'image', src: u.href };
}
