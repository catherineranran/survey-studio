import { useEffect, useId, useRef, useState } from 'react';
import { Field, NumberInput, Toggle } from '../../components/ui';
import type { Question, VideoSettings } from '../../lib/types';
import { fetchManifest, keyMatches, parseVideoLink } from '../../lib/video';
import type { QMutate } from './QuestionEditor';

const DEFAULTS: VideoSettings = { src: '', view: 'wrap', span: 180, fov: 90, tilt: false };

function duration(sec: number) {
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** The video of a video question: its link, and how it's shown. */
export function VideoEditor({ q, change }: { q: Question; change: QMutate }) {
  const id = useId();
  const v = { ...DEFAULTS, ...q.video };
  const set = (patch: Partial<VideoSettings>, key?: string) => change((x) => void (x.video = { ...DEFAULTS, ...x.video, ...patch }), key);
  const link = parseVideoLink(v.src);
  const [check, setCheck] = useState<{ ok: boolean; text: string } | null>(null);
  // A pasted video folder suggests how to show it; take that once, for the new link.
  const appliedFor = useRef(v.src);

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
          m.duration ? duration(m.duration) : null,
          m.width && m.height ? `${m.width} × ${m.height}` : null,
          m.bytes ? `${Math.round(m.bytes / 1048576)} MB` : null,
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

  const linkError = v.src.trim() && !link ? 'Use a link that starts with https:// and ends in .mp4, .webm or .mov, or a video folder link (…/video.json).' : null;
  return (
    <div className="video-edit" data-no-format>
      <Field
        label="Video link"
        htmlFor={`${id}-src`}
        error={linkError ?? (check && !check.ok ? check.text : null)}
        hint={check?.ok ? check.text : 'A video file on the web (.mp4, .webm), or a video folder link (…/video.json#k=…) for an encrypted video.'}
      >
        <input
          id={`${id}-src`}
          className="input mono"
          type="url"
          value={v.src}
          placeholder="https://"
          spellCheck={false}
          onChange={(e) => set({ src: e.target.value.trim() }, 'src')}
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
    </div>
  );
}
