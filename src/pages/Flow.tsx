import { Fragment, useRef, useState, type DragEvent } from 'react';
import { Button, Field, Icon, IconButton, Menu, Toggle, downloadFile, useToast, type MenuItem } from '../components/ui';
import { fileSlug } from '../lib/export';
import { allQuestions } from '../lib/engine';
import {
  addArm,
  canMoveBlock,
  flowSteps,
  makeParallel,
  moveArm,
  moveBlock,
  moveIntoArm,
  moveIntoNewArm,
  moveStep,
  moveStepTo,
  moveToSequence,
  placeOf,
  removeArm,
  renameArm,
  renameRandomizer,
  renameUrlParam,
  ungroup,
  type ArmPlace,
  type FlowStep,
} from '../lib/flow';
import { VARIABLE_RE, uid } from '../lib/ids';
import { navigate, publicSurveyUrl } from '../lib/router';
import type { Block, Survey, UrlParam } from '../lib/types';
import type { Updater } from '../lib/useUndoable';
import { flowchartPng } from './flowImage';
import { blockTitle, describeBlock } from './flowText';

const PANEL_PRESETS: { name: string; params: string[]; hint: string }[] = [
  { name: 'Prolific', params: ['PROLIFIC_PID', 'STUDY_ID', 'SESSION_ID'], hint: 'Prolific adds these to your study link automatically when you tick “URL parameters”.' },
  { name: 'MTurk / CloudResearch', params: ['workerId', 'assignmentId', 'hitId'], hint: '' },
  { name: 'SoSci / panel ID', params: ['pid'], hint: '' },
];

/** What is being dragged: a block, or a whole randomizer (a step of the top-level sequence). */
type Drag = { kind: 'block'; id: string } | { kind: 'step'; id: string; index: number };

/** Where it can land. */
type Target =
  | { kind: 'seq'; before: number }
  | { kind: 'lane'; rid: string; armId: string; before: number }
  | { kind: 'onto'; blockId: string }
  | { kind: 'newArm'; rid: string };

const keyOf = (t: Target) =>
  t.kind === 'seq' ? `seq:${t.before}` : t.kind === 'lane' ? `lane:${t.armId}:${t.before}` : t.kind === 'onto' ? `onto:${t.blockId}` : `new:${t.rid}`;

type RandomizerStep = Extract<FlowStep, { kind: 'randomizer' }>;

export function Flow({
  survey,
  update,
  surveyId,
  onPreview,
}: {
  survey: Survey;
  update: Updater<Survey>;
  surveyId: string;
  onPreview?: (blockId: string) => void;
}) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [drawing, setDrawing] = useState(false);
  const toast = useToast();
  const heads = useRef(new Map<string, HTMLElement>());
  const steps = flowSteps(survey);

  const setP = (id: string, patch: Partial<UrlParam>) =>
    update((s) => {
      s.urlParams = s.urlParams.map((p) => (p.id === id ? { ...p, ...patch } : p));
    });

  const addParams = (names: string[]) =>
    update((s) => {
      for (const n of names) if (!s.urlParams.some((p) => p.name.toLowerCase() === n.toLowerCase())) s.urlParams.push({ id: uid('p'), name: n, required: false });
    });

  const nameTaken = (name: string, selfId: string) => {
    const lower = name.toLowerCase();
    return (
      allQuestions(survey).some((q) => q.variable.toLowerCase() === lower) ||
      survey.urlParams.some((p) => p.id !== selfId && p.name.toLowerCase() === lower) ||
      survey.randomizers.some((r) => r.id !== selfId && r.variable.toLowerCase() === lower)
    );
  };
  const nameError = (name: string, selfId: string) =>
    !VARIABLE_RE.test(name) ? 'Use letters, digits and underscores, starting with a letter.' : nameTaken(name, selfId) ? 'This name is already used.' : null;

  const exampleLink = (() => {
    const base = publicSurveyUrl(surveyId);
    const qs = survey.urlParams.map((p) => `${encodeURIComponent(p.name)}=…`).join('&');
    return qs ? `${base}&${qs}` : base;
  })();

  /* ------------------------------------------------------------ dragging */

  // Drops that would leave everything where it is don't light up.
  const isNoop = (t: Target): boolean => {
    if (!drag) return true;
    if (drag.kind === 'step') return t.kind === 'seq' && (t.before === drag.index || t.before === drag.index + 1);
    if (t.kind === 'seq') {
      const i = steps.findIndex((st) => st.kind === 'block' && st.block.id === drag.id);
      return i >= 0 && (t.before === i || t.before === i + 1);
    }
    if (t.kind === 'lane') {
      const p = placeOf(survey, drag.id);
      return !!p && p.arm.id === t.armId && (t.before === p.index || t.before === p.index + 1);
    }
    if (t.kind === 'newArm') {
      // The only block of a branch, dropped as a new branch of the same randomizer: nothing would change but its name.
      const p = placeOf(survey, drag.id);
      return !!p && p.randomizer.id === t.rid && p.arm.blockIds.length === 1;
    }
    return false;
  };

  const accepts = (t: Target): boolean => {
    if (!drag || isNoop(t)) return false;
    // Randomizers don't nest: a whole randomizer only moves along the main sequence.
    if (drag.kind === 'step') return t.kind === 'seq';
    return !(t.kind === 'onto' && t.blockId === drag.id);
  };

  const endDrag = () => {
    setDrag(null);
    setOver(null);
  };

  const drop = (t: Target) => {
    const d = drag;
    const ok = accepts(t);
    endDrag();
    if (!d || !ok) return;
    update((s) => {
      if (d.kind === 'step') {
        if (t.kind === 'seq') moveStepTo(s, d.index, t.before);
      } else if (t.kind === 'seq') moveToSequence(s, d.id, t.before);
      else if (t.kind === 'lane') moveIntoArm(s, d.id, t.rid, t.armId, t.before);
      else if (t.kind === 'onto') makeParallel(s, d.id, t.blockId);
      else moveIntoNewArm(s, d.id, t.rid);
    });
  };

  const dropZone = (t: Target) => ({
    onDragOver: (e: DragEvent<HTMLElement>) => {
      if (!accepts(t)) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';
      const k = keyOf(t);
      if (over !== k) setOver(k);
    },
    onDragLeave: (e: DragEvent<HTMLElement>) => {
      if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
      const k = keyOf(t);
      setOver((o) => (o === k ? null : o));
    },
    onDrop: (e: DragEvent<HTMLElement>) => {
      e.preventDefault();
      e.stopPropagation();
      drop(t);
    },
  });

  const dragSource = (d: Drag, image?: () => HTMLElement | undefined) => ({
    draggable: true,
    onDragStart: (e: DragEvent<HTMLElement>) => {
      e.stopPropagation();
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', d.id);
      const img = image?.();
      if (img) e.dataTransfer.setDragImage(img, 24, 24);
      // Changing the page inside dragstart cancels the drag in some browsers.
      setTimeout(() => setDrag(d), 0);
    },
    onDragEnd: endDrag,
  });

  const gap = (t: Target, label: string) => {
    const live = accepts(t);
    const k = keyOf(t);
    return (
      <div key={k} className={`fc-gap ${live ? 'is-live' : ''} ${live && over === k ? 'is-over' : ''}`} {...dropZone(t)}>
        {live && <span className="fc-slot">{over === k ? label : ''}</span>}
      </div>
    );
  };

  /* -------------------------------------------------------------- blocks */


  const blockMenu = (b: Block, place: ArmPlace | null, stepIndex: number): (MenuItem | false | null | undefined)[] => {
    const prev = place ? undefined : steps[stepIndex - 1];
    const next = place ? undefined : steps[stepIndex + 1];
    return [
      onPreview && { label: 'Preview from here', icon: 'eye', onSelect: () => onPreview(b.id) },
      { label: 'Edit questions', icon: 'page', onSelect: () => navigate(`/s/${surveyId}/build?block=${encodeURIComponent(b.id)}`) },
      { label: place ? 'Move up in this branch' : 'Move up', icon: 'up', disabled: !canMoveBlock(survey, b.id, -1), onSelect: () => update((s) => moveBlock(s, b.id, -1)) },
      { label: place ? 'Move down in this branch' : 'Move down', icon: 'down', disabled: !canMoveBlock(survey, b.id, 1), onSelect: () => update((s) => moveBlock(s, b.id, 1)) },
      next?.kind === 'block' && {
        label: `Randomize with “${blockTitle(next.block)}”`,
        icon: 'shuffle',
        onSelect: () => update((s) => void makeParallel(s, next.block.id, b.id)),
      },
      prev?.kind === 'block' && {
        label: `Randomize with “${blockTitle(prev.block)}”`,
        icon: 'shuffle',
        onSelect: () => update((s) => void makeParallel(s, b.id, prev.block.id)),
      },
      next?.kind === 'randomizer' && {
        label: 'Make it a branch of the randomizer below',
        icon: 'shuffle',
        onSelect: () => update((s) => void moveIntoNewArm(s, b.id, next.randomizer.id)),
      },
      prev?.kind === 'randomizer' && {
        label: 'Make it a branch of the randomizer above',
        icon: 'shuffle',
        onSelect: () => update((s) => void moveIntoNewArm(s, b.id, prev.randomizer.id)),
      },
      place && {
        label: 'Take out of the randomizer',
        icon: 'exit',
        onSelect: () =>
          update((s) => {
            const at = flowSteps(s).findIndex((st) => st.kind === 'randomizer' && st.randomizer.id === place.randomizer.id);
            moveToSequence(s, b.id, at + 1);
          }),
      },
    ];
  };

  const blockCard = (b: Block, place: ArmPlace | null, stepIndex: number) => {
    // Dropping onto a block in the main sequence randomizes between the two. Inside a
    // randomizer, the slots above and below blocks and the "new branch" column do the work.
    const onto: Target = { kind: 'onto', blockId: b.id };
    const ontoLive = !place && accepts(onto);
    const isOver = ontoLive && over === keyOf(onto);
    const { meta, rules } = describeBlock(survey, b);
    return (
      <div
        key={b.id}
        className={`fc-block ${drag?.kind === 'block' && drag.id === b.id ? 'is-dragging' : ''} ${isOver ? 'is-over' : ''}`}
        {...dragSource({ kind: 'block', id: b.id })}
        {...(place ? {} : dropZone(onto))}
      >
        <span className="fc-grip" title="Drag to move">
          <Icon name="grip" size={16} />
        </span>
        <div className="fc-block-main">
          <p className="fc-block-title">{blockTitle(b)}</p>
          <p className="fc-block-meta">{meta.join(' · ')}</p>
          {rules.map((r, i) => (
            <p key={i} className="fc-rule">
              <Icon name="logic" size={13} />
              <span>{r}</span>
            </p>
          ))}
        </div>
        <Menu label={`Actions for ${blockTitle(b)}`} items={blockMenu(b, place, stepIndex)} />
        {isOver && (
          <p className="fc-onto">
            <Icon name="shuffle" size={14} /> Randomize: each respondent gets one of the two
          </p>
        )}
      </div>
    );
  };

  /* --------------------------------------------------------- randomizers */

  const randomizerCard = (st: RandomizerStep, i: number) => {
    const r = st.randomizer;
    const n = st.arms.length;
    const present = Math.max(1, Math.min(Math.floor(r.present) || 1, Math.max(1, n)));
    const nameErr = nameError(r.variable, r.id);
    const share = n ? Math.round((present / n) * 100) : 0;
    const newArm: Target = { kind: 'newArm', rid: r.id };
    const newLive = accepts(newArm);
    const labels = st.arms.map((a) => a.arm.label.trim().toLowerCase());
    const setR = (mutate: (x: Survey['randomizers'][number]) => void) =>
      update((s) => {
        const x = s.randomizers.find((y) => y.id === r.id);
        if (x) mutate(x);
      });
    return (
      <div key={r.id} className={`fc-rand ${drag?.kind === 'step' && drag.id === r.id ? 'is-dragging' : ''}`}>
        <div
          className="fc-rand-head"
          ref={(el) => {
            if (el) heads.current.set(r.id, el);
            else heads.current.delete(r.id);
          }}
        >
          <span className="fc-grip" title="Drag to move the whole randomizer" {...dragSource({ kind: 'step', id: r.id, index: i }, () => heads.current.get(r.id))}>
            <Icon name="grip" size={16} />
          </span>
          <span className="fc-rand-icon" aria-hidden="true">
            <Icon name="shuffle" size={18} />
          </span>
          <div className="fc-rand-body">
            <div className="fc-rand-line">
              <strong>Randomizer</strong>
              <label className="fc-inline">
                <span>saved as</span>
                <input
                  className={`input input-sm mono fc-var ${nameErr ? 'is-invalid' : ''}`}
                  value={r.variable}
                  aria-label="Field that records the branch each respondent got"
                  aria-invalid={!!nameErr}
                  spellCheck={false}
                  onChange={(e) => update((s) => renameRandomizer(s, r.id, e.target.value.replace(/\s/g, '_')), { coalesce: `${r.id}:name` })}
                />
              </label>
            </div>
            {nameErr && <p className="field-error">{nameErr}</p>}
            <div className="fc-rand-line">
              <label className="fc-inline">
                <span>Each respondent gets</span>
                <select className="input input-sm" value={present} onChange={(e) => setR((x) => void (x.present = Number(e.target.value)))}>
                  {Array.from({ length: Math.max(1, n) }, (_, k) => k + 1).map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
                <span>
                  of {n} branch{n === 1 ? '' : 'es'}
                  {present > 1 ? ', one after another in random order' : ''}
                </span>
              </label>
              <label
                className="check fc-balance"
                title="Each new respondent gets the branch given least often so far (counting submitted responses, not tests), like Qualtrics’ “Evenly present elements”."
              >
                <input type="checkbox" checked={r.balance} onChange={(e) => setR((x) => void (x.balance = e.target.checked))} />
                <span>Keep group sizes even</span>
              </label>
            </div>
          </div>
          <Menu
            label="Randomizer actions"
            items={[
              { label: 'Move up', icon: 'up', disabled: i === 0, onSelect: () => update((s) => moveStep(s, i, -1)) },
              { label: 'Move down', icon: 'down', disabled: i === steps.length - 1, onSelect: () => update((s) => moveStep(s, i, 1)) },
              { label: 'Add an empty branch', icon: 'plus', onSelect: () => update((s) => void addArm(s, r.id)) },
              { label: 'Remove randomizer, keep its blocks', icon: 'x', onSelect: () => update((s) => ungroup(s, r.id)) },
            ]}
          />
        </div>

        <div className="fc-lanes-row">
          <span className="fc-lanes-spacer" aria-hidden="true" />
          <div className="fc-lanes">
            {st.arms.map(({ arm, blocks }, k) => {
              const label = arm.label.trim();
              const labelErr = !label ? 'Name this branch' : labels.filter((x) => x === label.toLowerCase()).length > 1 ? 'Two branches have this name' : null;
              return (
                <div key={arm.id} className="fc-lane">
                  <span className="fc-wire fc-wire-top" />
                  <span className="fc-wire fc-wire-bottom" />
                  <div className={`fc-lane-head ${labelErr ? 'is-invalid' : ''}`}>
                    <input
                      className="fc-lane-name"
                      value={arm.label}
                      placeholder="Branch name"
                      aria-label={`Name of branch ${k + 1}, saved in ${r.variable}`}
                      aria-invalid={!!labelErr}
                      title={labelErr ?? `Saved as ${r.variable} = “${arm.label}” for respondents who get this branch`}
                      onChange={(e) => update((s) => renameArm(s, r.id, arm.id, e.target.value), { coalesce: `${arm.id}:label` })}
                    />
                    <Menu
                      label={`Actions for branch ${label || k + 1}`}
                      items={[
                        onPreview && blocks.length > 0 && { label: 'Preview this branch', icon: 'eye', onSelect: () => onPreview(blocks[0].id) },
                        { label: 'Move left', icon: 'left', disabled: k === 0, onSelect: () => update((s) => moveArm(s, r.id, arm.id, -1)) },
                        { label: 'Move right', icon: 'right', disabled: k === n - 1, onSelect: () => update((s) => moveArm(s, r.id, arm.id, 1)) },
                        {
                          label: blocks.length ? 'Remove branch (its blocks move below)' : 'Remove branch',
                          icon: 'trash',
                          danger: true,
                          onSelect: () => update((s) => removeArm(s, r.id, arm.id)),
                        },
                      ]}
                    />
                  </div>
                  {labelErr ? (
                    <span className="fc-lane-note is-error">{labelErr}</span>
                  ) : (
                    <span className="fc-lane-note" title="Expected share of respondents">
                      ≈ {share}%
                    </span>
                  )}
                  {gap({ kind: 'lane', rid: r.id, armId: arm.id, before: 0 }, 'Move into this branch')}
                  {blocks.map((b, j) => (
                    <Fragment key={b.id}>
                      {blockCard(b, { randomizer: r, arm, index: j }, i)}
                      {gap({ kind: 'lane', rid: r.id, armId: arm.id, before: j + 1 }, 'Move into this branch')}
                    </Fragment>
                  ))}
                  {!blocks.length && <p className="fc-lane-empty">No blocks: people in this branch go straight on, like a control group. Drag a block here.</p>}
                </div>
              );
            })}
          </div>
          <div className={`fc-newlane ${newLive ? 'is-live' : ''} ${newLive && over === keyOf(newArm) ? 'is-over' : ''}`} {...dropZone(newArm)}>
            {newLive ? (
              <span>New branch</span>
            ) : (
              <Button size="sm" variant="quiet" icon="plus" onClick={() => update((s) => void addArm(s, r.id))}>
                Branch
              </Button>
            )}
          </div>
        </div>
      </div>
    );
  };

  const hasRandomizer = steps.some((st) => st.kind === 'randomizer');

  // The flow as a flowchart image, for papers, preregistrations and ethics applications.
  const downloadFlowchart = async () => {
    setDrawing(true);
    try {
      downloadFile(`${fileSlug(survey.title) || 'survey'}-flow.png`, await flowchartPng(survey));
    } catch (e) {
      toast(`Couldn’t make the image: ${e instanceof Error ? e.message : e}`, 'error');
    } finally {
      setDrawing(false);
    }
  };

  return (
    <div className="page-flow">
      <section className="panel">
        <header className="panel-head">
          <div className="panel-title-row">
            <h2>Survey flow</h2>
            <Button size="sm" icon="download" onClick={downloadFlowchart} disabled={drawing}>
              {drawing ? 'Drawing…' : 'Download as PNG'}
            </Button>
          </div>
          <p className="hint">
            Drag blocks to arrange the path. Drop a block between steps to put it in sequence, onto another block to randomize between them, or into a
            branch of a randomizer. Each respondent gets one branch, then everyone continues with the steps below it.
          </p>
        </header>
        {!hasRandomizer && steps.length > 1 && (
          <p className="notice">
            <Icon name="shuffle" size={18} />
            <span>
              To assign respondents at random to conditions (say, a video or a vignette), drag one block onto another, or open a block’s menu and choose
              “Randomize with …”.
            </span>
          </p>
        )}
        <div className={`fc ${drag ? 'is-dragging' : ''}`}>
          <div className="fc-terminal">
            <span className="fc-pill">Start</span>
            {survey.settings.welcomeEnabled && <span className="fc-note">Welcome page</span>}
            {survey.urlParams.length > 0 && (
              <span className="fc-note">
                Reads <span className="mono">{survey.urlParams.map((p) => p.name).join(', ')}</span> from the link
              </span>
            )}
          </div>
          {gap({ kind: 'seq', before: 0 }, 'Move here')}
          {steps.map((st, i) => (
            <Fragment key={st.kind === 'block' ? st.block.id : st.randomizer.id}>
              {st.kind === 'block' ? blockCard(st.block, null, i) : randomizerCard(st, i)}
              {gap({ kind: 'seq', before: i + 1 }, 'Move here')}
            </Fragment>
          ))}
          <div className="fc-terminal">
            <span className="fc-pill">End</span>
            <span className="fc-note">Thank-you page{survey.settings.redirectUrl ? ', then redirect' : ''}</span>
          </div>
        </div>
        {hasRandomizer && (
          <p className="hint">
            To skip questions for one group later on, give those questions display logic such as “{steps.find((x): x is RandomizerStep => x.kind === 'randomizer')?.randomizer.variable} is
            not …” (Build tab, question settings, Logic). “Use this logic on other questions” copies it to many at once.
          </p>
        )}
      </section>

      <section className="panel">
        <header className="panel-head">
          <h2>URL parameters</h2>
          <p className="hint">
            Values added to the survey link, such as a participant ID from a panel provider, are stored with each response. Use them in logic and
            piping, e.g. a redirect link with {'{{'}PROLIFIC_PID{'}}'}.
          </p>
        </header>
        {survey.urlParams.length > 0 && (
          <div className="param-rows">
            {survey.urlParams.map((p) => (
              <div key={p.id} className="param-row">
                <Field label="Parameter" error={nameError(p.name, p.id)}>
                  <input
                    className="input mono"
                    value={p.name}
                    spellCheck={false}
                    onChange={(e) => update((s) => renameUrlParam(s, p.id, e.target.value.replace(/\s/g, '_')), { coalesce: `${p.id}:name` })}
                  />
                </Field>
                <Toggle label="Required" hint="Without it, the survey won’t start." checked={p.required} onChange={(on) => setP(p.id, { required: on })} />
                <IconButton icon="trash" label={`Delete ${p.name}`} onClick={() => update((s) => void (s.urlParams = s.urlParams.filter((x) => x.id !== p.id)))} />
              </div>
            ))}
          </div>
        )}
        <div className="button-row">
          <Button icon="plus" onClick={() => update((s) => void s.urlParams.push({ id: uid('p'), name: `param${s.urlParams.length + 1}`, required: false }))}>
            Add parameter
          </Button>
          {PANEL_PRESETS.map((p) => (
            <Button key={p.name} variant="ghost" onClick={() => addParams(p.params)} title={p.hint || undefined}>
              Add {p.name} fields
            </Button>
          ))}
        </div>
        {survey.urlParams.length > 0 && (
          <Field label="Your link with parameters">
            <code className="code-line">{exampleLink}</code>
          </Field>
        )}
      </section>
    </div>
  );
}
