// Videos uploaded from the researcher's computer for video questions. The browser turns
// the file into an encrypted video folder, the same format scripts/seal-video.mjs makes
// (AES-256-GCM parts and a video.json manifest, see video.ts), and hands the files to the
// backend's VideoStore: Supabase Storage, or this browser without a database. The video
// link then carries the key (…/video.json#k=…), so the stored files are sealed.

import { BackendError, type SurveyVideoLinks, type VideoStore } from './backend/types';
import { uuid } from './ids';
import type { VideoSettings } from './types';
import { KEY_CHECK, base64url, parseVideoLink, type VideoManifest } from './video';

/** How a new video question shows its video. */
export const VIDEO_DEFAULTS: VideoSettings = { src: '', view: 'wrap', span: 180, fov: 90, tilt: false };

/** 8 MiB parts: cheap to send again after a dropped connection, and few enough for respondents' downloads. */
export const PART_SIZE = 8 * 1024 * 1024;

/** Waits before trying a part again after network trouble. */
const RETRY_DELAYS = [1000, 4000, 10000];
const CLEANUP_AGAIN_MS = 8000;

/** What the manifest says about the video, for the builder (respondents never see it). */
export interface VideoInfo {
  title: string;
  duration?: number;
  width?: number;
  height?: number;
}

export const isVideoFile = (f: { type?: string; name?: string }) => /^video\//.test(f.type ?? '') || /\.(mp4|m4v|webm|mov)$/i.test(f.name ?? '');

export function videoType(f: { type?: string; name?: string }): string {
  if (f.type && /^video\//.test(f.type)) return f.type;
  const name = f.name ?? '';
  return /\.webm$/i.test(name) ? 'video/webm' : /\.mov$/i.test(name) ? 'video/quicktime' : 'video/mp4';
}

export const cancelled = () => new DOMException('The upload was cancelled.', 'AbortError');
export const isCancelled = (e: unknown) => e instanceof Error && e.name === 'AbortError';

async function seal(key: CryptoKey, bytes: Uint8Array): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes as BufferSource));
  const out = new Uint8Array(12 + sealed.length);
  out.set(iv, 0);
  out.set(sealed, 12);
  return out;
}

/** Part names carry a hash of their content, like seal-video's, so caches never mix versions. */
async function shortHash(bytes: Uint8Array): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource));
  return Array.from(d.subarray(0, 5), (b) => b.toString(16).padStart(2, '0')).join('');
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(cancelled());
    const t = setTimeout(done, ms);
    function done() {
      signal?.removeEventListener('abort', stop);
      resolve();
    }
    function stop() {
      clearTimeout(t);
      reject(cancelled());
    }
    signal?.addEventListener('abort', stop, { once: true });
  });
}

type PutOptions = Parameters<VideoStore['put']>[4];

/** store.put, tried again after network trouble (a part that did arrive counts as stored). */
async function putPatiently(store: VideoStore, uploadId: string, name: string, data: Uint8Array, type: string, opts: PutOptions, delays: number[]) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await store.put(uploadId, name, data, type, opts);
    } catch (e) {
      if (isCancelled(e) || !(e instanceof BackendError && e.code === 'network') || attempt >= delays.length) throw e;
      await wait(delays[attempt], opts?.signal);
    }
  }
}

export interface UploadOptions {
  /** Bytes of the file sent so far. */
  onProgress?: (sent: number) => void;
  signal?: AbortSignal;
  partSize?: number;
  retryDelays?: number[];
}

export interface UploadResult {
  /** The video link, key included. */
  src: string;
  manifest: VideoManifest;
  uploadId: string;
}

/**
 * Encrypts a video part by part (only one part is in memory at a time) and stores the
 * parts and the manifest. Whatever was stored is deleted again if it fails or is cancelled.
 */
export async function uploadVideo(file: Blob, store: VideoStore, info: VideoInfo, opts: UploadOptions = {}): Promise<UploadResult> {
  const { signal } = opts;
  const partSize = opts.partSize ?? PART_SIZE;
  const delays = opts.retryDelays ?? RETRY_DELAYS;
  if (!file.size) throw new Error('This file is empty.');
  const uploadId = uuid();
  try {
    const keyBytes = crypto.getRandomValues(new Uint8Array(32));
    const key = await crypto.subtle.importKey('raw', keyBytes as BufferSource, { name: 'AES-GCM' }, false, ['encrypt']);
    const parts: string[] = [];
    let bytes = 0;
    for (let off = 0; off < file.size; off += partSize) {
      if (signal?.aborted) throw cancelled();
      const plain = new Uint8Array(await file.slice(off, Math.min(file.size, off + partSize)).arrayBuffer());
      const sealed = await seal(key, plain);
      const name = `part-${parts.length + 1}-${await shortHash(sealed)}.bin`;
      const onProgress = (sent: number) => opts.onProgress?.(off + Math.round((Math.min(sent, sealed.length) / sealed.length) * plain.length));
      await putPatiently(store, uploadId, name, sealed, 'application/octet-stream', { signal, onProgress }, delays);
      parts.push(name);
      bytes += sealed.length;
      opts.onProgress?.(off + plain.length);
    }
    const manifest: VideoManifest = {
      format: 'survey-studio-video/1',
      type: videoType(file as Blob & { name?: string }),
      parts,
      encrypted: true,
      bytes,
      duration: info.duration,
      width: info.width,
      height: info.height,
      title: info.title,
      uploaded: new Date().toISOString(),
      check: base64url(await seal(key, new TextEncoder().encode(KEY_CHECK))),
    };
    const json = new TextEncoder().encode(JSON.stringify(manifest, null, 2) + '\n');
    await putPatiently(store, uploadId, 'video.json', json, 'application/json', { signal }, delays);
    const url = await store.url(uploadId, 'video.json');
    return { src: `${url}#k=${base64url(keyBytes)}`, manifest, uploadId };
  } catch (e) {
    // Parts without the rest (and without the key) are of no use to anyone. A part that was
    // on its way when the upload was cancelled may still arrive, so look again a bit later.
    await store.remove(uploadId).catch(() => {});
    setTimeout(() => void store.remove(uploadId).catch(() => {}), CLEANUP_AGAIN_MS);
    throw e;
  }
}

/**
 * What a browser makes of a video file: its length and picture size, or null when it can't
 * show the picture (an unsupported format, or HEVC where only the sound plays).
 */
export function probeVideo(file: Blob): Promise<{ duration?: number; width: number; height: number } | null> {
  const url = URL.createObjectURL(file);
  const v = document.createElement('video');
  v.preload = 'metadata';
  v.muted = true;
  return new Promise<{ duration?: number; width: number; height: number } | null>((resolve) => {
    const t = setTimeout(() => resolve(null), 20000);
    v.onloadedmetadata = () => {
      clearTimeout(t);
      const duration = Number.isFinite(v.duration) ? Math.round(v.duration * 10) / 10 : undefined;
      resolve(v.videoWidth && v.videoHeight ? { duration, width: v.videoWidth, height: v.videoHeight } : null);
    };
    v.onerror = () => {
      clearTimeout(t);
      resolve(null);
    };
    v.src = url;
  }).finally(() => {
    v.removeAttribute('src');
    v.load();
    URL.revokeObjectURL(url);
  });
}

/** Every video question's link in a survey definition (read as raw JSON, so stored copies of any age work). */
export function videoLinks(def: unknown): string[] {
  const out: string[] = [];
  const blocks = (def as { blocks?: unknown } | null)?.blocks;
  if (!Array.isArray(blocks)) return out;
  for (const b of blocks) {
    const questions = (b as { questions?: unknown } | null)?.questions;
    if (!Array.isArray(questions)) continue;
    for (const q of questions) {
      const src = (q as { video?: { src?: unknown } } | null)?.video?.src;
      if (typeof src === 'string' && src.trim()) out.push(src.trim());
    }
  }
  return out;
}

export interface UploadedVideo {
  id: string;
  /** The manifest's address, without a key. */
  url: string;
  /** Null when it can't be read (an upload that never finished, for example). */
  manifest: VideoManifest | null;
  /** Surveys whose working copy or published version show it. */
  usedIn: { surveyId: string; title: string; binned: boolean }[];
  /** A link with the key, taken from a survey that uses it; null when no survey has one. */
  src: string | null;
}

const sameAddress = (a: string) => {
  try {
    return new URL(a).href;
  } catch {
    return a;
  }
};

/** Which uploads are used where, newest upload first. */
export function matchUploads(uploads: { id: string; url: string; manifest: VideoManifest | null }[], surveys: SurveyVideoLinks[]): UploadedVideo[] {
  return uploads
    .map((u) => {
      const address = sameAddress(u.url);
      const usedIn: UploadedVideo['usedIn'] = [];
      let src: string | null = null;
      for (const s of surveys) {
        let uses = false;
        for (const l of s.links) {
          const link = parseVideoLink(l);
          if (link?.kind !== 'folder' || link.manifestUrl !== address) continue;
          uses = true;
          if (link.key && !src) src = l;
        }
        if (uses) usedIn.push({ surveyId: s.surveyId, title: s.title, binned: s.binned });
      }
      return { ...u, url: address, usedIn, src };
    })
    .sort((a, b) => (b.manifest?.uploaded ?? '').localeCompare(a.manifest?.uploaded ?? ''));
}
