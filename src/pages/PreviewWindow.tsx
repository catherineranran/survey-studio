import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Icon, Spinner } from '../components/ui';
import { useBackend } from '../lib/backend/context';
import type { ForcedArms } from '../lib/engine';
import { flowSteps, placeOf } from '../lib/flow';
import { hashQuery, isPreviewDraftKey, parsePreviewDraft, previewHash, readPreviewDraft, readPreviewPrefs, writePreviewPrefs, type PreviewPrefs } from '../lib/preview';
import type { Survey } from '../lib/types';
import { Respond } from './Respond';

/**
 * The preview window: runs the builder's working copy like a respondent would, with
 * tools for testing: start at any block, pick a randomizer branch, skip required questions.
 */
export function PreviewWindow({ surveyId }: { surveyId: string }) {
  const backend = useBackend();
  const [survey, setSurvey] = useState<Survey | null | undefined>(undefined);
  const [newer, setNewer] = useState<Survey | null>(null);
  const [from, setFrom] = useState(() => hashQuery().get('from') ?? '');
  const [chosen, setChosen] = useState<Record<string, string>>({}); // randomizer id -> branch id ('' = random)
  const [prefs, setPrefs] = useState<PreviewPrefs>(readPreviewPrefs);
  const [run, setRun] = useState(0);
  const running = useRef('');

  // The working copy the builder handed over, or else the last saved draft.
  useEffect(() => {
    let cancelled = false;
    const draft = readPreviewDraft(surveyId);
    if (draft) setSurvey(draft);
    else
      backend
        .getSurvey(surveyId)
        .then((rec) => !cancelled && setSurvey(rec ? rec.definition : null))
        .catch(() => !cancelled && setSurvey(null));
    return () => {
      cancelled = true;
    };
  }, [backend, surveyId]);

  useEffect(() => {
    running.current = survey ? JSON.stringify(survey) : '';
  }, [survey]);

  // Edits in the builder: offer to restart with them (not for a copy of what's running).
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (!isPreviewDraftKey(e.key, surveyId)) return;
      const draft = parsePreviewDraft(e.newValue, surveyId);
      if (draft) setNewer(JSON.stringify(draft) === running.current ? null : draft);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [surveyId]);

  // "Preview" or "Preview from here" in the builder while this window is open.
  useEffect(() => {
    const onHash = () => {
      const draft = readPreviewDraft(surveyId);
      if (draft) setSurvey(draft);
      setNewer(null);
      setFrom(hashQuery().get('from') ?? '');
      setRun((n) => n + 1);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [surveyId]);

  useEffect(() => {
    if (survey) document.title = `Preview: ${survey.title || 'Untitled survey'}`;
  }, [survey]);

  const steps = useMemo(() => (survey ? flowSteps(survey) : []), [survey]);
  const start = survey?.blocks.some((b) => b.id === from) ? from : '';
  const startPlace = survey && start ? placeOf(survey, start) : null;

  const forced: ForcedArms = {};
  for (const [rid, armId] of Object.entries(chosen)) if (armId) forced[rid] = [armId];
  // Starting inside a branch means getting that branch.
  if (startPlace) forced[startPlace.randomizer.id] = [startPlace.arm.id];

  const restart = () => setRun((n) => n + 1);
  const setPref = (patch: Partial<PreviewPrefs>) =>
    setPrefs((p) => {
      const next = { ...p, ...patch };
      writePreviewPrefs(next);
      return next;
    });
  const startAt = (blockId: string) => {
    setFrom(blockId);
    window.history.replaceState(null, '', previewHash(surveyId, blockId || undefined));
    restart();
  };

  if (survey === undefined) return <Spinner label="Opening preview" />;
  if (survey === null)
    return (
      <div className="page-narrow">
        <p className="fatal">This survey couldn’t be found. Open the preview from the survey builder.</p>
      </div>
    );

  return (
    <div className="pw">
      <header className="preview-bar">
        <div className="preview-label">
          <strong>Preview</strong>
          <span className="hint">Answers you submit are kept as test responses.</span>
        </div>
        <label className="pw-field">
          <span>Start at</span>
          <select className="input input-sm" value={start} onChange={(e) => startAt(e.target.value)}>
            <option value="">The beginning</option>
            {steps.map((st) =>
              st.kind === 'block' ? (
                <option key={st.block.id} value={st.block.id}>
                  {st.block.title || 'Untitled block'}
                </option>
              ) : (
                <optgroup key={st.randomizer.id} label={`Randomizer ${st.randomizer.variable}`}>
                  {st.arms.flatMap(({ arm, blocks }) =>
                    blocks.map((b) => (
                      <option key={b.id} value={b.id}>
                        {arm.label === b.title ? b.title : `${arm.label}: ${b.title || 'Untitled block'}`}
                      </option>
                    )),
                  )}
                </optgroup>
              ),
            )}
          </select>
        </label>
        {survey.randomizers.map((r) => {
          const fixed = startPlace?.randomizer.id === r.id;
          return (
            <label key={r.id} className="pw-field" title={fixed ? 'Set by the block you start at' : 'Which branch this preview gets'}>
              <span className="mono">{r.variable}</span>
              <select
                className="input input-sm"
                value={fixed ? startPlace.arm.id : (chosen[r.id] ?? '')}
                disabled={fixed}
                onChange={(e) => {
                  setChosen((c) => ({ ...c, [r.id]: e.target.value }));
                  restart();
                }}
              >
                <option value="">Random</option>
                {r.arms.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label || 'Unnamed branch'}
                  </option>
                ))}
              </select>
            </label>
          );
        })}
        <label className="check pw-check">
          <input type="checkbox" checked={prefs.skipRequired} onChange={(e) => setPref({ skipRequired: e.target.checked })} />
          <span>Skip required questions</span>
        </label>
        <div className="segmented" role="group" aria-label="Screen size">
          <button type="button" className={prefs.device === 'desktop' ? 'is-on' : ''} aria-pressed={prefs.device === 'desktop'} onClick={() => setPref({ device: 'desktop' })}>
            <Icon name="desktop" size={16} /> Desktop
          </button>
          <button type="button" className={prefs.device === 'phone' ? 'is-on' : ''} aria-pressed={prefs.device === 'phone'} onClick={() => setPref({ device: 'phone' })}>
            <Icon name="phone" size={16} /> Phone
          </button>
        </div>
        <Button icon="undo" onClick={restart}>
          Restart
        </Button>
      </header>
      {newer && (
        <div className="pw-banner" role="status">
          <Icon name="info" size={16} />
          <span>The survey has changed in the builder.</span>
          <Button
            size="sm"
            variant="primary"
            onClick={() => {
              setSurvey(newer);
              setNewer(null);
              restart();
            }}
          >
            Restart with changes
          </Button>
        </div>
      )}
      <div className="preview-scroll">
        <div className={`preview-frame preview-${prefs.device}`}>
          <Respond key={run} surveyId={surveyId} previewSurvey={survey} previewOptions={{ startBlockId: start || undefined, forced, skipRequired: prefs.skipRequired }} />
        </div>
      </div>
    </div>
  );
}
