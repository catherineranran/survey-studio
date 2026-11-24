// Video uploads in progress. They live outside React, so an upload goes on when the
// question's editor closes or another tab of the survey opens; when it's done, the video
// goes into the question through the survey's open workspace, or, if the survey has been
// left meanwhile, into its stored working copy.

import { createContext, useSyncExternalStore } from 'react';
import type { Backend } from '../../lib/backend';
import type { VideoSettings } from '../../lib/types';
import { VIDEO_DEFAULTS, isCancelled, uploadVideo, type VideoInfo } from '../../lib/videoUpload';

/** Given by the workspace to its owner (collaborator links can't upload). */
export const VideoUploadContext = createContext<{ surveyId: string } | null>(null);

export interface UploadJob {
  fileName: string;
  size: number;
  /** Bytes of the file sent so far. */
  sent: number;
  state: 'uploading' | 'failed';
  error?: string;
}

type Apply = (qid: string, patch: Partial<VideoSettings>) => void;

interface Control {
  backend: Backend;
  file: File;
  info: VideoInfo;
  abort: AbortController;
}

const jobs = new Map<string, UploadJob>();
const controls = new Map<string, Control>();
const appliers = new Map<string, Apply>();
const listeners = new Set<() => void>();
const keyOf = (surveyId: string, qid: string) => `${surveyId} ${qid}`;

function subscribe(l: () => void) {
  listeners.add(l);
  return () => void listeners.delete(l);
}

function setJob(key: string, job: UploadJob | null) {
  if (job) jobs.set(key, job);
  else jobs.delete(key);
  listeners.forEach((l) => l());
  guardUnload();
}

/** The upload of a question's video, if one is going on (or failed). */
export function useUploadJob(surveyId: string | undefined, qid: string): UploadJob | undefined {
  return useSyncExternalStore(subscribe, () => (surveyId ? jobs.get(keyOf(surveyId, qid)) : undefined));
}

/** The workspace puts finished uploads into its working copy while it's open. */
export function registerVideoApplier(surveyId: string, apply: Apply): () => void {
  appliers.set(surveyId, apply);
  return () => {
    if (appliers.get(surveyId) === apply) appliers.delete(surveyId);
  };
}

export function startUpload(backend: Backend, surveyId: string, qid: string, file: File, info: VideoInfo) {
  const key = keyOf(surveyId, qid);
  if (jobs.get(key)?.state === 'uploading') return;
  const abort = new AbortController();
  controls.set(key, { backend, file, info, abort });
  setJob(key, { fileName: file.name, size: file.size, sent: 0, state: 'uploading' });
  let shown = 0;
  uploadVideo(file, backend.videoStore(), info, {
    signal: abort.signal,
    onProgress: (sent) => {
      const job = jobs.get(key);
      // About 200 steps are plenty for a progress bar.
      if (!job || job.state !== 'uploading' || (sent - shown < file.size / 200 && sent < file.size)) return;
      shown = sent;
      setJob(key, { ...job, sent });
    },
  }).then(
    async ({ src }) => {
      const patch = { src, name: file.name };
      const apply = appliers.get(surveyId);
      if (apply) apply(qid, patch);
      else await applyStored(backend, surveyId, qid, patch).catch(() => {});
      if (controls.get(key)?.abort === abort) controls.delete(key);
      setJob(key, null);
    },
    (e) => {
      if (controls.get(key)?.abort !== abort) return;
      if (isCancelled(e)) {
        controls.delete(key);
        return setJob(key, null);
      }
      setJob(key, { fileName: file.name, size: file.size, sent: 0, state: 'failed', error: e instanceof Error ? e.message : String(e) });
    },
  );
}

export function cancelUpload(surveyId: string, qid: string) {
  controls.get(keyOf(surveyId, qid))?.abort.abort();
}

export function retryUpload(surveyId: string, qid: string) {
  const c = controls.get(keyOf(surveyId, qid));
  if (c) startUpload(c.backend, surveyId, qid, c.file, c.info);
}

export function dismissUpload(surveyId: string, qid: string) {
  const key = keyOf(surveyId, qid);
  controls.delete(key);
  setJob(key, null);
}

/** The survey was left before the upload finished: put the video into its stored working copy. */
async function applyStored(backend: Backend, surveyId: string, qid: string, patch: Partial<VideoSettings>) {
  const rec = await backend.getSurvey(surveyId);
  const q = rec?.definition.blocks.flatMap((b) => b.questions).find((x) => x.id === qid);
  if (!rec || !q) return;
  q.video = { ...VIDEO_DEFAULTS, ...q.video, ...patch };
  await backend.saveDraft(surveyId, rec.definition, rec.updatedAt);
}

// Closing the tab or reloading would end an upload halfway, so the browser asks first.
let guarded = false;
const onBeforeUnload = (e: BeforeUnloadEvent) => {
  e.preventDefault();
  e.returnValue = '';
};
function guardUnload() {
  const busy = [...jobs.values()].some((j) => j.state === 'uploading');
  if (busy === guarded || typeof window === 'undefined') return;
  guarded = busy;
  if (busy) window.addEventListener('beforeunload', onBeforeUnload);
  else window.removeEventListener('beforeunload', onBeforeUnload);
}
