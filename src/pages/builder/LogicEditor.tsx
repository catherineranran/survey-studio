import { Button, IconButton, NumberInput } from '../../components/ui';
import { uid } from '../../lib/ids';
import { needsValue, questionLabel } from '../../lib/lint';
import { scalePoints } from '../../lib/questionTypes';
import type { Condition, Logic, Operator, Question, Survey } from '../../lib/types';

export interface Source {
  value: string;
  label: string;
  q?: Question;
}

/** Things a condition can look at: earlier questions, URL parameters and randomizer assignments. */
export function logicSources(survey: Survey, opts: { beforeQuestion?: string; uptoBlock?: string; beforeBlock?: string }): Source[] {
  const out: Source[] = [];
  outer: for (const b of survey.blocks) {
    if (opts.beforeBlock && b.id === opts.beforeBlock) break;
    for (const q of b.questions) {
      if (opts.beforeQuestion && q.id === opts.beforeQuestion) break outer;
      if (q.type === 'text_block') continue;
      out.push({ value: q.id, label: `${q.variable}: ${questionLabel(q)}`, q });
    }
    if (opts.uptoBlock && b.id === opts.uptoBlock) break;
  }
  for (const p of survey.urlParams) out.push({ value: `param:${p.name}`, label: `${p.name} (URL parameter)` });
  for (const r of survey.randomizers) out.push({ value: `param:${r.variable}`, label: `${r.variable} (randomizer)` });
  return out;
}

const OP_LABEL: Record<Operator, string> = {
  answered: 'is answered',
  not_answered: 'is not answered',
  is: 'is',
  is_not: 'is not',
  includes: 'includes',
  excludes: 'does not include',
  eq: '=',
  neq: '≠',
  gt: '>',
  gte: '≥',
  lt: '<',
  lte: '≤',
  equals_text: 'is exactly',
  contains: 'contains',
  not_contains: 'does not contain',
};

export function operatorsFor(q?: Question): Operator[] {
  if (!q) return ['equals_text', 'contains', 'not_contains', 'answered', 'not_answered', 'eq', 'gt', 'lt'];
  switch (q.type) {
    case 'single_choice':
    case 'dropdown':
    case 'consent':
      return ['is', 'is_not', 'answered', 'not_answered'];
    case 'multi_choice':
      return ['includes', 'excludes', 'answered', 'not_answered'];
    case 'matrix':
      return ['is', 'is_not', 'gte', 'lte', 'answered', 'not_answered'];
    case 'rating_scale':
    case 'nps':
    case 'slider':
    case 'number':
      return ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'answered', 'not_answered'];
    case 'short_text':
    case 'long_text':
    case 'date':
      return ['equals_text', 'contains', 'not_contains', 'answered', 'not_answered'];
    default:
      return ['answered', 'not_answered'];
  }
}

export function describeCondition(c: Condition, survey: Survey): string {
  if (c.source.startsWith('param:')) return `${c.source.slice(6)} ${OP_LABEL[c.operator]}${needsValue(c.operator) ? ` “${c.value ?? ''}”` : ''}`;
  const q = survey.blocks.flatMap((b) => b.questions).find((x) => x.id === c.source);
  if (!q) return 'a deleted question';
  let value = c.value === undefined ? '' : String(c.value);
  const list = q.type === 'matrix' && ['is', 'is_not'].includes(c.operator) ? q.columns : q.choices;
  const choice = list?.find((x) => x.id === c.value);
  if (choice) value = choice.label;
  const row = q.type === 'matrix' ? q.rows?.find((r) => r.id === c.rowId)?.label : undefined;
  return `${q.variable}${row ? ` (${row})` : ''} ${OP_LABEL[c.operator]}${needsValue(c.operator) ? ` “${value}”` : ''}`;
}

export function describeLogic(logic: Logic | null | undefined, survey: Survey): string {
  const conds = logic?.conditions ?? [];
  if (!conds.length) return 'always';
  return conds.map((c) => describeCondition(c, survey)).join(logic!.match === 'any' ? ' or ' : ' and ');
}

export function LogicEditor({
  survey,
  logic,
  onChange,
  sources,
  emptyText,
}: {
  survey: Survey;
  logic: Logic | null | undefined;
  onChange: (l: Logic | null) => void;
  sources: Source[];
  emptyText: string;
}) {
  const conds = logic?.conditions ?? [];
  const match = logic?.match ?? 'all';
  const set = (next: Condition[], m = match) => onChange(next.length ? { match: m, conditions: next } : null);
  const add = () => {
    const src = sources[sources.length - 1] ?? sources[0];
    if (!src) return;
    set([...conds, freshCondition(src)]);
  };
  return (
    <div className="logic">
      {!conds.length && <p className="hint">{emptyText}</p>}
      {conds.length > 1 && (
        <div className="logic-match">
          <span>Match</span>
          <select className="input input-sm" value={match} onChange={(e) => set(conds, e.target.value as Logic['match'])} aria-label="How conditions combine">
            <option value="all">all conditions</option>
            <option value="any">any condition</option>
          </select>
        </div>
      )}
      {conds.map((c, i) => (
        <ConditionRow
          key={c.id}
          c={c}
          sources={sources}
          survey={survey}
          prefix={i === 0 ? 'If' : match === 'any' ? 'or' : 'and'}
          onChange={(nc) => set(conds.map((x) => (x.id === c.id ? nc : x)))}
          onRemove={() => set(conds.filter((x) => x.id !== c.id))}
        />
      ))}
      {sources.length ? (
        <Button size="sm" variant="quiet" icon="plus" onClick={add}>
          Add condition
        </Button>
      ) : (
        <p className="hint">Conditions can only use questions that come earlier. Add one first.</p>
      )}
    </div>
  );
}

function freshCondition(src: Source): Condition {
  const ops = operatorsFor(src.q);
  const c: Condition = { id: uid('cd'), source: src.value, operator: ops[0] };
  const q = src.q;
  if (q?.type === 'matrix') {
    c.rowId = q.rows?.[0]?.id;
    c.value = q.columns?.[0]?.id;
  } else if (q?.choices?.length) c.value = q.choices[0].id;
  return c;
}

function ConditionRow({
  c,
  sources,
  survey,
  prefix,
  onChange,
  onRemove,
}: {
  c: Condition;
  sources: Source[];
  survey: Survey;
  prefix: string;
  onChange: (c: Condition) => void;
  onRemove: () => void;
}) {
  const src = sources.find((s) => s.value === c.source);
  const q = src?.q;
  const ops = operatorsFor(q);
  const missing = !src;
  return (
    <div className={`cond ${missing ? 'is-broken' : ''}`}>
      <span className="cond-prefix">{prefix}</span>
      <div className="cond-fields">
        <select
          className="input input-sm cond-source"
          value={missing ? '' : c.source}
          aria-label="Question or field"
          onChange={(e) => {
            const s = sources.find((x) => x.value === e.target.value);
            if (s) onChange({ ...freshCondition(s), id: c.id });
          }}
        >
          {missing && <option value="">Deleted or later question</option>}
          {sources.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        {q?.type === 'matrix' && (
          <select className="input input-sm" value={c.rowId ?? ''} aria-label="Statement" onChange={(e) => onChange({ ...c, rowId: e.target.value })}>
            {q.rows?.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>
        )}
        <select
          className="input input-sm cond-op"
          value={c.operator}
          aria-label="Comparison"
          onChange={(e) => {
            const op = e.target.value as Operator;
            const next: Condition = { ...c, operator: op };
            // Matrix: "is" compares a scale point, ≥/≤ compare codes.
            if (q?.type === 'matrix') next.value = op === 'is' || op === 'is_not' ? q.columns?.[0]?.id : q.columns?.[0]?.code;
            onChange(next);
          }}
        >
          {ops.map((op) => (
            <option key={op} value={op}>
              {OP_LABEL[op]}
            </option>
          ))}
        </select>
        {needsValue(c.operator) && <ValueInput c={c} q={q} onChange={onChange} survey={survey} />}
      </div>
      <IconButton icon="x" size="sm" label="Remove condition" onClick={onRemove} />
    </div>
  );
}

function ValueInput({ c, q, onChange }: { c: Condition; q?: Question; onChange: (c: Condition) => void; survey: Survey }) {
  const list =
    q?.type === 'matrix' && (c.operator === 'is' || c.operator === 'is_not')
      ? q.columns
      : q && ['single_choice', 'dropdown', 'consent', 'multi_choice'].includes(q.type)
        ? q.choices
        : undefined;
  if (list) {
    return (
      <select className="input input-sm cond-value" value={String(c.value ?? '')} aria-label="Value" onChange={(e) => onChange({ ...c, value: e.target.value })}>
        {list.map((x) => (
          <option key={x.id} value={x.id}>
            {x.label || '(empty)'}
          </option>
        ))}
      </select>
    );
  }
  if (q && (q.type === 'rating_scale' || q.type === 'nps')) {
    const pts = q.type === 'nps' ? Array.from({ length: 11 }, (_, i) => ({ value: i, label: '' })) : scalePoints(q);
    return (
      <select className="input input-sm cond-value" value={String(c.value ?? '')} aria-label="Value" onChange={(e) => onChange({ ...c, value: Number(e.target.value) })}>
        <option value="">Choose</option>
        {pts.map((p) => (
          <option key={p.value} value={p.value}>
            {p.label ? `${p.value} (${p.label})` : p.value}
          </option>
        ))}
      </select>
    );
  }
  const numeric = q ? ['slider', 'number', 'matrix'].includes(q.type) : ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'].includes(c.operator);
  if (numeric) {
    return <NumberInput className="input-sm cond-value" value={typeof c.value === 'number' ? c.value : c.value ? Number(c.value) : null} onChange={(v) => onChange({ ...c, value: v ?? undefined })} ariaLabel="Value" />;
  }
  return <input className="input input-sm cond-value" value={String(c.value ?? '')} aria-label="Value" onChange={(e) => onChange({ ...c, value: e.target.value })} />;
}
