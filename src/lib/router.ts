import { useEffect, useState } from 'react';

// Hash-based routes (#/s/<id>/build) work on any static host, GitHub Pages included,
// without server-side rewrites.

function parse(hash: string): string[] {
  const path = hash.replace(/^#\/?/, '').split('?')[0];
  return path.split('/').filter(Boolean).map(decodeURIComponent);
}

export function useHashPath(): string[] {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const on = () => setHash(window.location.hash);
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return parse(hash);
}

export function navigate(path: string) {
  window.location.hash = path.startsWith('/') ? path : `/${path}`;
}

/** The link respondents open. A real query parameter, so panels like Prolific can append theirs. */
export function publicSurveyUrl(id: string): string {
  const { origin, pathname } = window.location;
  return `${origin}${pathname}?s=${encodeURIComponent(id)}`;
}

/** The link that lets someone create their own account. */
export function inviteUrl(code: string): string {
  const { origin, pathname } = window.location;
  return `${origin}${pathname}?invite=${encodeURIComponent(code)}`;
}
