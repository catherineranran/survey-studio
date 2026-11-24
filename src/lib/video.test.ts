import { describe, expect, it } from 'vitest';
import { base64url, fetchManifest, fromBase64url, parseVideoLink, setLocalVideoReader } from './video';

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

  it('reads video folders uploaded into this browser', async () => {
    expect(parseVideoLink('local-video://uploads/abc-1/video.json#k=xyz')).toEqual({ kind: 'folder', manifestUrl: 'local-video://uploads/abc-1/video.json', key: 'xyz' });
    expect(parseVideoLink('local-video://uploads/abc-1/clip.mp4')).toBeNull();
    const manifest = { format: 'survey-studio-video/1', type: 'video/mp4', parts: ['part-1-0123456789.bin'], encrypted: false };
    try {
      setLocalVideoReader(async (url) => (url === 'local-video://uploads/abc-1/video.json' ? new Blob([JSON.stringify(manifest)]) : null));
      expect(await fetchManifest('local-video://uploads/abc-1/video.json')).toEqual(manifest);
      await expect(fetchManifest('local-video://uploads/other/video.json')).rejects.toThrow('The video folder isn’t stored in this browser');
      // Without the browser-only storage (Supabase mode), such links can't play.
      setLocalVideoReader(null);
      await expect(fetchManifest('local-video://uploads/abc-1/video.json')).rejects.toThrow('isn’t stored in this browser');
    } finally {
      setLocalVideoReader(null);
    }
  });

  it('round-trips keys as base64url', () => {
    const key = new Uint8Array(32).map((_, i) => (i * 37 + 250) % 256);
    expect(fromBase64url(base64url(key))).toEqual(key);
    expect(base64url(key)).not.toMatch(/[+/=]/);
  });
});
