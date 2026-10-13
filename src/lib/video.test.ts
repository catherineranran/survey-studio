import { describe, expect, it } from 'vitest';
import { base64url, fetchManifest, fromBase64url, parseVideoLink } from './video';

describe('video links', () => {
  it('reads files and video folders, with or without a key', () => {
    expect(parseVideoLink('https://ranranli.net/media/clip.MP4?v=2')).toEqual({ kind: 'file', url: 'https://ranranli.net/media/clip.MP4?v=2' });
    expect(parseVideoLink(' https://ranranli.net/x/video.json#k=abc_-1 ')).toEqual({ kind: 'folder', manifestUrl: 'https://ranranli.net/x/video.json', key: 'abc_-1' });
    expect(parseVideoLink('https://ranranli.net/x/video.json')).toEqual({ kind: 'folder', manifestUrl: 'https://ranranli.net/x/video.json', key: null });
    expect(parseVideoLink('http://localhost:4173/x/video.json')?.kind).toBe('folder');
  });

  it('refuses anything else', () => {
    expect(parseVideoLink('')).toBeNull();
    expect(parseVideoLink('http://example.org/clip.mp4')).toBeNull();
    expect(parseVideoLink('https://www.youtube.com/watch?v=abc')).toBeNull();
    expect(parseVideoLink('javascript:alert(1)//.mp4')).toBeNull();
    expect(parseVideoLink('not a link')).toBeNull();
  });

  it('says plainly when a video folder can’t be reached', async () => {
    const real = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new TypeError('Failed to fetch');
    }) as typeof fetch;
    try {
      await expect(fetchManifest('https://ranranli.net/x/video.json')).rejects.toThrow(
        'The video folder couldn’t be reached. Check the link and the internet connection.',
      );
    } finally {
      globalThis.fetch = real;
    }
  });

  it('round-trips keys as base64url', () => {
    const key = new Uint8Array(32).map((_, i) => (i * 37 + 250) % 256);
    expect(fromBase64url(base64url(key))).toEqual(key);
    expect(base64url(key)).not.toMatch(/[+/=]/);
  });
});
