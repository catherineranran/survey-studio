import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Button, Icon, Spinner, useMediaQuery, type IconName } from '../components/ui';
import { useBackend } from '../lib/backend/context';
import type { ForcedArms, RunOverview } from '../lib/engine';
import { flowSteps, placeOf } from '../lib/flow';
import { hashQuery, isPreviewDraftKey, parsePreviewDraft, previewHash, readPreviewDraft, readPreviewPrefs, writePreviewPrefs, type PreviewPrefs } from '../lib/preview';
import type { Survey } from '../lib/types';
import { OutlineView } from './builder/Outline';
import { Respond } from './Respond';

/**
 * The preview window: runs the builder's working copy like a respondent would, with
 * tools for testing: start at any block, pick a randomizer branch, skip required questions.
 * The outline at the left follows the run (the page on screen, blocks shown or passed over,
 * the branches it got); clicking a block or question starts the preview there.
 * Opened from a collaborator link (`shareToken`), it finds the survey through the link and
 * doesn't keep test responses.
 */
export function PreviewWindow({ surveyId: idProp, shareToken }: { surveyId?: string; shareToken?: string }) {
  const backend = useBackend();
  const [surveyId, setSurveyId] = useState(idProp ?? '');
  const [survey, setSurvey] = useState<Survey | null | undefined>(undefined);
  const [newer, setNewer] = useState<Survey | null>(null);
  const [from, setFrom] = useState(() => hashQuery().get('from') ?? '');
  const [fromQuestion, setFromQuestion] = useState(() => hashQuery().get('q') ?? '');
  const [chosen, setChosen] = useState<Record<string, string>>({}); // randomizer id -> branch id ('' = random)
  const [prefs, setPrefs] = useState<PreviewPrefs>(readPreviewPrefs);
  const [run, setRun] = useState(0);
  const running = useRef('');
  // Where the run is, for the outline.
  const [where, setWhere] = useState<RunOverview | null>(null);
  // Blocks unfolded or folded by hand in the outline; the block on screen is unfolded otherwise.
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
  const [shut, setShut] = useState<ReadonlySet<string>>(new Set());
  const roomy = useMediaQuery('(min-width: 1000px)');
  const docked = roomy && prefs.outline;
  const [drawer, setDrawer] = useState(false);
  const drawerRef = useRef<HTMLDialogElement>(null);

  // The working copy the builder handed over, or else the last saved draft.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let id = idProp ?? '';
      let saved: Survey | null = null;
      if (shareToken) {
        const shared = await backend.getSharedSurvey(shareToken).catch(() => null);
        if (!shared) return !cancelled && setSurvey(null);
        id = shared.record.id;
        saved = shared.record.definition;
      }
      if (cancelled) return;
      setSurveyId(id);
      const draft = readPreviewDraft(id);
      if (draft || saved) return setSurvey(draft ?? saved);
      const rec = await backend.getSurvey(id).catch(() => null);
      if (!cancelled) setSurvey(rec ? rec.definition : null);
    })();
    return () => {
      cancelled = true;
    };
  }, [backend, idProp, shareToken]);

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
      setFromQuestion(hashQuery().get('q') ?? '');
      setRun((n) => n + 1);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [surveyId]);

  useEffect(() => {
    if (survey) document.title = `Preview: ${survey.title || 'Untitled survey'}`;
  }, [survey]);

  // A layout effect, so the drawer is open before the outline inside it measures itself.
  useLayoutEffect(() => {
    const d = drawerRef.current;
    if (!d) return;
    if (drawer && !d.open) d.showModal();
    if (!drawer && d.open) d.close();
  }, [drawer]);
  useEffect(() => {
    if (docked) setDrawer(false);
  }, [docked]);
  // Showing or hiding the outline removes the button you pressed, so focus moves to its counterpart.
  const focusAfter = useRef<string | null>(null);
  useEffect(() => {
    if (!focusAfter.current) return;
    document.querySelector<HTMLElement>(focusAfter.current)?.focus();
    focusAfter.current = null;
  }, [docked]);

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
  const startAt = (blockId: string, questionId?: string) => {
    setFrom(blockId);
    setFromQuestion(questionId ?? '');
    window.history.replaceState(null, '', previewHash(surveyId, blockId || undefined, undefined, shareToken, questionId));
    restart();
  };
  const showOutline = (shown: boolean) => {
    focusAfter.current = shown ? '.pw-side .outline-hide' : '.preview-bar .outline-toggle';
    setPref({ outline: shown });
  };
  const openOutline = () => (roomy ? showOutline(true) : setDrawer(true));

  if (survey === undefined) return <Spinner label="Opening preview" />;
  if (survey === null)
    return (
      <div className="page-narrow">
        <p className="fatal">This survey couldn’t be found. Open the preview from the survey builder.</p>
      </div>
    );

  /* ------------------------------------------------------------ outline */
  const current = where?.current ?? null;
  const blockIds = survey.blocks.map((b) => b.id);
  const folded = new Set(blockIds.filter((id) => shut.has(id) || (!opened.has(id) && id !== current)));
  const toggleFold = (id: string) => {
    const unfold = folded.has(id);
    setOpened((o) => new Set(unfold ? [...o, id] : [...o].filter((x) => x !== id)));
    setShut((s) => new Set(unfold ? [...s].filter((x) => x !== id) : [...s, id]));
  };
  const foldAll = (fold: boolean) => {
    setOpened(new Set(fold ? [] : blockIds));
    setShut(new Set(fold ? blockIds : []));
  };
  // Starting somewhere from the outline keeps the branches of this run (the toolbar shows
  // them, and "Random" brings back the draw); a block in another branch gets that branch.
  const goTo = (blockId: string, questionId?: string) => {
    setDrawer(false);
    const arms = where?.arms;
    if (arms) setChosen((c) => ({ ...c, ...Object.fromEntries(Object.entries(arms).map(([rid, ids]) => [rid, ids[0] ?? ''])) }));
    startAt(blockId, questionId);
  };
  const outline = (onHide: () => void, hideLabel: string, hideIcon?: IconName) => (
    <OutlineView
      survey={survey}
      folded={folded}
      sel={null}
      current={current}
      run={where}
      note="Click a block or question to start the preview there."
      onToggleFold={toggleFold}
      onFoldAll={foldAll}
      onBlock={(id) => goTo(id)}
      onQuestion={(qid) => {
        const b = survey.blocks.find((x) => x.questions.some((q) => q.id === qid));
        if (b) goTo(b.id, qid);
      }}
      onHide={onHide}
      hideLabel={hideLabel}
      hideIcon={hideIcon}
    />
  );

  return (
    <div className="pw">
      <header className="preview-bar">
        {!docked && (
          <Button size="sm" variant="quiet" icon="sidebar" className="outline-toggle" onClick={openOutline} aria-haspopup={roomy ? undefined : 'dialog'}>
            Outline
          </Button>
        )}
        <div className="preview-label">
          <strong>Preview</strong>
          <span className="hint">{shareToken ? 'Answers you submit aren’t kept.' : 'Answers you submit are kept as test responses.'}</span>
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
      <div className="pw-body">
        {docked && <aside className="pw-side">{outline(() => showOutline(false), 'Hide outline')}</aside>}
        <div className="preview-scroll">
          <div className={`preview-frame preview-${prefs.device}`}>
            <Respond
              key={run}
              surveyId={surveyId}
              previewSurvey={survey}
              previewOptions={{
                startBlockId: start || undefined,
                startQuestionId: start && fromQuestion ? fromQuestion : undefined,
                forced,
                skipRequired: prefs.skipRequired,
                discard: !!shareToken,
                onRun: setWhere,
              }}
            />
          </div>
        </div>
      </div>
      {!docked && (
        <dialog
          ref={drawerRef}
          className="outline-drawer"
          aria-label="Survey outline"
          onCancel={(e) => {
            e.preventDefault();
            setDrawer(false);
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setDrawer(false);
          }}
        >
          {drawer && outline(() => setDrawer(false), 'Close outline', 'x')}
        </dialog>
      )}
    </div>
  );
}
