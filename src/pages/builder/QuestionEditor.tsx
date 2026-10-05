import { useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react';
import { AutoTextarea, Field, Icon, Menu, NumberInput, Toggle } from '../../components/ui';
import { uid } from '../../lib/ids';
import { SCALE_PRESETS, makeChoices } from '../../lib/questionTypes';
import type { Choice, Lang, Question, Survey } from '../../lib/types';

const DEFAULT_TITLES = new Set(['Untitled question', 'Neue Frage', 'Instructions', 'Hinweise']);

export type QMutate = (mutate: (q: Question) => void, coalesce?: string) => void;

export function QuestionEditor({ survey, q, change }: { survey: Survey; q: Question; change: QMutate }) {
  const lang = survey.settings.language;
  const isText = q.type === 'text_block';
  const selectedOnFocus = useRef(false);
  return (
    <div className="qedit" onClick={(e) => e.stopPropagation()}>
      <AutoTextarea
        className="qedit-title"
        value={q.title}
        placeholder={isText ? 'Heading (optional)' : 'Question text'}
        aria-label={isText ? 'Heading' : 'Question text'}
        // Default titles are selected on focus, so typing replaces them.
        onFocus={(e) => {
          if (!DEFAULT_TITLES.has(q.title.trim())) return;
          e.currentTarget.select();
          selectedOnFocus.current = true;
        }}
        onMouseUp={(e) => {
          // Keep the selection made on focus instead of letting the click place the caret.
          if (selectedOnFocus.current) e.preventDefault();
          selectedOnFocus.current = false;
        }}
        onChange={(e) => change((x) => void (x.title = e.target.value), 'title')}
      />
      <AutoTextarea
        className={`qedit-desc ${isText || q.type === 'consent' ? 'is-body' : ''}`}
        value={q.description ?? ''}
        placeholder={isText ? 'Text respondents read' : q.type === 'consent' ? 'Study information' : 'Description or instructions (optional)'}
        aria-label={isText ? 'Text' : 'Description'}
        onChange={(e) => change((x) => void (x.description = e.target.value), 'desc')}
      />
      <TypeContent survey={survey} q={q} change={change} lang={lang} />
      <p className="hint qedit-hint">
        Format with **bold**, *italic*, [links](https://…) and images ![description](https://…). Insert an earlier answer with {'{{'}variable{'}}'}.
      </p>
    </div>
  );
}

function TypeContent({ q, change, lang }: { survey: Survey; q: Question; change: QMutate; lang: Lang }) {
  const setChoices = (key: 'choices' | 'rows' | 'columns') => (list: Choice[]) => change((x) => void (x[key] = list), key);
  switch (q.type) {
    case 'single_choice':
    case 'multi_choice':
    case 'dropdown':
      return (
        <ChoiceList
          items={q.choices ?? []}
          onChange={setChoices('choices')}
          mark={q.type === 'multi_choice' ? 'square' : q.type === 'dropdown' ? 'none' : 'round'}
          word="Option"
          allowOther={q.type !== 'dropdown' || true}
          allowExclusive={q.type === 'multi_choice'}
        />
      );
    case 'rank':
    case 'constant_sum':
      return <ChoiceList items={q.choices ?? []} onChange={setChoices('choices')} mark="none" word="Item" />;
    case 'consent':
      return <ChoiceList items={q.choices ?? []} onChange={setChoices('choices')} mark="round" word="Option" fixed />;
    case 'matrix':
      return (
        <div className="matrix-editor">
          <div>
            <h4 className="sub-label">Statements</h4>
            <ChoiceList items={q.rows ?? []} onChange={setChoices('rows')} mark="none" word="Statement" prefix="r" />
          </div>
          <div>
            <div className="sub-label-row">
              <h4 className="sub-label">Scale</h4>
              <PresetSelect
                lang={lang}
                onPick={(labels) => change((x) => void (x.columns = makeChoices(labels, 'k')))}
              />
            </div>
            <ChoiceList items={q.columns ?? []} onChange={setChoices('columns')} mark="round" word="Point" prefix="k" />
          </div>
        </div>
      );
    case 'rating_scale':
      return <RatingEditor q={q} change={change} lang={lang} />;
    case 'slider':
      return <SliderEditor q={q} change={change} />;
    case 'nps':
      return (
        <div className="grid-2">
          <Field label="Label under 0">
            <input className="input" value={q.scale?.minLabel ?? ''} onChange={(e) => change((x) => void (x.scale = { ...x.scale!, minLabel: e.target.value }), 'minl')} />
          </Field>
          <Field label="Label under 10">
            <input className="input" value={q.scale?.maxLabel ?? ''} onChange={(e) => change((x) => void (x.scale = { ...x.scale!, maxLabel: e.target.value }), 'maxl')} />
          </Field>
        </div>
      );
    case 'short_text':
    case 'long_text':
    case 'number':
      return (
        <Field label="Placeholder" hint="Light hint text inside the empty answer box.">
          <input className="input" value={q.placeholder ?? ''} onChange={(e) => change((x) => void (x.placeholder = e.target.value), 'ph')} />
        </Field>
      );
    default:
      return null;
  }
}

function PresetSelect({ lang, onPick }: { lang: Lang; onPick: (labels: string[]) => void }) {
  return (
    <select
      className="input input-sm preset-select"
      value=""
      aria-label="Use a preset scale"
      onChange={(e) => {
        const p = SCALE_PRESETS.find((x) => x.id === e.target.value);
        if (p) onPick(p.labels[lang] ?? p.labels.en);
      }}
    >
      <option value="">Use a preset…</option>
      {SCALE_PRESETS.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </select>
  );
}

function RatingEditor({ q, change, lang }: { q: Question; change: QMutate; lang: Lang }) {
  const s = q.scale ?? { min: 1, max: 5 };
  const count = s.max - s.min + 1;
  const labels = s.pointLabels ?? [];
  const labeled = labels.length > 0;
  const setScale = (patch: Partial<NonNullable<Question['scale']>>, key?: string) => change((x) => void (x.scale = { ...s, ...x.scale, ...patch }), key);
  return (
    <div className="scale-editor">
      <div className="grid-4">
        <Field label="From">
          <select className="input" value={s.min} onChange={(e) => setScale({ min: Number(e.target.value), pointLabels: labeled ? resize(labels, s.max - Number(e.target.value) + 1) : [] })}>
            {[0, 1].map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </Field>
        <Field label="To">
          <select className="input" value={s.max} onChange={(e) => setScale({ max: Number(e.target.value), pointLabels: labeled ? resize(labels, Number(e.target.value) - s.min + 1) : [] })}>
            {[2, 3, 4, 5, 6, 7, 8, 9, 10, 11].filter((n) => n > s.min).map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </Field>
        <Field label="Style">
          <select className="input" value={s.style ?? 'numbers'} onChange={(e) => setScale({ style: e.target.value as 'numbers' | 'stars' })}>
            <option value="numbers">Numbered bubbles</option>
            <option value="stars">Stars</option>
          </select>
        </Field>
        <Field label="Preset">
          <PresetSelect
            lang={lang}
            onPick={(l) => setScale({ min: 1, max: l.length, pointLabels: l, minLabel: l[0], maxLabel: l[l.length - 1], style: 'numbers' })}
          />
        </Field>
      </div>
      {!labeled && (
        <div className="grid-2">
          <Field label={`Label for ${s.min}`}>
            <input className="input" value={s.minLabel ?? ''} onChange={(e) => setScale({ minLabel: e.target.value }, 'minl')} />
          </Field>
          <Field label={`Label for ${s.max}`}>
            <input className="input" value={s.maxLabel ?? ''} onChange={(e) => setScale({ maxLabel: e.target.value }, 'maxl')} />
          </Field>
        </div>
      )}
      <Toggle
        label="Label every point"
        hint="Shows a label under each bubble. On phones, fully labelled scales stack vertically."
        checked={labeled}
        onChange={(on) =>
          setScale({
            pointLabels: on ? Array.from({ length: count }, (_, i) => (i === 0 ? s.minLabel ?? '' : i === count - 1 ? s.maxLabel ?? '' : '')) : [],
          })
        }
      />
      {labeled && (
        <ol className="point-labels">
          {Array.from({ length: count }, (_, i) => (
            <li key={i}>
              <span className="mark mark-round mark-num" aria-hidden="true">
                {s.min + i}
              </span>
              <input
                className="input"
                value={labels[i] ?? ''}
                aria-label={`Label for ${s.min + i}`}
                onChange={(e) => {
                  const next = resize(labels, count);
                  next[i] = e.target.value;
                  setScale({ pointLabels: next, minLabel: next[0], maxLabel: next[count - 1] }, `pl${i}`);
                }}
              />
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function resize(list: string[], n: number): string[] {
  return Array.from({ length: n }, (_, i) => list[i] ?? '');
}

function SliderEditor({ q, change }: { q: Question; change: QMutate }) {
  const s = q.scale ?? { min: 0, max: 100, step: 1 };
  const set = (patch: Partial<NonNullable<Question['scale']>>, key?: string) => change((x) => void (x.scale = { ...s, ...x.scale, ...patch }), key);
  return (
    <div className="scale-editor">
      <div className="grid-3">
        <Field label="Lowest">
          <NumberInput value={s.min} onChange={(v) => set({ min: v ?? 0 }, 'min')} />
        </Field>
        <Field label="Highest">
          <NumberInput value={s.max} onChange={(v) => set({ max: v ?? 100 }, 'max')} />
        </Field>
        <Field label="Step">
          <NumberInput value={s.step ?? 1} onChange={(v) => set({ step: v ?? 1 }, 'step')} />
        </Field>
      </div>
      <div className="grid-2">
        <Field label="Left label">
          <input className="input" value={s.minLabel ?? ''} onChange={(e) => set({ minLabel: e.target.value }, 'minl')} />
        </Field>
        <Field label="Right label">
          <input className="input" value={s.maxLabel ?? ''} onChange={(e) => set({ maxLabel: e.target.value }, 'maxl')} />
        </Field>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------- option lists */

function nextFreeCode(items: Choice[]): number {
  const used = new Set(items.map((c) => c.code));
  for (let i = 1; ; i++) if (!used.has(i)) return i;
}

export function ChoiceList({
  items,
  onChange,
  mark,
  word,
  allowOther,
  allowExclusive,
  fixed,
  prefix = 'c',
}: {
  items: Choice[];
  onChange: (list: Choice[]) => void;
  mark: 'round' | 'square' | 'none';
  word: string;
  allowOther?: boolean;
  allowExclusive?: boolean;
  /** Consent: exactly two options, labels and codes editable. */
  fixed?: boolean;
  prefix?: string;
}) {
  const refs = useRef(new Map<string, HTMLInputElement>());
  const [focusId, setFocusId] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  useEffect(() => {
    if (!focusId) return;
    const el = refs.current.get(focusId);
    if (el) {
      el.focus();
      el.select();
    }
    setFocusId(null);
  }, [focusId, items]);

  const make = (label: string, list: Choice[]): Choice => ({ id: uid(prefix), label, code: nextFreeCode(list) });

  const insertAfter = (index: number, labels: string[]) => {
    const next = items.slice();
    const added: Choice[] = [];
    for (const l of labels) {
      const c = make(l, [...next, ...added]);
      added.push(c);
    }
    next.splice(index + 1, 0, ...added);
    onChange(next);
    setFocusId(added[added.length - 1]?.id ?? null);
  };

  const move = (from: number, to: number) => {
    if (to < 0 || to >= items.length) return;
    const next = items.slice();
    const [it] = next.splice(from, 1);
    next.splice(to, 0, it);
    onChange(next);
  };

  const patch = (id: string, p: Partial<Choice>) => onChange(items.map((c) => (c.id === id ? { ...c, ...p } : c)));

  const onKey = (e: KeyboardEvent<HTMLInputElement>, i: number, c: Choice) => {
    if (fixed) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      insertAfter(i, ['']);
    } else if (e.key === 'Backspace' && c.label === '' && items.length > 1) {
      e.preventDefault();
      const prev = items[i - 1] ?? items[i + 1];
      onChange(items.filter((x) => x.id !== c.id));
      setFocusId(prev?.id ?? null);
    } else if (e.altKey && e.key === 'ArrowUp') {
      e.preventDefault();
      move(i, i - 1);
      setFocusId(c.id);
    } else if (e.altKey && e.key === 'ArrowDown') {
      e.preventDefault();
      move(i, i + 1);
      setFocusId(c.id);
    }
  };

  const onPaste = (e: ClipboardEvent<HTMLInputElement>, i: number, c: Choice) => {
    if (fixed) return;
    const text = e.clipboardData.getData('text');
    if (!/\r?\n/.test(text.trim())) return;
    e.preventDefault();
    const lines = text
      .split(/\r?\n/)
      .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').trim())
      .filter(Boolean);
    if (!lines.length) return;
    const placeholder = /^(option|item|statement|point|eintrag|aussage)\s*\d+$/i;
    const othersUntouched = items.every((x, k) => k === i || !x.label.trim() || placeholder.test(x.label.trim()));
    if ((!c.label || placeholder.test(c.label)) && othersUntouched) {
      // A fresh list: the pasted lines become the whole list, coded 1, 2, 3 …
      const next = lines.map((label, k) => ({ id: k === 0 ? c.id : uid(prefix), label, code: k + 1 }));
      onChange(next);
      setFocusId(next[next.length - 1].id);
    } else if (!c.label) {
      const used = new Set(items.map((x) => x.code));
      let code = 1;
      const fresh = lines.slice(1).map((label) => {
        while (used.has(code)) code++;
        used.add(code);
        return { id: uid(prefix), label, code };
      });
      const next = [...items.slice(0, i), { ...c, label: lines[0] }, ...fresh, ...items.slice(i + 1)];
      onChange(next);
      setFocusId(fresh.length ? fresh[fresh.length - 1].id : c.id);
    } else {
      insertAfter(i, lines);
    }
  };

  return (
    <div className="clist">
      <ol className="clist-rows" onDragLeave={() => setOverIndex(null)}>
        {items.map((c, i) => (
          <li
            key={c.id}
            className={`clist-row ${dragId === c.id ? 'is-dragging' : ''} ${overIndex === i && dragId && dragId !== c.id ? 'is-over' : ''}`}
            draggable={!fixed && dragId === c.id}
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData('text/plain', c.id);
            }}
            onDragOver={(e) => {
              if (!dragId) return;
              e.preventDefault();
              setOverIndex(i);
            }}
            onDrop={(e) => {
              e.preventDefault();
              const from = items.findIndex((x) => x.id === dragId);
              if (from >= 0) move(from, i);
              setDragId(null);
              setOverIndex(null);
            }}
            onDragEnd={() => {
              setDragId(null);
              setOverIndex(null);
            }}
          >
            {!fixed && (
              <span className="grip" onPointerDown={() => setDragId(c.id)} onPointerUp={() => setDragId(null)} title="Drag to reorder (or Alt + arrow keys)">
                <Icon name="grip" size={16} />
              </span>
            )}
            {mark !== 'none' && <span className={`mark mark-${mark} mark-sm`} aria-hidden="true" />}
            <input
              ref={(el) => {
                if (el) refs.current.set(c.id, el);
                else refs.current.delete(c.id);
              }}
              className="clist-label"
              value={c.label}
              placeholder={c.other ? 'Other (please specify)' : `${word} ${i + 1}`}
              aria-label={`${word} ${i + 1}`}
              onChange={(e) => patch(c.id, { label: e.target.value })}
              onKeyDown={(e) => onKey(e, i, c)}
              onPaste={(e) => onPaste(e, i, c)}
            />
            {c.other && <span className="tag">text box</span>}
            {c.exclusive && <span className="tag">exclusive</span>}
            <NumberInput className="clist-code" value={c.code} ariaLabel={`Export code for ${word.toLowerCase()} ${i + 1}`} onChange={(v) => v !== null && Number.isInteger(v) && patch(c.id, { code: v })} />
            {!fixed && (
              <Menu
                label={`Options for ${word.toLowerCase()} ${i + 1}`}
                items={[
                  allowOther &&
                    (c.other || !items.some((x) => x.other)) && { label: c.other ? 'Remove the text box' : 'Add a text box (“Other”)', icon: 'page', onSelect: () => patch(c.id, { other: !c.other }) },
                  allowExclusive && { label: c.exclusive ? 'Make it a normal option' : 'Make it exclusive (“None of these”)', icon: 'check', onSelect: () => patch(c.id, { exclusive: !c.exclusive }) },
                  { label: 'Move up', icon: 'up', onSelect: () => move(i, i - 1), disabled: i === 0 },
                  { label: 'Move down', icon: 'down', onSelect: () => move(i, i + 1), disabled: i === items.length - 1 },
                  { label: 'Delete', icon: 'trash', danger: true, onSelect: () => onChange(items.filter((x) => x.id !== c.id)), disabled: items.length <= 1 },
                ]}
              />
            )}
          </li>
        ))}
      </ol>
      {!fixed && (
        <div className="clist-foot">
          <button type="button" className="link-btn" onClick={() => insertAfter(items.length - 1, [''])}>
            <Icon name="plus" size={16} /> Add {word.toLowerCase()}
          </button>
          {allowOther && !items.some((c) => c.other) && (
            <button
              type="button"
              className="link-btn"
              onClick={() => {
                const c = { ...make('Other', items), other: true };
                onChange([...items, c]);
              }}
            >
              Add “Other”
            </button>
          )}
          <button type="button" className="link-btn" onClick={() => onChange(items.map((c, i) => ({ ...c, code: i + 1 })))} title="Set export codes to 1, 2, 3 … in the current order">
            Renumber codes
          </button>
          <span className="hint clist-tip">Tip: paste a list to add many at once.</span>
        </div>
      )}
    </div>
  );
}
