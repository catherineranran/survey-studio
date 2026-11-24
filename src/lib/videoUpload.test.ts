import { afterEach, describe, expect, it } from 'vitest';
import { BackendError, type VideoStore } from './backend/types';
import { clearVideoCache, keyMatches, openVideo, parseVideoLink, type VideoManifest } from './video';
import { isCancelled, matchUploads, uploadVideo, videoLinks } from './videoUpload';

const HOST = 'https://files.test/videos/';

/** A VideoStore in memory, with a hook to make `put` fail or wait. */
function memoryStore(onPut?: (name: string, attempt: number) => Promise<void> | void) {
  const files = new Map<string, { data: Uint8Array; type: string }>();
  const attempts = new Map<string, number>();
  const removed: string[] = [];
  const store: VideoStore = {
    where: 'online',
    async put(uploadId, name, data, type, opts) {
      const n = (attempts.get(name) ?? 0) + 1;
      attempts.set(name, n);
      await onPut?.(name, n);
      if (opts?.signal?.aborted) throw new DOMException('cancelled', 'AbortError');
      opts?.onProgress?.(Math.floor(data.length / 2));
      files.set(`${uploadId}/${name}`, { data: data.slice(), type });
      opts?.onProgress?.(data.length);
    },
    async url(uploadId, name) {
      return `${HOST}${uploadId}/${name}`;
    },
    async list() {
      return [...new Set([...files.keys()].map((k) => k.split('/')[0]))];
    },
    async remove(uploadId) {
      removed.push(uploadId);
      for (const k of [...files.keys()]) if (k.startsWith(`${uploadId}/`)) files.delete(k);
    },
    async uses() {
      return [];
    },
  };
  return { store, files, removed };
}

/** Serves the store's files to fetch, as the bucket's public links would. */
function serve(files: Map<string, { data: Uint8Array; type: string }>) {
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    const f = url.startsWith(HOST) ? files.get(url.slice(HOST.length)) : undefined;
    return f ? new Response(f.data as BodyInit, { status: 200, headers: { 'content-type': f.type } }) : new Response('not found', { status: 404 });
  }) as typeof fetch;
  return () => (globalThis.fetch = real);
}

const contains = (hay: Uint8Array, needle: Uint8Array) => {
  outer: for (let i = 0; i + needle.length <= hay.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
};

const video = (n: number) => new Blob([Uint8Array.from({ length: n }, (_, i) => (i * 7 + 3) % 256)], { type: 'video/mp4' });

afterEach(() => clearVideoCache());

describe('uploading a video', () => {
  it('stores an encrypted video folder that the player opens with the link’s key', async () => {
    const { store, files } = memoryStore();
    const file = video(2500);
    const { src, manifest, uploadId } = await uploadVideo(file, store, { title: 'clip.mp4', duration: 95, width: 3840, height: 1920 }, { partSize: 1000 });

    const link = parseVideoLink(src);
    expect(link).toEqual({ kind: 'folder', manifestUrl: `${HOST}${uploadId}/video.json`, key: expect.stringMatching(/^[\w-]{43}$/) });
    expect(manifest).toMatchObject({ format: 'survey-studio-video/1', type: 'video/mp4', encrypted: true, title: 'clip.mp4', duration: 95, width: 3840, height: 1920 });
    expect(manifest.parts).toHaveLength(3);
    for (const p of manifest.parts) expect(p).toMatch(/^part-\d-[0-9a-f]{10}\.bin$/);
    // Each part: 12-byte IV, the bytes, a 16-byte tag.
    expect(manifest.bytes).toBe(2500 + 3 * 28);
    expect(new Date(manifest.uploaded!).getTime()).toBeGreaterThan(Date.now() - 60_000);
    expect(await keyMatches(manifest, link?.kind === 'folder' ? link.key! : '')).toBe(true);
    expect(files.get(`${uploadId}/video.json`)?.type).toBe('application/json');
    expect(files.get(`${uploadId}/${manifest.parts[0]}`)?.type).toBe('application/octet-stream');
    // Nothing readable is stored: the first bytes of the video aren't in any part.
    const head = new Uint8Array(await file.slice(0, 64).arrayBuffer());
    for (const p of manifest.parts) expect(contains(files.get(`${uploadId}/${p}`)!.data, head)).toBe(false);

    const stop = serve(files);
    try {
      const opened = await openVideo(src);
      expect(new Uint8Array(await opened.blob!.arrayBuffer())).toEqual(new Uint8Array(await file.arrayBuffer()));
      expect(opened.blob!.type).toBe('video/mp4');
      opened.release();
    } finally {
      stop();
    }
  });

  it('reports progress in bytes of the file, up to its size', async () => {
    const { store } = memoryStore();
    const seen: number[] = [];
    await uploadVideo(video(2500), store, { title: 'clip.mp4' }, { partSize: 1000, onProgress: (n) => seen.push(n) });
    expect(seen.every((n, i) => i === 0 || n >= seen[i - 1])).toBe(true);
    expect(seen.at(-1)).toBe(2500);
    expect(seen).toContain(1000);
  });

  it('tries a part again after network trouble', async () => {
    const { store, files } = memoryStore((name, attempt) => {
      if (name.startsWith('part-2') && attempt === 1) throw new BackendError('connection lost', 'network');
    });
    const { manifest, uploadId } = await uploadVideo(video(2500), store, { title: 'clip.mp4' }, { partSize: 1000, retryDelays: [0, 0] });
    expect(manifest.parts.every((p) => files.has(`${uploadId}/${p}`))).toBe(true);
  });

  it('gives up on other errors, and deletes what it had stored', async () => {
    const { store, files, removed } = memoryStore((name) => {
      if (name.startsWith('part-2')) throw new BackendError('Your sign-in has expired.', 'auth');
    });
    await expect(uploadVideo(video(2500), store, { title: 'clip.mp4' }, { partSize: 1000, retryDelays: [0] })).rejects.toThrow('Your sign-in has expired.');
    expect(removed).toHaveLength(1);
    expect(files.size).toBe(0);
  });

  it('stops when cancelled, and deletes what it had stored', async () => {
    const abort = new AbortController();
    const { store, files, removed } = memoryStore((name) => {
      if (name.startsWith('part-2')) abort.abort();
    });
    const err = await uploadVideo(video(2500), store, { title: 'clip.mp4' }, { partSize: 1000, signal: abort.signal }).catch((e) => e);
    expect(isCancelled(err)).toBe(true);
    expect(removed).toHaveLength(1);
    expect(files.size).toBe(0);
  });

  it('refuses an empty file', async () => {
    const { store, files } = memoryStore();
    await expect(uploadVideo(new Blob([]), store, { title: 'empty.mp4' })).rejects.toThrow('This file is empty.');
    expect(files.size).toBe(0);
  });
});

describe('which uploads are used where', () => {
  it('reads the video links of stored surveys of any shape', () => {
    const def = {
      blocks: [
        { questions: [{ type: 'video', video: { src: ' https://a.test/v/video.json#k=1 ' } }, { type: 'text_block' }] },
        { questions: [{ type: 'video', video: { src: '' } }, null] },
        { nothing: true },
      ],
    };
    expect(videoLinks(def)).toEqual(['https://a.test/v/video.json#k=1']);
    expect(videoLinks(null)).toEqual([]);
    expect(videoLinks({ blocks: 'no' })).toEqual([]);
  });

  it('finds the surveys that show each upload and a link with its key, newest upload first', () => {
    const manifest: VideoManifest = { format: 'survey-studio-video/1', type: 'video/mp4', parts: ['p'], encrypted: true, uploaded: '2026-11-01T10:00:00Z' };
    const old = { id: 'u1', url: `${HOST}u1/video.json`, manifest };
    const fresh = { id: 'u2', url: `${HOST}u2/video.json`, manifest: { ...old.manifest, uploaded: '2026-11-20T10:00:00Z' } };
    const broken = { id: 'u3', url: `${HOST}u3/video.json`, manifest: null };
    const result = matchUploads(
      [old, fresh, broken],
      [
        { surveyId: 's1', title: 'Study', binned: false, links: [`${HOST}u1/video.json`, 'https://elsewhere.test/clip.mp4'] },
        { surveyId: 's2', title: 'Pilot', binned: true, links: [`${HOST}u1/video.json#k=secret`] },
      ],
    );
    expect(result.map((r) => r.id)).toEqual(['u2', 'u1', 'u3']);
    const u1 = result.find((r) => r.id === 'u1')!;
    expect(u1.usedIn).toEqual([
      { surveyId: 's1', title: 'Study', binned: false },
      { surveyId: 's2', title: 'Pilot', binned: true },
    ]);
    // Only a link with the key can be used again.
    expect(u1.src).toBe(`${HOST}u1/video.json#k=secret`);
    expect(result.find((r) => r.id === 'u2')).toMatchObject({ usedIn: [], src: null });
  });
});
