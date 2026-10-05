import { AutoTextarea, Button, Field, IconButton, NumberInput, Toggle } from '../../components/ui';
import { allQuestions } from '../../lib/engine';
import { uid, variableError } from '../../lib/ids';
import { TYPE_GROUPS, TYPE_INFO, convertQuestion } from '../../lib/questionTypes';
import type { Block, Branch, Question, Survey } from '../../lib/types';
import type { Updater } from '../../lib/useUndoable';
import { LogicEditor, describeLogic, logicSources } from './LogicEditor';
import type { QMutate } from './QuestionEditor';

/* --------------------------------------------------------------- question */

export function QuestionInspector({
  survey,
  q,
  change,
  replace,
  onDuplicate,
  onDelete,
  onMoveToBlock,
}: {
  survey: Survey;
  q: Question;
  change: QMutate;
  replace: (q: Question) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onMoveToBlock: (blockId: string) => void;
}) {
  const info = TYPE_INFO[q.type];
  const v = q.validation ?? {};
  const setV = (patch: Partial<NonNullable<Question['validation']>>, key?: string) => change((x) => void (x.validation = { ...x.validation, ...patch }), key);
  const varErr = info.answerable ? variableError(survey, q.variable, q.id) : null;
  const blockId = survey.blocks.find((b) => b.questions.some((x) => x.id === q.id))?.id ?? '';

  return (
    <div className="inspector-body" onClick={(e) => e.stopPropagation()}>
      <section className="insp-section">
        <Field label="Question type">
          <select className="input" value={q.type} onChange={(e) => replace(convertQuestion(q, e.target.value as Question['type'], survey))}>
            {TYPE_GROUPS.map((g) => (
              <optgroup key={g.name} label={g.name}>
                {g.types.map((t) => (
                  <option key={t} value={t}>
                    {TYPE_INFO[t].label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </Field>
        {info.answerable && (
          <>
            <Field label="Variable name" error={varErr} hint="Column name in exports and the name used for {{piping}}.">
              <input className="input mono" value={q.variable} spellCheck={false} onChange={(e) => change((x) => void (x.variable = e.target.value.replace(/\s/g, '_')), 'var')} />
            </Field>
            {q.type === 'consent' ? (
              <p className="hint">Consent is always required: respondents choose agree or decline before they continue.</p>
            ) : (
              <Toggle label="Required" checked={q.required} onChange={(on) => change((x) => void (x.required = on))} />
            )}
          </>
        )}
      </section>

      <TypeSettings q={q} change={change} setV={setV} v={v} />

      <section className="insp-section">
        <h3 className="insp-title">Display logic</h3>
        <LogicEditor
          survey={survey}
          logic={q.displayLogic}
          onChange={(l) => change((x) => void (x.displayLogic = l))}
          sources={logicSources(survey, { beforeQuestion: q.id })}
          emptyText="Always shown. Add a condition to show this question only to some respondents."
        />
      </section>

      <section className="insp-section">
        <Field label="Block">
          <select className="input" value={blockId} onChange={(e) => onMoveToBlock(e.target.value)}>
            {survey.blocks.map((b) => (
              <option key={b.id} value={b.id}>
                {b.title}
              </option>
            ))}
          </select>
        </Field>
        <div className="insp-actions">
          <Button size="sm" icon="copy" onClick={onDuplicate}>
            Duplicate
          </Button>
          <Button size="sm" variant="danger" icon="trash" onClick={onDelete}>
            Delete
          </Button>
        </div>
      </section>
    </div>
  );
}

function TypeSettings({
  q,
  change,
  setV,
  v,
}: {
  q: Question;
  change: QMutate;
  setV: (patch: Partial<NonNullable<Question['validation']>>, key?: string) => void;
  v: NonNullable<Question['validation']>;
}) {
  const choiceish = ['single_choice', 'multi_choice', 'dropdown', 'rank', 'constant_sum'].includes(q.type);
  const rows: React.ReactNode[] = [];

  if (q.type === 'single_choice' || q.type === 'multi_choice') {
    rows.push(
      <Field key="layout" label="Layout">
        <select className="input" value={q.layout ?? 'vertical'} onChange={(e) => change((x) => void (x.layout = e.target.value as 'vertical' | 'horizontal'))}>
          <option value="vertical">Options in a column</option>
          <option value="horizontal">Options in a row</option>
        </select>
      </Field>,
    );
  }
  if (choiceish) {
    rows.push(
      <Toggle
        key="rand"
        label="Shuffle option order"
        hint="Each respondent sees a different order. “Other” and exclusive options stay last."
        checked={!!q.randomizeChoices}
        onChange={(on) => change((x) => void (x.randomizeChoices = on))}
      />,
    );
  }
  if (q.type === 'matrix') {
    rows.push(<Toggle key="rr" label="Shuffle statement order" checked={!!q.randomizeRows} onChange={(on) => change((x) => void (x.randomizeRows = on))} />);
  }
  if (q.type === 'multi_choice') {
    rows.push(
      <div key="sel" className="grid-2">
        <Field label="At least">
          <NumberInput value={v.minSelected ?? null} placeholder="Any" onChange={(n) => setV({ minSelected: n }, 'mins')} />
        </Field>
        <Field label="At most">
          <NumberInput value={v.maxSelected ?? null} placeholder="Any" onChange={(n) => setV({ maxSelected: n }, 'maxs')} />
        </Field>
      </div>,
    );
  }
  if (q.type === 'short_text') {
    rows.push(
      <Field key="fmt" label="Answer format">
        <select className="input" value={v.format ?? 'any'} onChange={(e) => setV({ format: e.target.value as NonNullable<typeof v.format> })}>
          <option value="any">Any text</option>
          <option value="email">Email address</option>
          <option value="number">Number</option>
          <option value="url">Web address</option>
          <option value="regex">Custom pattern (regular expression)</option>
        </select>
      </Field>,
    );
    if (v.format === 'regex') {
      rows.push(
        <Field key="pat" label="Pattern" hint="For example ^[A-Z]{2}\d{4}$ for two capital letters and four digits.">
          <input className="input mono" value={v.pattern ?? ''} spellCheck={false} onChange={(e) => setV({ pattern: e.target.value }, 'pat')} />
        </Field>,
      );
    }
  }
  if (q.type === 'short_text' || q.type === 'long_text') {
    rows.push(
      <div key="len" className="grid-2">
        <Field label="Min characters">
          <NumberInput value={v.minLength ?? null} placeholder="None" onChange={(n) => setV({ minLength: n }, 'minl')} />
        </Field>
        <Field label="Max characters">
          <NumberInput value={v.maxLength ?? null} placeholder="None" onChange={(n) => setV({ maxLength: n }, 'maxl')} />
        </Field>
      </div>,
    );
  }
  if (q.type === 'number') {
    rows.push(
      <div key="range" className="grid-2">
        <Field label="Minimum">
          <NumberInput value={v.min ?? null} placeholder="None" onChange={(n) => setV({ min: n }, 'min')} />
        </Field>
        <Field label="Maximum">
          <NumberInput value={v.max ?? null} placeholder="None" onChange={(n) => setV({ max: n }, 'max')} />
        </Field>
      </div>,
      <Toggle key="int" label="Whole numbers only" checked={!!v.integer} onChange={(on) => setV({ integer: on })} />,
    );
  }
  if (q.type === 'constant_sum') {
    rows.push(
      <Field key="total" label="Total to distribute">
        <NumberInput value={v.total ?? 100} onChange={(n) => setV({ total: n ?? 100 }, 'total')} />
      </Field>,
    );
  }
  if (['short_text', 'long_text', 'number', 'multi_choice', 'constant_sum'].includes(q.type)) {
    rows.push(
      <Field key="msg" label="Custom error message" hint="Optional. Replaces the built-in message when the answer doesn’t pass the checks above.">
        <input className="input" value={v.message ?? ''} onChange={(e) => setV({ message: e.target.value }, 'msg')} />
      </Field>,
    );
  }
  if (q.type === 'consent') {
    rows.push(
      <Toggle key="end" label="End the survey when declined" hint="Recorded with status “declined_consent”." checked={q.endOnDecline !== false} onChange={(on) => change((x) => void (x.endOnDecline = on))} />,
    );
    if (q.endOnDecline !== false) {
      rows.push(
        <Field key="dm" label="Message after declining">
          <AutoTextarea className="input textarea" value={q.declineMessage ?? ''} onChange={(e) => change((x) => void (x.declineMessage = e.target.value), 'decl')} />
        </Field>,
      );
    }
  }
  if (!rows.length) return null;
  return (
    <section className="insp-section">
      <h3 className="insp-title">Answer settings</h3>
      {rows}
    </section>
  );
}

/* ------------------------------------------------------------------ block */

export function BlockInspector({ survey, block, update }: { survey: Survey; block: Block; update: Updater<Survey> }) {
  const change = (mutate: (b: Block) => void, coalesce?: string) =>
    update(
      (s) => {
        const b = s.blocks.find((x) => x.id === block.id);
        if (b) mutate(b);
      },
      { coalesce: coalesce ? `${block.id}:${coalesce}` : undefined },
    );
  const index = survey.blocks.findIndex((b) => b.id === block.id);
  const later = survey.blocks.slice(index + 1);
  const randomizer = survey.randomizers.find((r) => r.blockIds.includes(block.id));
  const sources = logicSources(survey, { uptoBlock: block.id });

  const setBranch = (id: string, patch: Partial<Branch>) => change((b) => void (b.branches = b.branches.map((br) => (br.id === id ? { ...br, ...patch } : br))));

  return (
    <div className="inspector-body" onClick={(e) => e.stopPropagation()}>
      <section className="insp-section">
        <Field label="Block name" hint="Respondents don’t see it. It names the block in logic, randomizers and exports.">
          <input className="input" value={block.title} onChange={(e) => change((b) => void (b.title = e.target.value), 'title')} />
        </Field>
        <Field label="Pages">
          <select className="input" value={block.pageMode} onChange={(e) => change((b) => void (b.pageMode = e.target.value as Block['pageMode']))}>
            <option value="single">All questions on one page</option>
            <option value="each">One question per page</option>
          </select>
        </Field>
        <Toggle
          label="Shuffle question order"
          hint="Text blocks stay where they are."
          checked={!!block.randomizeQuestions}
          onChange={(on) => change((b) => void (b.randomizeQuestions = on))}
        />
        {randomizer && (
          <p className="hint">
            Part of randomizer <span className="mono">{randomizer.variable}</span>. Edit it in the Flow tab.
          </p>
        )}
      </section>

      <section className="insp-section">
        <h3 className="insp-title">Display logic</h3>
        <LogicEditor
          survey={survey}
          logic={block.displayLogic}
          onChange={(l) => change((b) => void (b.displayLogic = l))}
          sources={logicSources(survey, { beforeBlock: block.id })}
          emptyText="Always shown. Add a condition to show this block only to some respondents."
        />
      </section>

      <section className="insp-section">
        <h3 className="insp-title">Skip logic</h3>
        <p className="hint">After this block, the first rule that matches decides where respondents go next. Without a match they continue to the next block.</p>
        {block.branches.map((br, i) => (
          <div key={br.id} className="branch">
            <div className="branch-head">
              <span className="branch-name">Rule {i + 1}</span>
              <IconButton
                icon="up"
                size="sm"
                label="Move rule up"
                disabled={i === 0}
                onClick={() =>
                  change((b) => {
                    const [x] = b.branches.splice(i, 1);
                    b.branches.splice(i - 1, 0, x);
                  })
                }
              />
              <IconButton icon="trash" size="sm" label="Delete rule" onClick={() => change((b) => void (b.branches = b.branches.filter((x) => x.id !== br.id)))} />
            </div>
            <LogicEditor
              survey={survey}
              logic={br.logic}
              onChange={(l) => setBranch(br.id, { logic: l ?? { match: 'all', conditions: [] } })}
              sources={sources}
              emptyText="No conditions: this rule always applies."
            />
            <Field label="Then go to">
              <select className="input" value={br.target} onChange={(e) => setBranch(br.id, { target: e.target.value })}>
                {later.map((b) => (
                  <option key={b.id} value={b.id}>
                    Block: {b.title}
                  </option>
                ))}
                <option value="end">End of survey</option>
              </select>
            </Field>
            {br.target === 'end' && (
              <>
                <Field label="Status" hint="Saved with the response, e.g. screened_out or quota_full.">
                  <input className="input mono" value={br.endTag ?? ''} placeholder="complete" onChange={(e) => setBranch(br.id, { endTag: e.target.value.replace(/\s/g, '_') })} />
                </Field>
                <Field label="Message (optional)">
                  <AutoTextarea className="input textarea" value={br.endMessage ?? ''} placeholder="Uses the end message from Settings" onChange={(e) => setBranch(br.id, { endMessage: e.target.value })} />
                </Field>
                <Field label="Redirect (optional)" hint="For example a Prolific screen-out link.">
                  <input className="input" value={br.endRedirect ?? ''} placeholder="https://" onChange={(e) => setBranch(br.id, { endRedirect: e.target.value })} />
                </Field>
              </>
            )}
            <p className="hint branch-summary">
              If {describeLogic(br.logic, survey)}, go to {br.target === 'end' ? `the end (${br.endTag || 'complete'})` : `“${survey.blocks.find((b) => b.id === br.target)?.title ?? 'a missing block'}”`}.
            </p>
          </div>
        ))}
        <Button
          size="sm"
          variant="quiet"
          icon="plus"
          onClick={() =>
            change((b) =>
              b.branches.push({
                id: uid('br'),
                logic: { match: 'all', conditions: [] },
                target: later[0]?.id ?? 'end',
              }),
            )
          }
        >
          Add skip rule
        </Button>
      </section>
    </div>
  );
}

/* ---------------------------------------------------------------- overview */

export function SurveyOverview({ survey }: { survey: Survey }) {
  const qs = allQuestions(survey);
  const answerable = qs.filter((q) => TYPE_INFO[q.type].answerable).length;
  const shown = qs.filter((q) => q.displayLogic?.conditions.length).length + survey.blocks.filter((b) => b.displayLogic?.conditions.length).length;
  const skips = survey.blocks.reduce((n, b) => n + b.branches.length, 0);
  return (
    <div className="inspector-body">
      <section className="insp-section">
        <h3 className="insp-title">This survey</h3>
        <dl className="facts">
          <div>
            <dt>Blocks</dt>
            <dd>{survey.blocks.length}</dd>
          </div>
          <div>
            <dt>Questions</dt>
            <dd>{answerable}</dd>
          </div>
          <div>
            <dt>Display conditions</dt>
            <dd>{shown}</dd>
          </div>
          <div>
            <dt>Skip rules</dt>
            <dd>{skips}</dd>
          </div>
          <div>
            <dt>Randomizers</dt>
            <dd>{survey.randomizers.length}</dd>
          </div>
        </dl>
      </section>
      <section className="insp-section">
        <h3 className="insp-title">Working here</h3>
        <ul className="tips">
          <li>Select a question to edit it. Its settings and logic appear here.</li>
          <li>Select a block’s header for page layout, shuffling and skip logic.</li>
          <li>In option lists, Enter adds a row and pasting a list adds many rows.</li>
          <li>Ctrl/⌘ + Z undoes, Ctrl/⌘ + Shift + Z redoes.</li>
        </ul>
      </section>
    </div>
  );
}
