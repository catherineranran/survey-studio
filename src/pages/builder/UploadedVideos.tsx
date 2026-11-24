import { useEffect, useState } from 'react';
import { Button, Dialog, Spinner, formatDateTime, useConfirm } from '../../components/ui';
import type { VideoStore } from '../../lib/backend/types';
import type { Survey } from '../../lib/types';
import { fetchManifest, parseVideoLink } from '../../lib/video';
import { matchUploads, videoLinks, type UploadedVideo } from '../../lib/videoUpload';

export const megabytes = (n: number) => (n / 1048576).toFixed(n < 10 * 1048576 ? 1 : 0);

export function clock(sec: number) {
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Your uploaded videos: where each is used, "Use here" for one a survey already shows
 * (its key comes from that survey's link), and deleting the ones no survey uses.
 */
export function UploadedVideos({
  open,
  onClose,
  store,
  survey,
  surveyId,
  current,
  onUse,
}: {
  open: boolean;
  onClose: () => void;
  store: VideoStore;
  /** The working copy of the survey being built (it may not be saved yet). */
  survey: Survey;
  surveyId: string;
  /** This question's video link. */
  current: string;
  onUse: (src: string, name: string | undefined) => void;
}) {
  const confirm = useConfirm();
  const [items, setItems] = useState<UploadedVideo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [round, setRound] = useState(0);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setError(null);
    (async () => {
      const [ids, uses] = await Promise.all([store.list(), store.uses()]);
      // This survey as it is now, as well as stored (the copy here may not be saved yet).
      const here = videoLinks(survey);
      const surveys = uses.map((s) => (s.surveyId === surveyId ? { ...s, title: survey.title, links: [...s.links, ...here] } : s));
      if (!surveys.some((s) => s.surveyId === surveyId)) surveys.push({ surveyId, title: survey.title, binned: false, links: here });
      const uploads = await Promise.all(
        ids.map(async (id) => {
          const url = await store.url(id, 'video.json');
          return { id, url, manifest: await fetchManifest(url).catch(() => null) };
        }),
      );
      return matchUploads(uploads, surveys);
    })().then(
      (list) => !cancelled && setItems(list),
      (e) => !cancelled && setError(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      cancelled = true;
    };
    // The survey is read when the dialog opens; edits behind the dialog can't happen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, round, store, surveyId]);

  const currentFolder = (() => {
    const l = parseVideoLink(current);
    return l?.kind === 'folder' ? l.manifestUrl : null;
  })();
  const total = (items ?? []).reduce((n, it) => n + (it.manifest?.bytes ?? 0), 0);

  const remove = async (it: UploadedVideo) => {
    const title = it.manifest?.title || 'This unfinished upload';
    const ok = await confirm({
      title: 'Delete this video for good?',
      message: `“${title}”${it.manifest?.bytes ? ` (${megabytes(it.manifest.bytes)} MB)` : ''} will be deleted from ${store.where === 'online' ? 'your Supabase project' : 'this browser'}. No survey shows it. This can’t be undone.`,
      confirmLabel: 'Delete video',
      danger: true,
    });
    if (!ok) return;
    setDeleting(it.id);
    try {
      await store.remove(it.id);
      setItems((list) => list?.filter((x) => x.id !== it.id) ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setRound((r) => r + 1);
    } finally {
      setDeleting(null);
    }
  };

  const usedText = (it: UploadedVideo) => {
    if (!it.usedIn.length) return it.manifest ? 'Not in any survey, so it can’t be opened any more: its key was only in a survey’s video link.' : 'An upload that didn’t finish.';
    const names = it.usedIn.map((u) => `${u.surveyId === surveyId ? 'this survey' : `“${u.title || 'Untitled survey'}”`}${u.binned ? ' (in the bin)' : ''}`);
    return `In ${names.join(', ')}`;
  };

  return (
    <Dialog open={open} onClose={onClose} title="Uploaded videos" wide>
      <p className="hint">
        {store.where === 'online'
          ? 'Videos you uploaded, encrypted, in your Supabase project’s storage. The free plan includes 1 GB of storage and 5 GB of downloads a month, and every respondent downloads the whole video.'
          : 'Videos you uploaded into this browser. Like everything without a database, they only play here.'}
      </p>
      {error && <p className="field-error">{error}</p>}
      {!items ? (
        !error && <Spinner label="Loading your videos" />
      ) : !items.length ? (
        <p className="uploads-empty">Nothing uploaded yet. Use “Upload a video…” in a video question.</p>
      ) : (
        <>
          <p className="uploads-total">
            {items.length} {items.length === 1 ? 'video' : 'videos'}, {megabytes(total)} MB in all
          </p>
          <ul className="uploads">
            {items.map((it) => {
              const m = it.manifest;
              const inThisQuestion = !!currentFolder && it.url === currentFolder;
              const details = [
                m?.duration ? clock(m.duration) : null,
                m?.width && m?.height ? `${m.width} × ${m.height}` : null,
                m?.bytes ? `${megabytes(m.bytes)} MB` : null,
                m?.uploaded ? `uploaded ${formatDateTime(m.uploaded)}` : null,
              ].filter(Boolean);
              return (
                <li key={it.id} className="upload-row">
                  <div className="upload-row-text">
                    <span className="upload-row-name">{m?.title || 'Unfinished upload'}</span>
                    {details.length > 0 && <span className="hint">{details.join(' · ')}</span>}
                    <span className={`hint ${it.usedIn.length ? '' : 'upload-row-unused'}`}>{usedText(it)}</span>
                  </div>
                  <div className="upload-row-actions">
                    {inThisQuestion ? (
                      <span className="upload-row-tag">In this question</span>
                    ) : (
                      it.src && (
                        <Button
                          size="sm"
                          onClick={() => {
                            onUse(it.src!, m?.title);
                            onClose();
                          }}
                        >
                          Use here
                        </Button>
                      )
                    )}
                    {!it.usedIn.length && (
                      <Button size="sm" variant="danger" icon="trash" disabled={deleting === it.id} onClick={() => void remove(it)}>
                        {deleting === it.id ? 'Deleting…' : 'Delete'}
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </Dialog>
  );
}
