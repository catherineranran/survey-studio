import { useEffect, useMemo, useState } from 'react';
import { QuestionView } from '../../components/QuestionView';
import { Button, Icon, IconButton, Menu, useConfirm, useMediaQuery } from '../../components/ui';
import { questionLabel } from '../../lib/lint';
import { TYPE_INFO, cloneQuestion, createQuestion } from '../../lib/questionTypes';
import { newBlock } from '../../lib/templates';
import type { Block, Question, QuestionType, Survey } from '../../lib/types';
import type { Updater } from '../../lib/useUndoable';
import { BlockInspector, QuestionInspector, SurveyOverview } from './Inspector';
import { describeLogic } from './LogicEditor';
import { QuestionEditor, type QMutate } from './QuestionEditor';
import { TypePicker } from './TypePicker';

type Selection = { kind: 'question'; id: string } | { kind: 'block'; id: string } | null;

function locate(s: Survey, qid: string): { block: Block; index: number } | null {
  for (const block of s.blocks) {
    const index = block.questions.findIndex((q) => q.id === qid);
    if (index >= 0) return { block, index };
  }
  return null;
}

export function Builder({ survey, update }: { survey: Survey; update: Updater<Survey> }) {
  const [sel, setSel] = useState<Selection>(null);
  const [adding, setAdding] = useState<{ blockId: string; afterId?: string } | null>(null);
  const [drag, setDrag] = useState<{ id: string; over?: string; overBlock?: string } | null>(null);
  const wide = useMediaQuery('(min-width: 1100px)');
  const outline = useMediaQuery('(min-width: 1400px)');
  const confirm = useConfirm();

  // Drop the selection when its target disappears (undo, delete).
  useEffect(() => {
    if (sel?.kind === 'question' && !locate(survey, sel.id)) setSel(null);
    if (sel?.kind === 'block' && !survey.blocks.some((b) => b.id === sel.id)) setSel(null);
  }, [survey, sel]);

  const selectQuestion = (id: string, scroll = false) => {
    setSel({ kind: 'question', id });
    if (scroll) requestAnimationFrame(() => document.getElementById(`q-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  };

  const changeQ =
    (qid: string): QMutate =>
    (mutate, coalesce) =>
      update(
        (s) => {
          const at = locate(s, qid);
          if (at) mutate(at.block.questions[at.index]);
        },
        { coalesce: coalesce ? `${qid}:${coalesce}` : undefined },
      );

  const replaceQ = (q: Question) =>
    update((s) => {
      const at = locate(s, q.id);
      if (at) at.block.questions[at.index] = q;
    });

  const addQuestion = (type: QuestionType) => {
    if (!adding) return;
    const q = createQuestion(type, survey);
    update((s) => {
      const b = s.blocks.find((x) => x.id === adding.blockId) ?? s.blocks[s.blocks.length - 1];
      const after = adding.afterId ? b.questions.findIndex((x) => x.id === adding.afterId) : -1;
      if (after >= 0) b.questions.splice(after + 1, 0, q);
      else b.questions.push(q);
    });
    setAdding(null);
    selectQuestion(q.id, true);
    // After the picker closes (and hands focus back), put the cursor in the new question's text.
    setTimeout(() => document.querySelector<HTMLTextAreaElement>(`#q-${q.id} .qedit-title`)?.focus(), 80);
  };

  const duplicateQ = (qid: string) => {
    const at = locate(survey, qid);
    if (!at) return;
    const copy = cloneQuestion(at.block.questions[at.index], survey);
    update((s) => {
      const loc = locate(s, qid);
      loc?.block.questions.splice(loc.index + 1, 0, copy);
    });
    selectQuestion(copy.id, true);
  };

  const deleteQ = async (qid: string) => {
    const at = locate(survey, qid);
    if (!at) return;
    const q = at.block.questions[at.index];
    const usedIn = dependents(survey, qid);
    if (usedIn.length) {
      const ok = await confirm({
        title: 'Delete this question?',
        message: (
          <>
            <p>Logic elsewhere depends on {q.variable || 'this question'}:</p>
            <ul>
              {usedIn.map((u) => (
                <li key={u}>{u}</li>
              ))}
            </ul>
            <p>Those conditions will stop working until you change them. You can also undo the deletion.</p>
          </>
        ),
        confirmLabel: 'Delete question',
        danger: true,
      });
      if (!ok) return;
    }
    update((s) => {
      const loc = locate(s, qid);
      loc?.block.questions.splice(loc.index, 1);
    });
    setSel(null);
  };

  const moveQ = (qid: string, dir: -1 | 1) =>
    update((s) => {
      const at = locate(s, qid);
      if (!at) return;
      const bi = s.blocks.indexOf(at.block);
      const target = at.index + dir;
      const [q] = at.block.questions.splice(at.index, 1);
      if (target >= 0 && target <= at.block.questions.length) at.block.questions.splice(target, 0, q);
      else if (dir < 0 && bi > 0) s.blocks[bi - 1].questions.push(q);
      else if (dir > 0 && bi < s.blocks.length - 1) s.blocks[bi + 1].questions.unshift(q);
      else at.block.questions.splice(at.index, 0, q);
    });

  const moveToBlock = (qid: string, blockId: string) =>
    update((s) => {
      const at = locate(s, qid);
      const target = s.blocks.find((b) => b.id === blockId);
      if (!at || !target || at.block.id === blockId) return;
      const [q] = at.block.questions.splice(at.index, 1);
      target.questions.push(q);
    });

  const dropOn = (targetQid: string | null, blockId: string) => {
    if (!drag) return;
    const dragId = drag.id;
    setDrag(null);
    if (dragId === targetQid) return;
    update((s) => {
      const from = locate(s, dragId);
      if (!from) return;
      const [q] = from.block.questions.splice(from.index, 1);
      const block = s.blocks.find((b) => b.id === blockId)!;
      const idx = targetQid ? block.questions.findIndex((x) => x.id === targetQid) : -1;
      if (idx >= 0) block.questions.splice(idx, 0, q);
      else block.questions.push(q);
    });
  };

  const addBlock = (afterIndex?: number) => {
    const b = newBlock(survey);
    update((s) => {
      if (afterIndex === undefined) s.blocks.push(b);
      else s.blocks.splice(afterIndex + 1, 0, b);
    });
    setSel({ kind: 'block', id: b.id });
    requestAnimationFrame(() => document.getElementById(`block-${b.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  const deleteBlock = async (b: Block) => {
    if (survey.blocks.length === 1) return;
    const ok = await confirm({
      title: `Delete “${b.title}”?`,
      message: b.questions.length ? `Its ${b.questions.length} question${b.questions.length === 1 ? '' : 's'} will be deleted too. You can undo this.` : 'You can undo this.',
      confirmLabel: 'Delete block',
      danger: true,
    });
    if (!ok) return;
    update((s) => {
      s.blocks = s.blocks.filter((x) => x.id !== b.id);
      for (const r of s.randomizers) r.blockIds = r.blockIds.filter((id) => id !== b.id);
      for (const x of s.blocks) for (const br of x.branches) if (br.target === b.id) br.target = 'end';
    });
  };

  const duplicateBlock = (b: Block) => {
    const copy: Block = {
      ...structuredClone(b),
      id: newBlock(survey).id,
      title: `${b.title} (copy)`,
      branches: [],
      questions: [],
    };
    const working: Survey = structuredClone(survey);
    const ids = new Map<string, string>(); // old question / option / row id -> copy's id
    for (const q of b.questions) {
      const c = cloneQuestion(q, working);
      working.blocks[0].questions.push(c);
      copy.questions.push(c);
      ids.set(q.id, c.id);
      const pairs: [typeof q.choices, typeof c.choices][] = [
        [q.choices, c.choices],
        [q.rows, c.rows],
        [q.columns, c.columns],
      ];
      for (const [from, to] of pairs) from?.forEach((x, i) => to?.[i] && ids.set(x.id, to[i].id));
    }
    // Conditions inside the copy that refer to questions of the same block follow the copies.
    const remap = (l: Block['displayLogic']) =>
      l?.conditions.forEach((cd) => {
        if (!ids.has(cd.source)) return;
        cd.source = ids.get(cd.source)!;
        if (cd.rowId && ids.has(cd.rowId)) cd.rowId = ids.get(cd.rowId);
        if (typeof cd.value === 'string' && ids.has(cd.value)) cd.value = ids.get(cd.value);
      });
    copy.questions.forEach((q) => remap(q.displayLogic));
    update((s) => {
      const i = s.blocks.findIndex((x) => x.id === b.id);
      s.blocks.splice(i + 1, 0, copy);
    });
  };

  const moveBlock = (i: number, dir: -1 | 1) =>
    update((s) => {
      const j = i + dir;
      if (j < 0 || j >= s.blocks.length) return;
      [s.blocks[i], s.blocks[j]] = [s.blocks[j], s.blocks[i]];
    });

  const selectedQ = sel?.kind === 'question' ? locate(survey, sel.id) : null;
  const selectedBlock = sel?.kind === 'block' ? survey.blocks.find((b) => b.id === sel.id) : null;

  const inspector = selectedQ ? (
    <QuestionInspector
      survey={survey}
      q={selectedQ.block.questions[selectedQ.index]}
      change={changeQ(sel!.id)}
      replace={replaceQ}
      onDuplicate={() => duplicateQ(sel!.id)}
      onDelete={() => deleteQ(sel!.id)}
      onMoveToBlock={(bid) => moveToBlock(sel!.id, bid)}
    />
  ) : selectedBlock ? (
    <BlockInspector survey={survey} block={selectedBlock} update={update} />
  ) : (
    <SurveyOverview survey={survey} />
  );

  const randomizerOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of survey.randomizers) for (const id of r.blockIds) m.set(id, r.variable);
    return m;
  }, [survey.randomizers]);

  return (
    <div className={`builder ${wide ? 'is-wide' : ''} ${outline ? 'has-outline' : ''}`} onClick={() => setSel(null)}>
      {outline && (
        <nav className="outline" aria-label="Survey outline" onClick={(e) => e.stopPropagation()}>
          <h2 className="outline-title">Outline</h2>
          <ol>
            {survey.blocks.map((b) => (
              <li key={b.id}>
                <button
                  type="button"
                  className={`outline-block ${sel?.kind === 'block' && sel.id === b.id ? 'is-active' : ''}`}
                  onClick={() => {
                    setSel({ kind: 'block', id: b.id });
                    document.getElementById(`block-${b.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }}
                >
                  {b.title || 'Untitled block'}
                </button>
                <ol>
                  {b.questions.map((q) => (
                    <li key={q.id}>
                      <button type="button" className={`outline-q ${sel?.kind === 'question' && sel.id === q.id ? 'is-active' : ''}`} onClick={() => selectQuestion(q.id, true)}>
                        <span className="mono">{q.variable || 'Text'}</span>
                        <span className="outline-q-text">{questionLabel(q)}</span>
                        {q.displayLogic?.conditions.length ? <Icon name="logic" size={14} className="logic-ico" /> : null}
                      </button>
                    </li>
                  ))}
                </ol>
              </li>
            ))}
          </ol>
        </nav>
      )}

      <div className="canvas">
        {survey.blocks.map((b, bi) => {
          const isSel = sel?.kind === 'block' && sel.id === b.id;
          const badges: string[] = [];
          if (b.pageMode === 'each') badges.push('One question per page');
          if (b.randomizeQuestions) badges.push('Shuffled');
          const rz = randomizerOf.get(b.id);
          return (
            <section
              key={b.id}
              id={`block-${b.id}`}
              className={`block ${isSel ? 'is-selected' : ''} ${drag?.overBlock === b.id && !drag.over ? 'is-drop' : ''}`}
              onDragOver={(e) => {
                if (!drag) return;
                e.preventDefault();
                if (drag.overBlock !== b.id || drag.over) setDrag({ ...drag, overBlock: b.id, over: undefined });
              }}
              onDrop={(e) => {
                e.preventDefault();
                dropOn(null, b.id);
              }}
            >
              <header
                className="block-head"
                onClick={(e) => {
                  e.stopPropagation();
                  setSel({ kind: 'block', id: b.id });
                }}
              >
                <div className="block-title-row">
                  <span className="block-kicker">Block {bi + 1}</span>
                  <h2 className="block-title">{b.title || 'Untitled block'}</h2>
                </div>
                <div className="block-badges">
                  {badges.map((x) => (
                    <span key={x} className="badge">
                      {x}
                    </span>
                  ))}
                  {rz && (
                    <span className="badge badge-logic">
                      <Icon name="shuffle" size={13} /> Randomizer {rz}
                    </span>
                  )}
                  {b.displayLogic?.conditions.length ? (
                    <span className="badge badge-logic">
                      <Icon name="logic" size={13} /> Shown if {describeLogic(b.displayLogic, survey)}
                    </span>
                  ) : null}
                </div>
                <Menu
                  label={`Block actions for ${b.title}`}
                  items={[
                    { label: 'Block settings and logic', icon: 'sliders', onSelect: () => setSel({ kind: 'block', id: b.id }) },
                    { label: 'Add a block after this one', icon: 'plus', onSelect: () => addBlock(bi) },
                    { label: 'Move block up', icon: 'up', onSelect: () => moveBlock(bi, -1), disabled: bi === 0 },
                    { label: 'Move block down', icon: 'down', onSelect: () => moveBlock(bi, 1), disabled: bi === survey.blocks.length - 1 },
                    { label: 'Duplicate block', icon: 'copy', onSelect: () => duplicateBlock(b) },
                    { label: 'Delete block', icon: 'trash', danger: true, onSelect: () => deleteBlock(b), disabled: survey.blocks.length === 1 },
                  ]}
                />
              </header>
              {!wide && isSel && <div className="inline-inspector">{inspector}</div>}

              <div className="block-body">
                {!b.questions.length && <p className="block-empty">No questions in this block yet.</p>}
                {b.questions.map((q, qi) => {
                  const isQ = sel?.kind === 'question' && sel.id === q.id;
                  return (
                    <article
                      key={q.id}
                      id={`q-${q.id}`}
                      className={`qcard ${isQ ? 'is-selected' : ''} ${drag?.id === q.id ? 'is-dragging' : ''} ${drag?.over === q.id ? 'is-drop-before' : ''}`}
                      draggable={drag?.id === q.id}
                      onDragStart={(e) => {
                        e.dataTransfer.effectAllowed = 'move';
                        e.dataTransfer.setData('text/plain', q.id);
                      }}
                      onDragOver={(e) => {
                        if (!drag) return;
                        e.preventDefault();
                        e.stopPropagation();
                        if (drag.over !== q.id) setDrag({ ...drag, over: q.id, overBlock: b.id });
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        dropOn(q.id, b.id);
                      }}
                      onDragEnd={() => setDrag(null)}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!isQ) selectQuestion(q.id);
                      }}
                    >
                      <div className="qcard-meta">
                        <span
                          className="grip"
                          title="Drag to move"
                          onPointerDown={() => setDrag({ id: q.id })}
                          onPointerUp={() => setDrag((d) => (d && !d.over ? null : d))}
                        >
                          <Icon name="grip" size={16} />
                        </span>
                        {q.variable ? <span className="var-chip">{q.variable}</span> : null}
                        <span className="type-label">{TYPE_INFO[q.type].label}</span>
                        {q.required && <span className="req-chip">Required</span>}
                        {q.displayLogic?.conditions.length ? (
                          <span className="logic-chip" title={`Shown if ${describeLogic(q.displayLogic, survey)}`}>
                            <Icon name="logic" size={13} /> Shown if {describeLogic(q.displayLogic, survey)}
                          </span>
                        ) : null}
                        <span className="qcard-tools">
                          <IconButton icon="up" size="sm" label="Move up" onClick={(e) => (e.stopPropagation(), moveQ(q.id, -1))} disabled={bi === 0 && qi === 0} />
                          <IconButton
                            icon="down"
                            size="sm"
                            label="Move down"
                            onClick={(e) => (e.stopPropagation(), moveQ(q.id, 1))}
                            disabled={bi === survey.blocks.length - 1 && qi === b.questions.length - 1}
                          />
                          <IconButton icon="copy" size="sm" label="Duplicate" onClick={(e) => (e.stopPropagation(), duplicateQ(q.id))} />
                          <IconButton icon="trash" size="sm" label="Delete" onClick={(e) => (e.stopPropagation(), void deleteQ(q.id))} />
                        </span>
                      </div>
                      {isQ ? (
                        <QuestionEditor survey={survey} q={q} change={changeQ(q.id)} />
                      ) : (
                        <div className="qcard-preview" aria-hidden="true">
                          <QuestionView q={q} value={undefined} onChange={() => {}} onOther={() => {}} lang={survey.settings.language} disabled />
                        </div>
                      )}
                      {isQ && !wide && <div className="inline-inspector">{inspector}</div>}
                      <button
                        type="button"
                        className="insert-here"
                        onClick={(e) => {
                          e.stopPropagation();
                          setAdding({ blockId: b.id, afterId: q.id });
                        }}
                      >
                        <Icon name="plus" size={14} />
                        <span>Insert question here</span>
                      </button>
                    </article>
                  );
                })}
                <Button
                  variant="quiet"
                  icon="plus"
                  className="add-question"
                  onClick={(e) => {
                    e.stopPropagation();
                    setAdding({ blockId: b.id });
                  }}
                >
                  Add question
                </Button>
              </div>

              {b.branches.length > 0 && (
                <footer className="block-foot">
                  <Icon name="logic" size={15} />
                  <div>
                    {b.branches.map((br) => (
                      <p key={br.id}>
                        If {describeLogic(br.logic, survey)}, go to{' '}
                        <strong>{br.target === 'end' ? `the end (${br.endTag || 'complete'})` : (survey.blocks.find((x) => x.id === br.target)?.title ?? 'a missing block')}</strong>
                      </p>
                    ))}
                  </div>
                </footer>
              )}
            </section>
          );
        })}
        <Button
          icon="plus"
          className="add-block"
          onClick={(e) => {
            e.stopPropagation();
            addBlock();
          }}
        >
          Add block
        </Button>
      </div>

      {wide && (
        <aside className="inspector" aria-label="Settings for the selection" onClick={(e) => e.stopPropagation()}>
          <div className="inspector-sticky">
            <h2 className="inspector-title">{selectedQ ? 'Question settings' : selectedBlock ? 'Block settings' : 'Overview'}</h2>
            {inspector}
          </div>
        </aside>
      )}

      <TypePicker open={!!adding} onClose={() => setAdding(null)} onPick={addQuestion} />
    </div>
  );
}

/** Where a question is used in other questions' or blocks' logic. */
function dependents(s: Survey, qid: string): string[] {
  const out: string[] = [];
  for (const b of s.blocks) {
    if (b.displayLogic?.conditions.some((c) => c.source === qid)) out.push(`Display logic of block “${b.title}”`);
    b.branches.forEach((br, i) => {
      if (br.logic.conditions.some((c) => c.source === qid)) out.push(`Skip rule ${i + 1} of block “${b.title}”`);
    });
    for (const q of b.questions) {
      if (q.id !== qid && q.displayLogic?.conditions.some((c) => c.source === qid)) out.push(`Display logic of ${q.variable || 'a text block'}`);
    }
  }
  return out;
}
