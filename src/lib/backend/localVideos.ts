// Without a database, uploaded videos stay in this browser, in IndexedDB (localStorage is
// far too small for them). Their links look like local-video://uploads/<id>/video.json#k=…
// and, like everything else in local mode, only work in this browser.

import { LOCAL_VIDEO_PREFIX } from '../video';
import { cancelled } from '../videoUpload';
import { BackendError, type SurveyVideoLinks, type VideoStore } from './types';

const DB_NAME = 'survey-studio-videos';
const FILES = 'files';
const PREFIX = `${LOCAL_VIDEO_PREFIX}uploads/`;

const unavailable = () =>
  new BackendError('This browser doesn’t let Survey Studio keep videos (in a private window, for example). Use a video link instead.', 'storage');

let opening: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!opening) {
    opening = new Promise<IDBDatabase>((resolve, reject) => {
      let req: IDBOpenDBRequest;
      try {
        req = indexedDB.open(DB_NAME, 1);
      } catch {
        return reject(unavailable());
      }
      req.onupgradeneeded = () => req.result.createObjectStore(FILES);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(unavailable());
    });
    opening.catch(() => (opening = null));
  }
  return opening;
}

/** One request in its own transaction; resolves once the transaction is done. */
async function run<T>(mode: IDBTransactionMode, request: (files: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(FILES, mode);
    const req = request(tx.objectStore(FILES));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = tx.onabort = () => {
      const err = tx.error ?? req.error;
      reject(
        err?.name === 'QuotaExceededError'
          ? new BackendError('This browser has no room left for the video. Free up disk space, or use a video link instead.', 'storage')
          : new BackendError(`The video couldn’t be kept in this browser (${err?.message ?? 'unknown problem'}).`, 'storage'),
      );
    };
  });
}

/** A file of a video uploaded into this browser; null when it isn't here. */
export async function readLocalVideo(url: string): Promise<Blob | null> {
  const path = url.replace(/#.*$/, '');
  if (!path.startsWith(PREFIX)) return null;
  try {
    return ((await run('readonly', (s) => s.get(decodeURIComponent(path.slice(PREFIX.length))))) as Blob | undefined) ?? null;
  } catch {
    return null;
  }
}

export function createLocalVideoStore(surveys: () => SurveyVideoLinks[]): VideoStore {
  return {
    where: 'browser',
    async put(uploadId, name, data, type, opts) {
      if (opts?.signal?.aborted) throw cancelled();
      await run('readwrite', (s) => s.put(new Blob([data as BlobPart], { type }), `${uploadId}/${name}`));
      opts?.onProgress?.(data.length);
    },
    async url(uploadId, name) {
      return `${PREFIX}${uploadId}/${name}`;
    },
    async list() {
      const keys = await run('readonly', (s) => s.getAllKeys());
      return [...new Set(keys.map((k) => String(k).split('/')[0]))];
    },
    async remove(uploadId) {
      await run('readwrite', (s) => s.delete(IDBKeyRange.bound(`${uploadId}/`, `${uploadId}/￿`)));
    },
    async uses() {
      return surveys();
    },
  };
}
