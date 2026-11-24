import { useContext, useEffect, useId, useRef, useState } from 'react';
import { Button, Field, NumberInput, Toggle } from '../../components/ui';
import { useBackend } from '../../lib/backend/context';
import type { Question, Survey, VideoSettings } from '../../lib/types';
import { fetchManifest, keyMatches, parseVideoLink } from '../../lib/video';
import { VIDEO_DEFAULTS, isVideoFile, probeVideo } from '../../lib/videoUpload';
import type { QMutate } from './QuestionEditor';
import { UploadedVideos, clock, megabytes } from './UploadedVideos';
import { VideoUploadContext, cancelUpload, dismissUpload, retryUpload, startUpload, useUploadJob, type UploadJob } from './uploadJobs';

const ACCEPT = 'video/mp4,video/webm,video/quicktime,.mp4,.m4v,.webm,.mov';

/** The video of a video question: its link (or an upload), and how it's shown. */
export function VideoEditor({ survey, q, change }: { survey: Survey; q: Question; change: QMutate }) {
  const id = useId();
  const v = { ...VIDEO_DEFAULTS, ...q.video };
  const set = (patch: Partial<VideoSettings>, key?: string) => change((x) => void (x.video = { ...VIDEO_DEFAULTS, ...x.video, ...patch }), key);
  const link = parseVideoLink(v.src);
  const [check, setCheck] = useState<{ ok: boolean; text: string } | null>(null);
  // A pasted video folder suggests how to show it; take that once, for the new link.
  const appliedFor = useRef(v.src);

  const backend = useBackend();
  const uploads = useContext(VideoUploadContext);
  const job = useUploadJob(uploads?.surveyId, q.id);
  const fileInput = useRef<HTMLInputElement>(null);
  const [probing, setProbing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const store = uploads ? backend.videoStore() : null;

  useEffect(() => {
    const l = parseVideoLink(v.src);
    if (!l || l.kind !== 'folder') {
      setCheck(null);
      return;
    }
    let cancelled = false;
    setCheck({ ok: true, text: 'Checking the video folder …' });
    fetchManifest(l.manifestUrl)
      .then(async (m) => {
        if (cancelled) return;
        if (m.encrypted && !l.key) return setCheck({ ok: false, text: 'This video is encrypted, so the link needs its key at the end (#k=…).' });
        if (m.encrypted && l.key && (await keyMatches(m, l.key)) === false) {
          if (!cancelled) setCheck({ ok: false, text: 'The key at the end of this link doesn’t open the video. Copy the whole link again.' });
          return;
        }
        if (cancelled) return;
        const parts = [
          m.title,
          m.encrypted ? 'encrypted' : 'not encrypted',
          m.duration ? clock(m.duration) : null,
          m.width && m.height ? `${m.width} × ${m.height}` : null,
          m.bytes ? `${megabytes(m.bytes)} MB` : null,
        ];
        setCheck({ ok: true, text: `Found: ${parts.filter(Boolean).join(' · ')}` });
        if (appliedFor.current !== v.src) {
          appliedFor.current = v.src;
          if (m.view || m.span || m.fov) set({ view: m.view ?? v.view, span: m.span ?? v.span, fov: m.fov ?? v.fov });
        }
      })
      .catch((e) => !cancelled && setCheck({ ok: false, text: e instanceof Error ? e.message : String(e) }));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v.src]);

  const upload = async (file: File | undefined) => {
    if (!file || !uploads) return;
    setNotice(null);
    if (!isVideoFile(file)) return setNotice('Choose a video file: .mp4, .webm or .mov.');
    setProbing(true);
    const meta = await probeVideo(file);
    setProbing(false);
    if (!meta)
      return setNotice(
        'This browser can’t show the picture of this video, so many respondents’ browsers couldn’t either. Convert it to MP4 (H.264), for example with HandBrake, and upload that.',
      );
    startUpload(backend, uploads.surveyId, q.id, file, { title: file.name, ...meta });
  };

  const uploading = job?.state === 'uploading';
  const busy = probing || uploading;
  const linkError = v.src.trim() && !link ? 'Use a link that starts with https:// and ends in .mp4, .webm or .mov, or a video folder link (…/video.json).' : null;
  return (
    <div className="video-edit" data-no-format>
      {uploads && store && (
        <div className="video-upload">
          <div className="video-upload-actions">
            <Button size="sm" icon="upload" disabled={busy} onClick={() => fileInput.current?.click()}>
              {v.src ? 'Upload another video…' : 'Upload a video…'}
            </Button>
            <Button size="sm" variant="ghost" disabled={uploading} onClick={() => setLibraryOpen(true)}>
              Uploaded videos
            </Button>
            <input
              ref={fileInput}
              type="file"
              accept={ACCEPT}
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                void upload(file);
              }}
            />
          </div>
          {probing && <p className="hint">Checking the video …</p>}
          {notice && <p className="field-error">{notice}</p>}
          {job ? (
            <UploadStatus
              job={job}
              onCancel={() => cancelUpload(uploads.surveyId, q.id)}
              onRetry={() => retryUpload(uploads.surveyId, q.id)}
              onDismiss={() => dismissUpload(uploads.surveyId, q.id)}
            />
          ) : (
            !probing &&
            !notice && (
              <p className="hint">
                {store.where === 'online'
                  ? 'From your computer: encrypted in your browser, then stored in your Supabase project.'
                  : 'From your computer. Without a database, the video stays in this browser and plays only here.'}{' '}
                Respondents’ browsers load the whole video before it plays, so smaller files start sooner.
              </p>
            )
          )}
        </div>
      )}
      <Field
        label="Video link"
        htmlFor={`${id}-src`}
        error={linkError ?? (check && !check.ok ? check.text : null)}
        hint={
          uploading
            ? 'Filled in when the upload is done.'
            : check?.ok
              ? check.text
              : `${uploads ? 'Filled in by an upload, or paste one: a' : 'A'} video file on the web (.mp4, .webm), or a video folder link (…/video.json#k=…) for an encrypted video.`
        }
      >
        <input
          id={`${id}-src`}
          className="input mono"
          type="url"
          value={v.src}
          placeholder="https://"
          spellCheck={false}
          // The upload fills it in when it's done; a link typed meanwhile would be overwritten.
          readOnly={uploading}
          onChange={(e) => set({ src: e.target.value.trim(), name: undefined }, 'src')}
        />
      </Field>
      <Field label="Shown as" htmlFor={`${id}-view`}>
        <select id={`${id}-view`} className="input" value={v.view} onChange={(e) => set({ view: e.target.value as VideoSettings['view'] })}>
          <option value="wrap">Magic window: respondents look around in it</option>
          <option value="flat">Ordinary video</option>
        </select>
      </Field>
      {v.view === 'wrap' && (
        <>
          <div className="grid-2">
            <Field label="Picture reaches around (°)" htmlFor={`${id}-span`} hint="180 for VR180 footage, 360 for 360° video.">
              <NumberInput id={`${id}-span`} value={v.span} min={60} max={360} onChange={(n) => n !== null && set({ span: Math.max(60, Math.min(360, n)) }, 'span')} />
            </Field>
            <Field label="Visible at once (°)" htmlFor={`${id}-fov`} hint="Across the screen. Wider shows more but bends the edges.">
              <NumberInput id={`${id}-fov`} value={v.fov} min={20} max={170} onChange={(n) => n !== null && set({ fov: Math.max(20, Math.min(170, n)) }, 'fov')} />
            </Field>
          </div>
          <Field
            label="Look-around area (°, optional)"
            htmlFor={`${id}-reach`}
            hint="Keeps respondents to the central part of the picture, e.g. 140 so a 180° video turns exactly as far as a 140° one. Empty: the whole picture."
          >
            <NumberInput
              id={`${id}-reach`}
              value={v.reach ?? null}
              min={30}
              max={360}
              placeholder={String(v.span)}
              onChange={(n) => set({ reach: n === null ? undefined : Math.max(30, Math.min(360, n)) }, 'reach')}
            />
          </Field>
          <Toggle
            label="Phones and tablets: move the device to look around"
            hint="As well as dragging. iPhones and iPads ask respondents for permission first."
            checked={!!v.tilt}
            onChange={(on) => set({ tilt: on })}
          />
        </>
      )}
      <Toggle
        label="Fill the window while it plays"
        hint="Starting the video enlarges it to the whole browser window. When it ends, it goes back to its place on the page, where respondents continue. Esc or “Exit full screen” makes it smaller earlier."
        checked={!!v.fillWindow}
        onChange={(on) => set({ fillWindow: on })}
      />
      <p className="hint">
        {q.required
          ? 'Respondents can continue once they’ve watched it to the end (or if it can’t play on their device).'
          : 'Respondents can continue without watching. Switch on Required to make them watch it to the end.'}{' '}
        The data records seconds played, whether it reached the end{v.view === 'wrap' ? ' and where people looked each second' : ''}.
      </p>
      {uploads && store && libraryOpen && (
        <UploadedVideos
          open
          onClose={() => setLibraryOpen(false)}
          store={store}
          survey={survey}
          surveyId={uploads.surveyId}
          current={v.src}
          onUse={(src, name) => {
            // Shown as it was set up; the folder suggests nothing.
            appliedFor.current = src;
            set({ src, name });
          }}
        />
      )}
    </div>
  );
}

function UploadStatus({ job, onCancel, onRetry, onDismiss }: { job: UploadJob; onCancel: () => void; onRetry: () => void; onDismiss: () => void }) {
  if (job.state === 'failed')
    return (
      <div className="upload-status is-failed" role="alert">
        <p>
          <strong>“{job.fileName}” wasn’t uploaded.</strong> {job.error}
        </p>
        <div className="upload-status-line">
          <Button size="sm" onClick={onRetry}>
            Try again
          </Button>
          <Button size="sm" variant="ghost" onClick={onDismiss}>
            Dismiss
          </Button>
        </div>
      </div>
    );
  return (
    <div className="upload-status">
      <div className="upload-status-line">
        <span className="upload-status-name">{job.fileName}</span>
        <span className="upload-status-amount">
          {megabytes(job.sent)} of {megabytes(job.size)} MB
        </span>
      </div>
      <progress className="upload-bar" max={job.size || 1} value={job.sent} aria-label={`Uploading ${job.fileName}`} />
      <div className="upload-status-line">
        <span className="hint">Encrypting and uploading. You can keep working; keep this tab open until it’s done.</span>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
