import { useId, type CSSProperties } from 'react';
import { ordered } from '../lib/engine';
import { t } from '../lib/i18n';
import { scalePoints } from '../lib/questionTypes';
import type { AnswerValue, Choice, Lang, Question } from '../lib/types';
import { RichText } from './RichText';
import { AutoTextarea, Button, Icon, IconButton, useMediaQuery } from './ui';

export interface QuestionViewProps {
  q: Question;
  number?: number;
  value: AnswerValue | undefined;
  other?: string;
  onChange: (v: AnswerValue | undefined) => void;
  onOther: (text: string) => void;
  error?: string | null;
  lang: Lang;
  choiceOrder?: string[];
  rowOrder?: string[];
  pipe?: (text: string | undefined) => string;
  /** Static rendering for the builder canvas. */
  disabled?: boolean;
}

const identity = (s: string | undefined) => s ?? '';

/** Renders one question the way respondents see it. Used by the live survey, the preview and the builder. */
export function QuestionView(props: QuestionViewProps) {
  const { q, number, error, lang } = props;
  const pipe = props.pipe ?? identity;
  const base = useId();
  const ids = { title: `${base}-t`, desc: `${base}-d`, err: `${base}-e` };
  const describedBy = [q.description ? ids.desc : '', error ? ids.err : ''].filter(Boolean).join(' ') || undefined;

  if (q.type === 'text_block') {
    return (
      <div className="qv qv-text_block" data-qid={q.id}>
        {q.title && (
          <h3 className="qv-text-title">
            <RichText as="span" text={pipe(q.title)} />
          </h3>
        )}
        <RichText className="qv-body" text={pipe(q.description)} />
      </div>
    );
  }

  const a11y = { 'aria-labelledby': ids.title, 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined } as const;

  return (
    <div className={`qv qv-${q.type} ${error ? 'has-error' : ''}`} data-qid={q.id}>
      <div className="qv-head">
        <h3 className="qv-title" id={ids.title}>
          {number !== undefined && <span className="qv-num">{number}</span>}
          <RichText as="span" text={pipe(q.title)} />
          {q.required && (
            <span className="qv-req" title={t(lang, 'required')}>
              <span aria-hidden="true">*</span>
              <span className="sr-only">{t(lang, 'required')}</span>
            </span>
          )}
        </h3>
        {q.description && <RichText className={q.type === 'consent' ? 'qv-desc consent-info' : 'qv-desc'} id={ids.desc} text={pipe(q.description)} />}
      </div>
      <div className="qv-control">
        <Control {...props} pipe={pipe} a11y={a11y} name={base} />
      </div>
      {error && (
        <p className="qv-error" id={ids.err}>
          <Icon name="warning" size={16} />
          <span>{error}</span>
        </p>
      )}
    </div>
  );
}

type A11y = { 'aria-labelledby': string; 'aria-describedby'?: string; 'aria-invalid'?: true };

function Control(props: QuestionViewProps & { pipe: (s: string | undefined) => string; a11y: A11y; name: string }) {
  const { q, value, onChange, lang, disabled, pipe, a11y, name } = props;
  switch (q.type) {
    case 'single_choice':
    case 'consent':
    case 'multi_choice':
      return <Choices {...props} multi={q.type === 'multi_choice'} />;
    case 'dropdown': {
      const list = ordered(q.choices, props.choiceOrder);
      const chosen = list.find((c) => c.id === value);
      return (
        <>
          <select className="input select" value={(value as string) ?? ''} disabled={disabled} onChange={(e) => onChange(e.target.value || undefined)} {...a11y}>
            <option value="">{t(lang, 'selectPlaceholder')}</option>
            {list.map((c) => (
              <option key={c.id} value={c.id}>
                {pipe(c.label)}
              </option>
            ))}
          </select>
          {chosen?.other && <OtherInput {...props} choice={chosen} />}
        </>
      );
    }
    case 'rating_scale':
    case 'nps':
      return <ScaleControl {...props} />;
    case 'matrix':
      return <Matrix {...props} />;
    case 'slider':
      return <Slider {...props} />;
    case 'rank':
      return <Rank {...props} />;
    case 'constant_sum':
      return <ConstantSum {...props} />;
    case 'short_text': {
      const f = q.validation?.format ?? 'any';
      return (
        <input
          className="input"
          type={f === 'email' ? 'email' : f === 'url' ? 'url' : 'text'}
          inputMode={f === 'number' ? 'decimal' : undefined}
          autoComplete={f === 'email' ? 'email' : 'off'}
          value={(value as string) ?? ''}
          placeholder={pipe(q.placeholder)}
          maxLength={q.validation?.maxLength ?? undefined}
          disabled={disabled}
          name={name}
          onChange={(e) => onChange(e.target.value)}
          {...a11y}
        />
      );
    }
    case 'long_text': {
      const s = (value as string) ?? '';
      const max = q.validation?.maxLength;
      return (
        <>
          <AutoTextarea
            className="input textarea"
            value={s}
            placeholder={pipe(q.placeholder)}
            maxLength={max ?? undefined}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
            {...a11y}
          />
          {max ? (
            <p className="char-count" aria-live="polite">
              {s.length} / {max}
            </p>
          ) : null}
        </>
      );
    }
    case 'number':
      return (
        <input
          className="input input-number"
          inputMode="decimal"
          value={value === undefined ? '' : String(value)}
          placeholder={pipe(q.placeholder)}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          {...a11y}
        />
      );
    case 'date':
      return <input className="input input-date" type="date" value={(value as string) ?? ''} disabled={disabled} onChange={(e) => onChange(e.target.value || undefined)} {...a11y} />;
    default:
      return null;
  }
}

function OtherInput(props: QuestionViewProps & { choice: Choice }) {
  return (
    <input
      className="input other-input"
      value={props.other ?? ''}
      placeholder={t(props.lang, 'otherPlaceholder')}
      aria-label={`${props.choice.label}: ${t(props.lang, 'otherPlaceholder')}`}
      disabled={props.disabled}
      onChange={(e) => props.onOther(e.target.value)}
      // Opening the text box is a clear signal of intent; put the cursor there.
      autoFocus={!props.disabled && !props.other}
    />
  );
}

function Choices(props: QuestionViewProps & { multi: boolean; pipe: (s: string | undefined) => string; a11y: A11y; name: string }) {
  const { q, value, onChange, multi, lang, disabled, pipe, a11y, name } = props;
  const list = ordered(q.choices, props.choiceOrder);
  const selected: string[] = multi ? (Array.isArray(value) ? (value as string[]) : []) : value ? [value as string] : [];

  const toggle = (c: Choice) => {
    if (!multi) return onChange(c.id);
    if (selected.includes(c.id)) {
      const next = selected.filter((id) => id !== c.id);
      return onChange(next.length ? next : undefined);
    }
    if (c.exclusive) return onChange([c.id]);
    const exclusive = new Set(list.filter((x) => x.exclusive).map((x) => x.id));
    onChange([...selected.filter((id) => !exclusive.has(id)), c.id]);
  };

  return (
    <div role={multi ? 'group' : 'radiogroup'} className={`choices ${q.layout === 'horizontal' ? 'is-horizontal' : ''}`} {...a11y}>
      {list.map((c) => {
        const checked = selected.includes(c.id);
        return (
          <div key={c.id} className={`choice ${checked ? 'is-checked' : ''}`}>
            <label className="choice-hit">
              <input type={multi ? 'checkbox' : 'radio'} name={name} checked={checked} disabled={disabled} onChange={() => toggle(c)} />
              <span className={`mark ${multi ? 'mark-square' : 'mark-round'}`} aria-hidden="true">
                {multi && <Icon name="check" size={14} />}
              </span>
              <span className="choice-label">{pipe(c.label)}</span>
            </label>
            {c.other && checked && <OtherInput {...props} choice={c} />}
          </div>
        );
      })}
      {!multi && !q.required && selected.length > 0 && !disabled && (
        <button type="button" className="link-btn clear-btn" onClick={() => onChange(undefined)}>
          {t(lang, 'clear')}
        </button>
      )}
    </div>
  );
}

function ScaleControl(props: QuestionViewProps & { a11y: A11y; name: string }) {
  const { q, value, onChange, disabled, a11y, name, lang } = props;
  const pts = q.type === 'nps' ? Array.from({ length: 11 }, (_, i) => ({ value: i, label: '' })) : scalePoints(q);
  const num = typeof value === 'number' ? value : null;
  const s = q.scale ?? { min: 0, max: 10 };
  const allLabeled = q.type === 'rating_scale' && pts.length > 0 && pts.every((p) => p.label);
  const ends = (s.minLabel || s.maxLabel || s.midLabel) && !allLabeled;

  if (q.type === 'rating_scale' && s.style === 'stars') {
    return (
      <div className="stars-wrap">
        <div role="radiogroup" className="stars" {...a11y}>
          {pts.map((p) => (
            <label key={p.value} className={`star ${num !== null && p.value <= num ? 'is-on' : ''}`}>
              <input type="radio" name={name} checked={num === p.value} disabled={disabled} onChange={() => onChange(p.value)} aria-label={p.label ? `${p.value}: ${p.label}` : String(p.value)} />
              <Icon name="star" size={34} />
            </label>
          ))}
        </div>
        {ends && (
          <div className="scale-ends">
            <span>{s.minLabel}</span>
            <span>{s.maxLabel}</span>
          </div>
        )}
        {num !== null && !q.required && !disabled && (
          <button type="button" className="link-btn clear-btn" onClick={() => onChange(undefined)}>
            {t(lang, 'clear')}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className={`scale-wrap ${allLabeled ? 'is-labeled' : ''}`} style={{ '--points': pts.length } as CSSProperties}>
      <div role="radiogroup" className="scale" {...a11y}>
        {pts.map((p) => {
          const checked = num === p.value;
          return (
            <label key={p.value} className={`scale-pt ${checked ? 'is-checked' : ''}`}>
              <input type="radio" name={name} checked={checked} disabled={disabled} onChange={() => onChange(p.value)} aria-label={p.label ? `${p.value}: ${p.label}` : String(p.value)} />
              <span className="mark mark-round mark-num" aria-hidden="true">
                {p.value}
              </span>
              {allLabeled && <span className="scale-pt-label">{p.label}</span>}
            </label>
          );
        })}
      </div>
      {ends && (
        <div className="scale-ends" aria-hidden="true">
          <span>{s.minLabel}</span>
          {s.midLabel ? <span className="scale-mid">{s.midLabel}</span> : <span />}
          <span>{s.maxLabel}</span>
        </div>
      )}
      {num !== null && !q.required && !disabled && (
        <button type="button" className="link-btn clear-btn" onClick={() => onChange(undefined)}>
          {t(lang, 'clear')}
        </button>
      )}
    </div>
  );
}

function Matrix(props: QuestionViewProps & { a11y: A11y; name: string; pipe: (s: string | undefined) => string }) {
  const { q, value, onChange, disabled, error, lang, pipe, a11y, name } = props;
  const narrow = useMediaQuery('(max-width: 640px)');
  const rows = ordered(q.rows, props.rowOrder);
  const cols = q.columns ?? [];
  const rec = (value as Record<string, string> | undefined) ?? {};
  const set = (rowId: string, colId: string) => onChange({ ...rec, [rowId]: colId });

  if (narrow) {
    return (
      <div className="mx-stack" {...a11y} role="group">
        {rows.map((row) => (
          <div key={row.id} className={`mx-card ${error && !rec[row.id] ? 'is-missing' : ''}`} role="radiogroup" aria-label={row.label}>
            <p className="mx-row-label">{pipe(row.label)}</p>
            <div className="choices">
              {cols.map((col) => {
                const checked = rec[row.id] === col.id;
                return (
                  <div key={col.id} className={`choice ${checked ? 'is-checked' : ''}`}>
                    <label className="choice-hit">
                      <input type="radio" name={`${name}-${row.id}`} checked={checked} disabled={disabled} onChange={() => set(row.id, col.id)} />
                      <span className="mark mark-round" aria-hidden="true" />
                      <span className="choice-label">{col.label}</span>
                    </label>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="mx-scroll" role="group" {...a11y}>
      <table className="matrix">
        <thead>
          <tr>
            <th scope="col">
              <span className="sr-only">{t(lang, 'statement')}</span>
            </th>
            {cols.map((c) => (
              <th scope="col" key={c.id}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className={error && !rec[row.id] ? 'is-missing' : ''}>
              <th scope="row">{pipe(row.label)}</th>
              {cols.map((col) => {
                const checked = rec[row.id] === col.id;
                return (
                  <td key={col.id}>
                    <label className={`mx-cell ${checked ? 'is-checked' : ''}`}>
                      <input type="radio" name={`${name}-${row.id}`} checked={checked} disabled={disabled} onChange={() => set(row.id, col.id)} aria-label={`${row.label}: ${col.label}`} />
                      <span className="mark mark-round" aria-hidden="true" />
                    </label>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Slider(props: QuestionViewProps & { a11y: A11y }) {
  const { q, value, onChange, disabled, lang, a11y } = props;
  const s = q.scale ?? { min: 0, max: 100, step: 1 };
  const num = typeof value === 'number' ? value : null;
  const mid = s.min + Math.round((s.max - s.min) / 2 / (s.step || 1)) * (s.step || 1);
  const shown = num ?? mid;
  const pct = s.max === s.min ? 0 : ((shown - s.min) / (s.max - s.min)) * 100;
  const commit = (el: HTMLInputElement) => onChange(Number(el.value));
  return (
    <div className={`slider ${num === null ? 'is-untouched' : ''}`}>
      <output className="slider-value" aria-hidden="true">
        {num === null ? '–' : num}
      </output>
      <input
        type="range"
        min={s.min}
        max={s.max}
        step={s.step || 1}
        value={shown}
        disabled={disabled}
        style={{ '--pct': `${pct}%` } as CSSProperties}
        onChange={(e) => commit(e.currentTarget)}
        onPointerUp={(e) => commit(e.currentTarget)}
        onKeyUp={(e) => {
          // Tabbing onto the slider is not an answer; arrow, Home/End and Page keys are.
          if (/^(Arrow|Home|End|Page)/.test(e.key)) commit(e.currentTarget);
        }}
        aria-valuetext={num === null ? t(lang, 'notAnswered') : String(num)}
        {...a11y}
      />
      <div className="scale-ends">
        <span>{s.minLabel || s.min}</span>
        <span>{s.maxLabel || s.max}</span>
      </div>
      {num === null && <p className="hint slider-hint">{t(lang, 'sliderUnanswered')}</p>}
    </div>
  );
}

function Rank(props: QuestionViewProps & { pipe: (s: string | undefined) => string; a11y: A11y }) {
  const { q, value, onChange, disabled, lang, pipe, a11y } = props;
  const byId = new Map((q.choices ?? []).map((c) => [c.id, c]));
  const answered = Array.isArray(value) && value.length > 0;
  const order = answered ? (value as string[]).filter((id) => byId.has(id)) : ordered(q.choices, props.choiceOrder).map((c) => c.id);
  const move = (from: number, to: number) => {
    const next = order.slice();
    const [it] = next.splice(from, 1);
    next.splice(to, 0, it);
    onChange(next);
  };
  return (
    <div className="rank-wrap" role="group" {...a11y}>
      <ol className="rank">
        {order.map((id, i) => {
          const c = byId.get(id)!;
          return (
            <li key={id} className="rank-item">
              <span className="mark mark-round mark-num is-filled" aria-hidden="true">
                {i + 1}
              </span>
              <span className="rank-label">{pipe(c.label)}</span>
              <span className="rank-actions">
                <IconButton icon="up" size="sm" label={`${t(lang, 'moveUp')}: ${c.label}`} disabled={disabled || i === 0} onClick={() => move(i, i - 1)} />
                <IconButton icon="down" size="sm" label={`${t(lang, 'moveDown')}: ${c.label}`} disabled={disabled || i === order.length - 1} onClick={() => move(i, i + 1)} />
              </span>
            </li>
          );
        })}
      </ol>
      <div className="rank-foot">
        {answered ? (
          <p className="hint rank-ok">
            <Icon name="check" size={16} /> {t(lang, 'rankKept')}
          </p>
        ) : (
          <>
            <p className="hint">{t(lang, 'rankHint')}</p>
            <Button size="sm" disabled={disabled} onClick={() => onChange(order)}>
              {t(lang, 'rankKeep')}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

function ConstantSum(props: QuestionViewProps & { pipe: (s: string | undefined) => string; a11y: A11y }) {
  const { q, value, onChange, disabled, lang, pipe, a11y } = props;
  const rec = (value as Record<string, string | number> | undefined) ?? {};
  const total = q.validation?.total ?? 100;
  const sum = Object.values(rec).reduce<number>((a, v) => {
    const n = Number(String(v).replace(',', '.'));
    return a + (Number.isFinite(n) ? n : 0);
  }, 0);
  return (
    <div className="csum" role="group" {...a11y}>
      {ordered(q.choices, props.choiceOrder).map((c) => (
        <label key={c.id} className="csum-row">
          <span className="csum-label">{pipe(c.label)}</span>
          <input
            className="input csum-input"
            inputMode="decimal"
            value={rec[c.id] === undefined ? '' : String(rec[c.id])}
            disabled={disabled}
            onChange={(e) => {
              const next: Record<string, string> = Object.fromEntries(Object.entries(rec).map(([k, v]) => [k, String(v)]));
              if (e.target.value.trim() === '') delete next[c.id];
              else next[c.id] = e.target.value;
              onChange(Object.keys(next).length ? next : undefined);
            }}
          />
        </label>
      ))}
      <div className={`csum-total ${Math.abs(sum - total) < 1e-9 ? 'is-ok' : ''}`} aria-live="polite">
        <span>{t(lang, 'total')}</span>
        <span className="csum-sum">
          {Math.round(sum * 100) / 100} / {total}
        </span>
      </div>
    </div>
  );
}
