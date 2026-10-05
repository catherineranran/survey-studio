import { Button, Field, Icon, IconButton, Toggle } from '../components/ui';
import { allQuestions } from '../lib/engine';
import { VARIABLE_RE, uid } from '../lib/ids';
import { TYPE_INFO } from '../lib/questionTypes';
import { publicSurveyUrl } from '../lib/router';
import type { Randomizer, Survey, UrlParam } from '../lib/types';
import type { Updater } from '../lib/useUndoable';
import { describeLogic } from './builder/LogicEditor';

const PANEL_PRESETS: { name: string; params: string[]; hint: string }[] = [
  { name: 'Prolific', params: ['PROLIFIC_PID', 'STUDY_ID', 'SESSION_ID'], hint: 'Prolific adds these to your study link automatically when you tick “URL parameters”.' },
  { name: 'MTurk / CloudResearch', params: ['workerId', 'assignmentId', 'hitId'], hint: '' },
  { name: 'SoSci / panel ID', params: ['pid'], hint: '' },
];

export function Flow({ survey, update, surveyId }: { survey: Survey; update: Updater<Survey>; surveyId: string }) {
  const owned = new Map<string, string>();
  for (const r of survey.randomizers) for (const id of r.blockIds) owned.set(id, r.id);

  const setR = (id: string, patch: Partial<Randomizer>, coalesce?: string) =>
    update(
      (s) => {
        s.randomizers = s.randomizers.map((r) => (r.id === id ? { ...r, ...patch } : r));
      },
      { coalesce: coalesce ? `${id}:${coalesce}` : undefined },
    );
  const setP = (id: string, patch: Partial<UrlParam>, coalesce?: string) =>
    update(
      (s) => {
        s.urlParams = s.urlParams.map((p) => (p.id === id ? { ...p, ...patch } : p));
      },
      { coalesce: coalesce ? `${id}:${coalesce}` : undefined },
    );

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

  const exampleLink = (() => {
    const base = publicSurveyUrl(surveyId);
    const qs = survey.urlParams.map((p) => `${encodeURIComponent(p.name)}=…`).join('&');
    return qs ? `${base}&${qs}` : base;
  })();

  return (
    <div className="page-narrow flow-page">
      <section className="panel">
        <header className="panel-head">
          <h2>Survey flow</h2>
          <p className="hint">The path respondents take, with randomization and logic. Edit blocks and their logic in the Build tab.</p>
        </header>
        <ol className="flow-map">
          {survey.settings.welcomeEnabled && (
            <li className="flow-node flow-terminal">
              <span className="flow-dot" />
              Welcome page
            </li>
          )}
          {survey.urlParams.length > 0 && (
            <li className="flow-node flow-data">
              <span className="flow-dot" />
              Read URL parameters: <span className="mono">{survey.urlParams.map((p) => p.name).join(', ')}</span>
            </li>
          )}
          {flowItems(survey).map((item) =>
            item.kind === 'block' ? (
              <li key={item.block.id} className="flow-node">
                <span className="flow-dot" />
                <FlowBlock survey={survey} blockId={item.block.id} />
              </li>
            ) : (
              <li key={item.r.id} className="flow-node flow-group">
                <span className="flow-dot flow-dot-shuffle">
                  <Icon name="shuffle" size={12} />
                </span>
                <div>
                  <p className="flow-group-title">
                    Randomizer <span className="mono">{item.r.variable}</span>: each respondent sees {item.r.present} of {item.blocks.length}
                    {item.r.balance ? ', balanced across respondents' : ', at random'}
                  </p>
                  <ol className="flow-group-list">
                    {item.blocks.map((b) => (
                      <li key={b.id}>
                        <FlowBlock survey={survey} blockId={b.id} />
                      </li>
                    ))}
                  </ol>
                </div>
              </li>
            ),
          )}
          <li className="flow-node flow-terminal">
            <span className="flow-dot" />
            End of survey{survey.settings.redirectUrl ? ', then redirect' : ''}
          </li>
        </ol>
      </section>

      <section className="panel">
        <header className="panel-head">
          <h2>Randomizers</h2>
          <p className="hint">
            Show each respondent a random subset of blocks, for example one of two experimental conditions. The block(s) shown are saved in the named
            field, which you can use in logic, piping and exports.
          </p>
        </header>
        {survey.randomizers.map((r) => {
          const nameErr = !VARIABLE_RE.test(r.variable) ? 'Use letters, digits and underscores, starting with a letter.' : nameTaken(r.variable, r.id) ? 'This name is already used.' : null;
          return (
            <div key={r.id} className="subpanel">
              <div className="subpanel-head">
                <Field label="Field name" error={nameErr}>
                  <input className="input mono" value={r.variable} onChange={(e) => setR(r.id, { variable: e.target.value.replace(/\s/g, '_') }, 'name')} />
                </Field>
                <IconButton icon="trash" label="Delete randomizer" onClick={() => update((s) => void (s.randomizers = s.randomizers.filter((x) => x.id !== r.id)))} />
              </div>
              <fieldset className="checks">
                <legend className="field-label">Blocks to choose from</legend>
                {survey.blocks.map((b) => {
                  const other = owned.get(b.id);
                  const takenElsewhere = !!other && other !== r.id;
                  return (
                    <label key={b.id} className={`check ${takenElsewhere ? 'is-disabled' : ''}`}>
                      <input
                        type="checkbox"
                        disabled={takenElsewhere}
                        checked={r.blockIds.includes(b.id)}
                        onChange={(e) =>
                          setR(r.id, {
                            blockIds: e.target.checked ? survey.blocks.filter((x) => x.id === b.id || r.blockIds.includes(x.id)).map((x) => x.id) : r.blockIds.filter((id) => id !== b.id),
                          })
                        }
                      />
                      <span>{b.title}</span>
                      {takenElsewhere && <span className="hint">in another randomizer</span>}
                    </label>
                  );
                })}
              </fieldset>
              <div className="grid-2">
                <Field label="Blocks each respondent sees">
                  <select className="input" value={r.present} onChange={(e) => setR(r.id, { present: Number(e.target.value) })}>
                    {Array.from({ length: Math.max(1, r.blockIds.length) }, (_, i) => i + 1).map((n) => (
                      <option key={n} value={n}>
                        {n === r.blockIds.length && n > 1 ? `All ${n}, in random order` : n}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <Toggle
                label="Keep groups balanced"
                hint="Each new respondent gets the block shown least often so far (counting completed, non-test responses), like Qualtrics’ “evenly present”."
                checked={r.balance}
                onChange={(on) => setR(r.id, { balance: on })}
              />
            </div>
          );
        })}
        <Button
          icon="plus"
          onClick={() =>
            update((s) => {
              const free = s.blocks.filter((b) => !owned.has(b.id)).slice(-2);
              let n = s.randomizers.length + 1;
              let name = n === 1 ? 'condition' : `condition${n}`;
              while (nameTaken(name, '')) name = `condition${++n}`;
              s.randomizers.push({ id: uid('rz'), variable: name, blockIds: free.map((b) => b.id), present: 1, balance: true });
            })
          }
        >
          Add randomizer
        </Button>
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
            {survey.urlParams.map((p) => {
              const err = !VARIABLE_RE.test(p.name) ? 'Use letters, digits and underscores, starting with a letter.' : nameTaken(p.name, p.id) ? 'This name is already used.' : null;
              return (
                <div key={p.id} className="param-row">
                  <Field label="Parameter" error={err}>
                    <input className="input mono" value={p.name} onChange={(e) => setP(p.id, { name: e.target.value.replace(/\s/g, '_') }, 'name')} />
                  </Field>
                  <Toggle label="Required" hint="Without it, the survey won’t start." checked={p.required} onChange={(on) => setP(p.id, { required: on })} />
                  <IconButton icon="trash" label={`Delete ${p.name}`} onClick={() => update((s) => void (s.urlParams = s.urlParams.filter((x) => x.id !== p.id)))} />
                </div>
              );
            })}
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

type FlowItem = { kind: 'block'; block: Survey['blocks'][number] } | { kind: 'group'; r: Randomizer; blocks: Survey['blocks'] };

function flowItems(survey: Survey): FlowItem[] {
  const out: FlowItem[] = [];
  const done = new Set<string>();
  for (const b of survey.blocks) {
    const r = survey.randomizers.find((x) => x.blockIds.includes(b.id));
    if (!r) out.push({ kind: 'block', block: b });
    else if (!done.has(r.id)) {
      done.add(r.id);
      out.push({ kind: 'group', r, blocks: survey.blocks.filter((x) => r.blockIds.includes(x.id)) });
    }
  }
  return out;
}

function FlowBlock({ survey, blockId }: { survey: Survey; blockId: string }) {
  const b = survey.blocks.find((x) => x.id === blockId)!;
  const n = b.questions.filter((q) => TYPE_INFO[q.type].answerable).length;
  return (
    <div className="flow-block">
      <p className="flow-block-title">
        <strong>{b.title}</strong>
        <span className="hint">
          {n} question{n === 1 ? '' : 's'}
          {b.pageMode === 'each' ? ', one per page' : ''}
          {b.randomizeQuestions ? ', shuffled' : ''}
        </span>
      </p>
      {b.displayLogic?.conditions.length ? <p className="flow-rule">Shown only if {describeLogic(b.displayLogic, survey)}</p> : null}
      {b.questions.some((q) => q.type === 'consent' && q.endOnDecline !== false) && <p className="flow-rule">Ends the survey if consent is declined</p>}
      {b.branches.map((br) => (
        <p key={br.id} className="flow-rule">
          If {describeLogic(br.logic, survey)}, go to {br.target === 'end' ? `the end (${br.endTag || 'complete'})` : `“${survey.blocks.find((x) => x.id === br.target)?.title ?? '?'}”`}
        </p>
      ))}
    </div>
  );
}
