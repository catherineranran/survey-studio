import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearVideoCache, keyMatches, openVideo } from '../src/lib/video.ts';
import { partName, sealVideo, toBase64url } from './seal-video.mjs';

/** Serves files from memory, like a static web host. */
function serve(files) {
  vi.stubGlobal('fetch', async (url) => {
    const body = files[String(url)];
    if (body === undefined) return new Response('missing', { status: 404 });
    return new Response(typeof body === 'string' ? body : body, { status: 200 });
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  clearVideoCache();
});

describe('sealed videos', () => {
  const video = new Uint8Array(100_000).map((_, i) => (i * 7) % 251);

  it('opens a video folder the seal script made, in the right order', async () => {
    const { parts, key } = await sealVideo(video, { partSize: 30_000 });
    expect(parts).toHaveLength(4);
    const base = 'https://ranranli.net/media/clip/';
    const files = { [`${base}video.json`]: JSON.stringify({ format: 'survey-studio-video/1', type: 'video/mp4', parts: parts.map((_, i) => `part-${i + 1}.bin`), encrypted: true, bytes: parts.reduce((n, p) => n + p.length, 0) }) };
    parts.forEach((p, i) => (files[`${base}part-${i + 1}.bin`] = p));
    serve(files);
    const progress = [];
    const opened = await openVideo(`${base}video.json#k=${toBase64url(key)}`, (f) => progress.push(f));
    expect(new Uint8Array(await opened.blob.arrayBuffer())).toEqual(video);
    expect(opened.blob.type).toBe('video/mp4');
    expect(progress.at(-1)).toBe(1);
    expect(progress.every((f, i) => i === 0 || f >= progress[i - 1])).toBe(true);
    opened.release();
  });

  it('checks a link’s key without downloading the video, and names parts by content', async () => {
    const { parts, key, check } = await sealVideo(video, { partSize: 60_000 });
    const manifest = { format: 'survey-studio-video/1', type: 'video/mp4', parts: ['a'], encrypted: true, check };
    expect(await keyMatches(manifest, toBase64url(key))).toBe(true);
    expect(await keyMatches(manifest, toBase64url(new Uint8Array(32).fill(1)))).toBe(false);
    expect(await keyMatches({ ...manifest, check: undefined }, toBase64url(key))).toBeNull();
    expect(partName(0, parts[0], 'bin')).toMatch(/^part-1-[0-9a-f]{10}\.bin$/);
    expect(partName(0, parts[0], 'bin')).not.toBe(partName(0, parts[1], 'bin'));
  });

  it('rejects a wrong key and a missing key', async () => {
    const { parts } = await sealVideo(video, { partSize: 60_000 });
    const base = 'https://ranranli.net/media/clip/';
    const files = { [`${base}video.json`]: JSON.stringify({ format: 'survey-studio-video/1', type: 'video/mp4', parts: ['part-1.bin', 'part-2.bin'], encrypted: true }) };
    parts.forEach((p, i) => (files[`${base}part-${i + 1}.bin`] = p));
    serve(files);
    const other = toBase64url(new Uint8Array(32).fill(7));
    await expect(openVideo(`${base}video.json#k=${other}`)).rejects.toThrow(/doesn’t match/);
    await expect(openVideo(`${base}video.json`)).rejects.toThrow(/no key/);
  });
});
