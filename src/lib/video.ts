// Videos for video questions: either a file on the web, or a "video folder" whose
// manifest (video.json) lists the parts of one file. A folder's parts can be
// encrypted (AES-256-GCM, each part [12-byte IV][ciphertext + tag]); the key then
// travels in the link's fragment, `…/video.json#k=<key>`, which browsers never send
// to the server. Survey links carry it, so participants' browsers open the video
// without a password, while someone browsing the website only finds sealed files.

export interface VideoManifest {
  format: 'survey-studio-video/1';
  /** MIME type of the joined file, e.g. video/mp4. */
  type: string;
  /** Part files, relative to the manifest, joined in this order. */
  parts: string[];
  encrypted: boolean;
  /** Total size of the parts in bytes, for the progress bar. */
  bytes?: number;
  duration?: number;
  width?: number;
  height?: number;
  /** Suggested view for video questions that use this video. */
  view?: 'flat' | 'wrap';
  span?: number;
  fov?: number;
  title?: string;
  /** Encrypted folders: KEY_CHECK sealed with the key, so a link's key can be checked cheaply. */
  check?: string;
}

export const KEY_CHECK = 'survey-studio-video';
const MANIFEST_TIMEOUT = 15000;
const STALL_TIMEOUT = 30000;

/** fetch that gives up when no data arrives for `ms` (a dropped mobile connection otherwise hangs forever). */
async function fetchPatiently(url: string, ms: number, init: RequestInit, onBytes?: (n: number) => void): Promise<ArrayBuffer> {
  const ctrl = new AbortController();
  let timer = setTimeout(() => ctrl.abort(), ms);
  const alive = () => {
    clearTimeout(timer);
    timer = setTimeout(() => ctrl.abort(), ms);
  };
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    if (!res.ok) throw new Error(`couldn’t be loaded (${res.status})`);
    return await readWithProgress(res, (n) => {
      alive();
      onBytes?.(n);
    });
  } catch (e) {
    if (ctrl.signal.aborted) throw new Error(`stopped loading (no data for ${Math.round(ms / 1000)} seconds)`);
    // Browsers word network failures differently ("Failed to fetch", "Load failed").
    if (e instanceof TypeError) throw new Error('couldn’t be reached. Check the link and the internet connection');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

async function importKey(key: string): Promise<CryptoKey> {
  try {
    return await crypto.subtle.importKey('raw', fromBase64url(key) as BufferSource, { name: 'AES-GCM' }, false, ['decrypt']);
  } catch {
    throw new Error('The key in this video link isn’t valid.');
  }
}

async function open(key: CryptoKey, buf: ArrayBuffer): Promise<ArrayBuffer> {
  return crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(buf, 0, 12) }, key, new Uint8Array(buf, 12));
}

/** Whether a link's key opens an encrypted folder (null: the folder can't tell). */
export async function keyMatches(manifest: VideoManifest, key: string): Promise<boolean | null> {
  if (!manifest.check) return null;
  try {
    const plain = await open(await importKey(key), fromBase64url(manifest.check).buffer as ArrayBuffer);
    return new TextDecoder().decode(plain) === KEY_CHECK;
  } catch {
    return false;
  }
}

export type VideoLink = { kind: 'file'; url: string } | { kind: 'folder'; manifestUrl: string; key: string | null };

const FILE_RE = /\.(mp4|m4v|webm|mov|ogv)$/i;

/** Reads a video link. Only https links (and http on this computer, for testing) are accepted. */
export function parseVideoLink(src: string | undefined): VideoLink | null {
  const raw = src?.trim();
  if (!raw) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  const local = u.protocol === 'http:' && /^(localhost|127\.0\.0\.1)$/.test(u.hostname);
  if (u.protocol !== 'https:' && !local) return null;
  if (/\.json$/i.test(u.pathname)) {
    const key = new URLSearchParams(u.hash.slice(1)).get('k');
    u.hash = '';
    return { kind: 'folder', manifestUrl: u.href, key: key || null };
  }
  if (FILE_RE.test(u.pathname)) return { kind: 'file', url: u.href };
  return null;
}

export function base64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64url(text: string): Uint8Array {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function fetchManifest(manifestUrl: string): Promise<VideoManifest> {
  let m: VideoManifest;
  try {
    const buf = await fetchPatiently(manifestUrl, MANIFEST_TIMEOUT, { cache: 'no-cache' });
    m = JSON.parse(new TextDecoder().decode(buf)) as VideoManifest;
  } catch (e) {
    throw new Error(e instanceof SyntaxError ? 'This link isn’t a Survey Studio video folder.' : `The video folder ${e instanceof Error ? e.message : e}.`);
  }
  if (m?.format !== 'survey-studio-video/1' || !Array.isArray(m.parts) || !m.parts.length) throw new Error('This link isn’t a Survey Studio video folder.');
  return m;
}

/* ------------------------------------------------------------- downloads */

interface Download {
  done: Promise<{ blob: Blob; manifest: VideoManifest }>;
  progress: number;
  listeners: Set<(f: number) => void>;
}

// One download per link, shared by the player and prefetching, kept for the whole visit
// (a respondent who goes back and forth doesn't load the video twice).
const downloads = new Map<string, Download>();

async function readWithProgress(res: Response, onBytes: (n: number) => void): Promise<ArrayBuffer> {
  if (!res.body || !res.body.getReader) {
    const buf = await res.arrayBuffer();
    onBytes(buf.byteLength);
    return buf;
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    onBytes(value.length);
  }
  const out = new Uint8Array(got);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out.buffer;
}

function startDownload(src: string, link: Extract<VideoLink, { kind: 'folder' }>): Download {
  const d: Download = { progress: 0, listeners: new Set(), done: Promise.resolve(null as never) };
  const report = (f: number) => {
    d.progress = f;
    d.listeners.forEach((l) => l(f));
  };
  d.done = (async () => {
    const manifest = await fetchManifest(link.manifestUrl);
    if (manifest.encrypted && !link.key) throw new Error('This video is encrypted, but the link has no key (it should end with #k=…).');
    if (!manifest.encrypted && link.key) throw new Error('This video folder isn’t encrypted; remove #k=… from the link.');
    if (manifest.encrypted && (await keyMatches(manifest, link.key!)) === false) throw new Error('The video couldn’t be unlocked: the key in the link doesn’t match.');
    const key = manifest.encrypted ? await importKey(link.key!) : null;
    const total = manifest.bytes || 0;
    let loaded = 0;
    // Each part becomes its own Blob straight away, so the downloaded and decrypted
    // bytes don't all sit in memory twice while the file is put together.
    const parts: Blob[] = [];
    for (let i = 0; i < manifest.parts.length; i++) {
      let buf: ArrayBuffer;
      try {
        // Part names change with their content, so cached copies are always the right ones.
        buf = await fetchPatiently(new URL(manifest.parts[i], link.manifestUrl).href, STALL_TIMEOUT, {}, (n) => {
          loaded += n;
          report(total ? Math.min(0.99, loaded / total) : Math.min(0.99, (i + 0.5) / manifest.parts.length));
        });
      } catch (e) {
        throw new Error(`The video ${e instanceof Error ? e.message : e}.`);
      }
      if (key) {
        try {
          buf = await open(key, buf);
        } catch {
          throw new Error('The video couldn’t be unlocked: the key in the link doesn’t match.');
        }
      }
      parts.push(new Blob([buf]));
    }
    report(1);
    return { blob: new Blob(parts, { type: manifest.type || 'video/mp4' }), manifest };
  })();
  // A failed download can be tried again.
  d.done.catch(() => downloads.get(src) === d && downloads.delete(src));
  return d;
}

function download(src: string): Download | null {
  const link = parseVideoLink(src);
  if (!link || link.kind !== 'folder') return null;
  let d = downloads.get(src);
  if (!d) {
    d = startDownload(src, link);
    downloads.set(src, d);
  }
  return d;
}

/** Starts loading a video folder in the background (e.g. while the respondent reads the consent page). */
export function prefetchVideo(src: string) {
  download(src)?.done.catch(() => {
    /* the player shows the error, and can try again */
  });
}

export interface OpenedVideo {
  url: string;
  manifest?: VideoManifest;
  /** The joined file, for folders. */
  blob?: Blob;
  /** Frees the memory behind the URL. */
  release: () => void;
}

/** A URL the video element can play: the file itself, or the joined (and decrypted) folder. */
export async function openVideo(src: string, onProgress?: (f: number) => void): Promise<OpenedVideo> {
  const link = parseVideoLink(src);
  if (!link) throw new Error('This isn’t a video link.');
  if (link.kind === 'file') return { url: link.url, release: () => {} };
  const d = download(src)!;
  if (onProgress) {
    d.listeners.add(onProgress);
    onProgress(d.progress);
  }
  try {
    const { blob, manifest } = await d.done;
    const url = URL.createObjectURL(blob);
    return { url, manifest, blob, release: () => URL.revokeObjectURL(url) };
  } finally {
    if (onProgress) d.listeners.delete(onProgress);
  }
}

/** Forgets downloaded videos (tests). */
export function clearVideoCache() {
  downloads.clear();
}
